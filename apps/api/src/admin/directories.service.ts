import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DirectoryTest, LdapDirectory, UpsertLdapDirectory } from '@tick/contracts';
import { ldapDirectories, sql } from '@tick/db';
import { Client } from 'ldapts';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';
import { toIso, toText } from '../common/sql.js';

/**
 * Configuration des annuaires.
 *
 * `ldap_directories` est une table globale, sans politique de sécurité au
 * niveau des lignes : un annuaire ne se rattache pas à une entité, il sert toute
 * l'installation. L'accès est donc gardé par le droit `ldap:*` au contrôleur,
 * et rien d'autre.
 *
 * Le mot de passe du compte de service est chiffré, jamais renvoyé, et jamais
 * effacé par une saisie vide : « ne rien taper » veut dire « ne pas y toucher »,
 * ce qui est la seule interprétation utile d'un champ de mot de passe dans un
 * formulaire de modification.
 */
@Injectable()
export class DirectoriesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly secrets: SecretsService,
  ) {}

  async list(): Promise<LdapDirectory[]> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT id, name, host, port, use_tls AS "useTls", bind_dn AS "bindDn",
               (bind_password_encrypted IS NOT NULL) AS "hasBindPassword",
               base_dn AS "baseDn", user_filter AS "userFilter",
               login_attribute AS "loginAttribute", email_attribute AS "emailAttribute",
               first_name_attribute AS "firstNameAttribute",
               last_name_attribute AS "lastNameAttribute",
               group_search_mode::text AS "groupSearchMode",
               member_of_attribute AS "memberOfAttribute",
               group_member_attribute AS "groupMemberAttribute",
               group_base_dn AS "groupBaseDn", group_filter AS "groupFilter",
               is_active AS "isActive", is_default AS "isDefault",
               timeout_ms AS "timeoutMs", last_sync_at AS "lastSyncAt"
          FROM ldap_directories
         ORDER BY is_default DESC, name
      `);

      return resultat.rows;
    });

    return rows.map((row) => ({
      id: Number(row['id']),
      name: toText(row['name']),
      host: toText(row['host']),
      port: Number(row['port']),
      useTls: Boolean(row['useTls']),
      bindDn: (row['bindDn'] as string | null) ?? null,
      hasBindPassword: Boolean(row['hasBindPassword']),
      baseDn: toText(row['baseDn']),
      userFilter: toText(row['userFilter']),
      loginAttribute: toText(row['loginAttribute']),
      emailAttribute: toText(row['emailAttribute']),
      firstNameAttribute: toText(row['firstNameAttribute']),
      lastNameAttribute: toText(row['lastNameAttribute']),
      groupSearchMode: row['groupSearchMode'] as LdapDirectory['groupSearchMode'],
      memberOfAttribute: toText(row['memberOfAttribute']),
      groupMemberAttribute: toText(row['groupMemberAttribute']),
      groupBaseDn: (row['groupBaseDn'] as string | null) ?? null,
      groupFilter: toText(row['groupFilter']),
      isActive: Boolean(row['isActive']),
      isDefault: Boolean(row['isDefault']),
      timeoutMs: Number(row['timeoutMs']),
      lastSyncAt: toIso(row['lastSyncAt']),
    }));
  }

  async save(input: UpsertLdapDirectory, id?: number): Promise<LdapDirectory> {
    if (id === undefined && !input.bindPassword && input.bindDn) {
      throw new BadRequestException(
        'Un compte de service exige son mot de passe a la creation.',
      );
    }

    const chiffre = input.bindPassword ? this.secrets.encrypt(input.bindPassword) : null;

    const cible = await this.db.asOwner(async (tx) => {
      const valeurs = {
        name: input.name,
        host: input.host,
        port: input.port,
        useTls: input.useTls,
        bindDn: input.bindDn ?? null,
        baseDn: input.baseDn,
        userFilter: input.userFilter,
        loginAttribute: input.loginAttribute,
        emailAttribute: input.emailAttribute,
        firstNameAttribute: input.firstNameAttribute,
        lastNameAttribute: input.lastNameAttribute,
        groupSearchMode: input.groupSearchMode,
        memberOfAttribute: input.memberOfAttribute,
        groupMemberAttribute: input.groupMemberAttribute,
        groupBaseDn: input.groupBaseDn ?? null,
        groupFilter: input.groupFilter,
        isActive: input.isActive,
        isDefault: input.isDefault,
        timeoutMs: input.timeoutMs,
        updatedAt: new Date(),
      };

      let annuaire = id;

      if (annuaire === undefined) {
        const [ligne] = await tx
          .insert(ldapDirectories)
          .values({ ...valeurs, bindPasswordEncrypted: chiffre })
          .returning({ id: ldapDirectories.id });

        annuaire = ligne?.id;
      } else {
        // `COALESCE` plutot qu'une affectation conditionnelle : sans mot de
        // passe saisi, la colonne garde sa valeur, et le formulaire n'a pas a
        // se souvenir de ce qu'il n'a jamais recu.
        const resultat = await tx.execute<{ id: number }>(sql`
          UPDATE ldap_directories
             SET name = ${valeurs.name}, host = ${valeurs.host}, port = ${valeurs.port},
                 use_tls = ${valeurs.useTls}, bind_dn = ${valeurs.bindDn},
                 bind_password_encrypted = COALESCE(${chiffre}, bind_password_encrypted),
                 base_dn = ${valeurs.baseDn}, user_filter = ${valeurs.userFilter},
                 login_attribute = ${valeurs.loginAttribute},
                 email_attribute = ${valeurs.emailAttribute},
                 first_name_attribute = ${valeurs.firstNameAttribute},
                 last_name_attribute = ${valeurs.lastNameAttribute},
                 group_search_mode = ${valeurs.groupSearchMode}::ldap_group_search_mode,
                 member_of_attribute = ${valeurs.memberOfAttribute},
                 group_member_attribute = ${valeurs.groupMemberAttribute},
                 group_base_dn = ${valeurs.groupBaseDn}, group_filter = ${valeurs.groupFilter},
                 is_active = ${valeurs.isActive}, is_default = ${valeurs.isDefault},
                 timeout_ms = ${valeurs.timeoutMs}, updated_at = now()
           WHERE id = ${annuaire}
          RETURNING id
        `);

        annuaire = resultat.rows[0]?.id;
      }

      if (annuaire === undefined) return undefined;

      // Un seul annuaire par defaut : c'est lui qu'on interroge en premier
      // quand un identifiant est inconnu localement, et deux « premiers »
      // rendraient l'ordre d'essai arbitraire.
      if (input.isDefault) {
        await tx.execute(
          sql`UPDATE ldap_directories SET is_default = false WHERE id <> ${annuaire} AND is_default`,
        );
      }

      return annuaire;
    });

    if (cible === undefined) throw new NotFoundException('Annuaire introuvable.');

    const tous = await this.list();
    const trouve = tous.find((annuaire) => annuaire.id === cible);

    if (!trouve) throw new NotFoundException('Annuaire introuvable apres enregistrement.');

    return trouve;
  }

  async remove(id: number): Promise<void> {
    const [usage] = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM users WHERE auth_source = 'ldap'`,
      );

      return resultat.rows;
    });

    // Les comptes synchronisés survivent à la suppression de leur annuaire,
    // mais ils ne pourront plus s'authentifier : le dire vaut mieux que de le
    // laisser découvrir au prochain matin.
    if (Number(usage?.total ?? 0) > 0) {
      await this.db.asOwner(async (tx) => {
        await tx.execute(sql`UPDATE ldap_directories SET is_active = false WHERE id = ${id}`);
      });

      return;
    }

    await this.db.asOwner(async (tx) => {
      await tx.execute(sql`DELETE FROM ldap_directories WHERE id = ${id}`);
    });
  }

  /**
   * Essai de connexion.
   *
   * Le message d'erreur de l'annuaire est repris tel quel : « invalid
   * credentials » et « no such object » désignent deux fautes de configuration
   * différentes, et les fondre dans un « échec » générique obligerait à ouvrir
   * les journaux du serveur pour savoir laquelle.
   *
   * C'est un écart assumé à la règle qui gouverne l'authentification, où toutes
   * les causes se ressemblent : ici, celui qui lit le message est
   * l'administrateur qui vient de saisir la configuration, pas un inconnu qui
   * sonde des identifiants.
   */
  async test(id: number): Promise<DirectoryTest> {
    const annuaire = (await this.list()).find((valeur) => valeur.id === id);

    if (!annuaire) throw new NotFoundException('Annuaire introuvable.');

    const [secret] = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ chiffre: string | null }>(
        sql`SELECT bind_password_encrypted AS chiffre FROM ldap_directories WHERE id = ${id}`,
      );

      return resultat.rows;
    });

    const client = new Client({
      url: `${annuaire.useTls ? 'ldaps' : 'ldap'}://${annuaire.host}:${String(annuaire.port)}`,
      timeout: annuaire.timeoutMs,
      connectTimeout: annuaire.timeoutMs,
    });

    try {
      if (annuaire.bindDn && secret?.chiffre) {
        await client.bind(annuaire.bindDn, this.secrets.decrypt(secret.chiffre));
      }

      const { searchEntries } = await client.search(annuaire.baseDn, {
        scope: 'sub',
        filter: annuaire.userFilter,
        attributes: ['dn'],
        sizeLimit: 50,
      });

      return { ok: true, message: 'Liaison etablie.', found: searchEntries.length };
    } catch (erreur) {
      return {
        ok: false,
        message: erreur instanceof Error ? erreur.message : String(erreur),
        found: null,
      };
    } finally {
      await client.unbind().catch(() => undefined);
    }
  }
}
