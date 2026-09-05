import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, eq, ldapDirectories, sql, type Connection } from '@tick/db';
import { SecretsService } from '../common/secrets.service.js';
import { DatabaseService } from '../database/database.service.js';
import { LdapService, type LdapDirectory } from '../ldap/ldap.service.js';

/**
 * Parcours d'authentification contre un vrai annuaire.
 *
 * Le conteneur `openldap` du Compose est amorce par le fichier LDIF de
 * `docker/openldap/bootstrap`. Tester la logique d'echappement et de
 * reconciliation en isolation ne suffisait pas : c'est le dialogue avec un
 * serveur reel qui revele les ecarts entre annuaires, a commencer par la
 * decouverte des groupes.
 */
describe("Authentification contre l'annuaire", () => {
  let owner: Connection;
  let app: Connection;
  let ldap: LdapService;
  let annuaire: LdapDirectory;

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

    owner = createDatabase({ connectionString: process.env.DATABASE_URL as string, max: 2 });
    app = createDatabase({ connectionString: process.env.DATABASE_APP_URL as string, max: 2 });

    const secrets = new SecretsService();
    ldap = new LdapService(new DatabaseService(app.db, owner.db, { owner, app }), secrets);

    const [cree] = await owner.db
      .insert(ldapDirectories)
      .values({
        name: `Annuaire de test ${String(Date.now())}`,
        host: process.env.LDAP_HOST ?? 'localhost',
        port: Number(process.env.LDAP_PORT ?? '1389'),
        baseDn: 'dc=exemple,dc=fr',
        bindDn: 'cn=admin,dc=exemple,dc=fr',
        bindPasswordEncrypted: secrets.encrypt('admin'),
        userFilter: '(objectClass=inetOrgPerson)',
        groupSearchMode: 'search',
        groupBaseDn: 'ou=groups,dc=exemple,dc=fr',
        groupFilter: '(objectClass=groupOfNames)',
        groupMemberAttribute: 'member',
      })
      .returning();

    annuaire = cree as LdapDirectory;
  }, 30_000);

  afterAll(async () => {
    await owner.db.delete(ldapDirectories).where(eq(ldapDirectories.id, annuaire.id));
    await Promise.all([owner.close(), app.close()]);
  });

  it('authentifie un compte et rapporte ses attributs', async () => {
    const profil = await ldap.authenticate(annuaire, 'thomas.ldap', 'annuaire');

    expect(profil).not.toBeNull();
    expect(profil?.dn).toBe('uid=thomas.ldap,ou=users,dc=exemple,dc=fr');
    expect(profil?.login).toBe('thomas.ldap');
    expect(profil?.email).toBe('thomas.ldap@exemple.fr');
    expect(profil?.firstName).toBe('Thomas');
    expect(profil?.lastName).toBe('Petit');
  });

  it('decouvre les groupes en interrogeant les groupes eux-memes', async () => {
    // C'est le mode `search`. Avec le mode `attribute`, cet annuaire ne
    // renverrait aucun groupe : OpenLDAP n'expose pas `memberOf` par defaut.
    const thomas = await ldap.authenticate(annuaire, 'thomas.ldap', 'annuaire');
    const sophie = await ldap.authenticate(annuaire, 'sophie.ldap', 'annuaire');

    expect(thomas?.groupDns).toEqual(['cn=Techniciens,ou=groups,dc=exemple,dc=fr']);
    expect(sophie?.groupDns).toEqual(['cn=Superviseurs,ou=groups,dc=exemple,dc=fr']);
  });

  it("ne renvoie aucun groupe pour un compte qui n'en a pas", async () => {
    const profil = await ldap.authenticate(annuaire, 'sans.groupe', 'annuaire');

    expect(profil).not.toBeNull();
    expect(profil?.groupDns).toEqual([]);
  });

  it('refuse un mot de passe faux', async () => {
    expect(await ldap.authenticate(annuaire, 'thomas.ldap', 'mauvais')).toBeNull();
  });

  it('refuse un mot de passe vide', async () => {
    // Une liaison sans mot de passe est traitee comme anonyme par OpenLDAP et
    // reussit : sans le garde-fou, ce serait un contournement complet.
    expect(await ldap.authenticate(annuaire, 'thomas.ldap', '')).toBeNull();
  });

  it('refuse un identifiant inconnu', async () => {
    expect(await ldap.authenticate(annuaire, 'inconnu', 'annuaire')).toBeNull();
  });

  it('resiste a une tentative de detournement du filtre', async () => {
    // Sans echappement, ce filtre selectionnerait le premier compte venu.
    expect(await ldap.authenticate(annuaire, '*', 'annuaire')).toBeNull();
    expect(await ldap.authenticate(annuaire, '*)(uid=*', 'annuaire')).toBeNull();
  });

  it('renvoie null plutot que de propager une erreur si le serveur est injoignable', async () => {
    const injoignable: LdapDirectory = { ...annuaire, port: 1, timeoutMs: 1500 };

    expect(await ldap.authenticate(injoignable, 'thomas.ldap', 'annuaire')).toBeNull();
  });

  it('laisse la table des annuaires lisible par le role proprietaire seul', async () => {
    // Les annuaires ne sont pas rattaches a une entite : ils ne sont pas
    // proteges par le Row-Level Security mais par le droit `ldap:*`. Ce test
    // fige l'intention, pour qu'un ajout de politique ne passe pas inapercu.
    const politiques = await owner.db.execute<{ total: number } & Record<string, unknown>>(
      sql`SELECT count(*) AS total FROM pg_policies WHERE tablename = 'ldap_directories'`,
    );

    expect(politiques.rows[0]?.total).toBe(0);
  });
});
