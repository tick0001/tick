import { Injectable, Logger } from '@nestjs/common';
import { and, eq, ldapDirectories } from '@tick/db';
import { Client, type Entry } from 'ldapts';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';

export type LdapDirectory = typeof ldapDirectories.$inferSelect;

export interface LdapProfile {
  dn: string;
  login: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Noms distinctifs des groupes dont l'utilisateur est membre. */
  groupDns: string[];
}

const FILTER_ESCAPES: Record<string, string> = {
  '\\': '\\5c',
  '*': '\\2a',
  '(': '\\28',
  ')': '\\29',
  '\0': '\\00',
};

/**
 * Echappement des valeurs inserees dans un filtre LDAP (RFC 4515).
 *
 * Sans lui, un identifiant contenant `*)(uid=*` transformerait le filtre en une
 * requete choisie par l'attaquant : c'est l'equivalent LDAP de l'injection SQL,
 * et il n'existe pas de requete parametree en LDAP.
 */
export function escapeFilterValue(value: string): string {
  return value.replace(/[\\*()\0]/g, (character) => FILTER_ESCAPES[character] ?? character);
}

function firstValue(value: unknown): string | null {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');

  return null;
}

function allValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string') return [value];

  return [];
}

@Injectable()
export class LdapService {
  private readonly logger = new Logger(LdapService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly secrets: SecretsService,
  ) {}

  /** Annuaires actifs, celui marque par defaut en premier. */
  async activeDirectories(): Promise<LdapDirectory[]> {
    const rows = await this.db.asOwner((tx) =>
      tx.select().from(ldapDirectories).where(eq(ldapDirectories.isActive, true)),
    );

    return rows.sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  async findByName(name: string): Promise<LdapDirectory | undefined> {
    const [row] = await this.db.asOwner((tx) =>
      tx
        .select()
        .from(ldapDirectories)
        .where(and(eq(ldapDirectories.name, name), eq(ldapDirectories.isActive, true))),
    );

    return row;
  }

  private createClient(directory: LdapDirectory): Client {
    const scheme = directory.useTls ? 'ldaps' : 'ldap';

    return new Client({
      url: `${scheme}://${directory.host}:${String(directory.port)}`,
      timeout: directory.timeoutMs,
      connectTimeout: directory.timeoutMs,
    });
  }

  private async bindServiceAccount(client: Client, directory: LdapDirectory): Promise<void> {
    if (!directory.bindDn || !directory.bindPasswordEncrypted) return;

    await client.bind(directory.bindDn, this.secrets.decrypt(directory.bindPasswordEncrypted));
  }

  /**
   * Retrouve les groupes d'un utilisateur, selon la strategie de l'annuaire.
   *
   * En mode `attribute`, ils sont deja sur l'entree utilisateur : c'est le
   * comportement d'Active Directory. En mode `search`, il faut interroger les
   * groupes eux-memes, seule voie fiable avec OpenLDAP, ou l'attribut `memberOf`
   * depend d'une surcouche rarement activee.
   */
  private async resolveGroups(
    client: Client,
    directory: LdapDirectory,
    entry: Entry,
  ): Promise<string[]> {
    if (directory.groupSearchMode === 'attribute') {
      return allValues(entry[directory.memberOfAttribute]);
    }

    const critere = `(${directory.groupMemberAttribute}=${escapeFilterValue(entry.dn)})`;
    const { searchEntries } = await client.search(directory.groupBaseDn ?? directory.baseDn, {
      scope: 'sub',
      filter: `(&${directory.groupFilter}${critere})`,
      // Seul le nom distinctif nous interesse : les correspondances vers les
      // habilitations sont declarees par DN.
      attributes: ['dn'],
    });

    return searchEntries.map((groupe) => groupe.dn);
  }

  /**
   * Authentifie un utilisateur contre un annuaire.
   *
   * Deroulement en deux temps, obligatoire : le compte de service recherche le
   * nom distinctif correspondant a l'identifiant, puis on tente une liaison avec
   * ce nom et le mot de passe fourni. C'est l'annuaire qui valide le mot de
   * passe ; il ne transite jamais autrement et n'est jamais compare localement.
   *
   * Renvoie null pour tout echec, sans distinguer les causes : un annuaire
   * injoignable et un mot de passe faux doivent se ressembler vus du client.
   */
  async authenticate(
    directory: LdapDirectory,
    username: string,
    password: string,
  ): Promise<LdapProfile | null> {
    // Une liaison avec un mot de passe vide est traitee comme anonyme par
    // beaucoup d'annuaires, et reussit : ce serait un contournement complet.
    if (password.length === 0) return null;

    const client = this.createClient(directory);

    try {
      await this.bindServiceAccount(client, directory);

      const critere = `(${directory.loginAttribute}=${escapeFilterValue(username)})`;
      const { searchEntries } = await client.search(directory.baseDn, {
        scope: 'sub',
        filter: `(&${directory.userFilter}${critere})`,
        attributes: [
          directory.loginAttribute,
          directory.emailAttribute,
          directory.firstNameAttribute,
          directory.lastNameAttribute,
          directory.memberOfAttribute,
        ],
      });

      // Plusieurs correspondances signalent un filtre trop large : refuser vaut
      // mieux que choisir arbitrairement quel compte authentifier.
      const entry = searchEntries[0];
      if (!entry || searchEntries.length > 1) return null;

      const groupDns = await this.resolveGroups(client, directory, entry);

      // Nouvelle connexion pour la liaison utilisateur : reutiliser la
      // precedente laisserait la session liee au compte de service si la
      // liaison echoue, sur certains serveurs.
      const userClient = this.createClient(directory);

      try {
        await userClient.bind(entry.dn, password);
      } finally {
        await userClient.unbind().catch(() => undefined);
      }

      return {
        dn: entry.dn,
        login: firstValue(entry[directory.loginAttribute]) ?? username,
        email: firstValue(entry[directory.emailAttribute]),
        firstName: firstValue(entry[directory.firstNameAttribute]),
        lastName: firstValue(entry[directory.lastNameAttribute]),
        groupDns,
      };
    } catch (error) {
      this.logger.debug(`Echec d'authentification sur ${directory.name} : ${String(error)}`);

      return null;
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
