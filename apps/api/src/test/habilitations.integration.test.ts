import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  and,
  authorizations,
  createDatabase,
  eq,
  entities,
  ldapDirectories,
  profileRights,
  profiles,
  ruleActions,
  ruleCriteria,
  rules,
  sql,
  users,
  type Connection,
} from '@tick/db';
import { DatabaseService } from '../database/database.service.js';
import type { LdapProfile } from '../ldap/ldap.service.js';
import { LdapSyncService } from '../ldap/ldap-sync.service.js';
import { RuleCatalogService } from '../rules/rule-catalog.service.js';
import { RuleEngineService } from '../rules/rule-engine.service.js';
import { RulesService } from '../rules/rules.service.js';

/**
 * Noms distinctifs propres a ce test.
 *
 * Volontairement sur un domaine qui n'existe nulle part ailleurs : les regles
 * du jeu de demonstration vivent dans la meme base, et un domaine partage les
 * ferait participer aux resultats mesures ici.
 */
const DOMAINE = 'DC=habilitations,DC=test';
const TECHNICIENS = `CN=Techniciens,OU=Groupes,${DOMAINE}`;
const SUPERVISEURS = `CN=Superviseurs,OU=Groupes,${DOMAINE}`;

function profilAnnuaire(groupDns: string[]): LdapProfile {
  return {
    dn: `CN=Utilisateur,${DOMAINE}`,
    login: 'utilisateur.hab',
    email: 'utilisateur@habilitations.test',
    firstName: 'Utilisateur',
    lastName: 'Habilitations',
    groupDns,
  };
}

/**
 * Habilitations cumulees et reconciliation depuis l'annuaire.
 *
 * Ces deux cas ne relevent pas des politiques SQL mais des services : le
 * premier verifie qu'un cumul d'habilitations ne se transforme jamais en union
 * de droits, le second qu'une synchronisation d'annuaire ne detruit pas le
 * travail d'un administrateur.
 */
describe('Habilitations', () => {
  let owner: Connection;
  let app: Connection;
  let sync: LdapSyncService;
  const regleIds: number[] = [];

  const ids = {
    racine: 0,
    siege: 0,
    site: 0,
    technicien: 0,
    selfService: 0,
    superviseur: 0,
    utilisateur: 0,
    annuaire: 0,
  };

  beforeAll(async () => {
    owner = createDatabase({ connectionString: process.env.DATABASE_URL as string, max: 2 });
    app = createDatabase({ connectionString: process.env.DATABASE_APP_URL as string, max: 2 });
    const db = new DatabaseService(app.db, owner.db, { owner, app });

    sync = new LdapSyncService(
      db,
      new RulesService(db, new RuleCatalogService(), new RuleEngineService()),
    );

    const creerEntite = async (nom: string, parent: number | null): Promise<number> => {
      const [row] = await owner.db
        .insert(entities)
        .values({ name: `HAB ${nom}`, parentId: parent, path: 'temporaire', completeName: nom })
        .returning({ id: entities.id });

      return (row as { id: number }).id;
    };

    ids.racine = await creerEntite('Racine', null);
    ids.siege = await creerEntite('Siege', ids.racine);
    ids.site = await creerEntite('Site', ids.racine);

    const creerProfil = async (nom: string, droits: [string, string][]): Promise<number> => {
      const [row] = await owner.db
        .insert(profiles)
        .values({ name: `HAB ${nom}` })
        .returning({ id: profiles.id });

      const id = (row as { id: number }).id;

      await owner.db.insert(profileRights).values(
        droits.map(([objet, action]) => ({
          profileId: id,
          object: objet,
          action,
          scope: 'entity' as const,
        })),
      );

      return id;
    };

    ids.technicien = await creerProfil('Technicien', [
      ['ticket', 'read'],
      ['ticket', 'update'],
      ['entity', 'read'],
    ]);
    ids.selfService = await creerProfil('Self-service', [
      ['ticket', 'create'],
      ['kb', 'read'],
    ]);
    ids.superviseur = await creerProfil('Superviseur', [['ticket', 'delete']]);

    const [utilisateur] = await owner.db
      .insert(users)
      .values({ username: `hab-${String(Date.now())}` })
      .returning({ id: users.id });
    ids.utilisateur = (utilisateur as { id: number }).id;

    const [annuaire] = await owner.db
      .insert(ldapDirectories)
      .values({
        name: `HAB annuaire ${String(Date.now())}`,
        host: 'annuaire.invalide',
        baseDn: 'dc=exemple,dc=fr',
      })
      .returning({ id: ldapDirectories.id });
    ids.annuaire = (annuaire as { id: number }).id;

    // La decision vient desormais du moteur de regles : deux regles
    // d'affectation remplacent les deux anciennes correspondances de groupe.
    const creerRegle = async (
      nom: string,
      groupe: string,
      profileId: number,
      entityId: number,
      recursif: boolean,
    ): Promise<void> => {
      const [ligne] = await owner.db
        .insert(rules)
        .values({
          entityId: ids.racine,
          entityPath: 'temporaire',
          isRecursive: true,
          collection: 'authorization.assign',
          name: `HAB ${nom}`,
          ranking: regleIds.length * 10 + 10,
        })
        .returning({ id: rules.id });

      const ruleId = (ligne as { id: number }).id;

      regleIds.push(ruleId);

      await owner.db
        .insert(ruleCriteria)
        .values({ ruleId, field: 'groups', operator: 'contains', value: groupe });

      await owner.db.insert(ruleActions).values([
        { ruleId, field: 'profileId', action: 'assign', value: String(profileId) },
        { ruleId, field: 'entityId', action: 'assign', value: String(entityId) },
        { ruleId, field: 'isRecursive', action: 'assign', value: String(recursif) },
      ]);
    };

    await creerRegle('Techniciens', TECHNICIENS, ids.technicien, ids.site, false);
    await creerRegle('Superviseurs', SUPERVISEURS, ids.superviseur, ids.racine, true);
  }, 30_000);

  afterAll(async () => {
    for (const id of regleIds) {
      await owner.db.execute(sql`DELETE FROM rules WHERE id = ${id}`);
    }

    await owner.db.execute(sql`DELETE FROM ldap_directories WHERE id = ${ids.annuaire}`);
    await owner.db.execute(sql`DELETE FROM users WHERE id = ${ids.utilisateur}`);
    await owner.db.execute(
      sql`DELETE FROM profiles WHERE id IN (${ids.technicien}, ${ids.selfService}, ${ids.superviseur})`,
    );
    await owner.db.execute(sql`DELETE FROM entities WHERE id IN (${ids.siege}, ${ids.site})`);
    await owner.db.execute(sql`DELETE FROM entities WHERE id = ${ids.racine}`);
    await Promise.all([owner.close(), app.close()]);
  });

  it("ne confond jamais un cumul d'habilitations avec une union de droits", async () => {
    await owner.db.insert(authorizations).values([
      { userId: ids.utilisateur, profileId: ids.technicien, entityId: ids.site },
      {
        userId: ids.utilisateur,
        profileId: ids.selfService,
        entityId: ids.siege,
        isRecursive: true,
      },
    ]);

    const droitsDe = async (profileId: number): Promise<string[]> => {
      const rows = await owner.db
        .select()
        .from(profileRights)
        .where(eq(profileRights.profileId, profileId));

      return rows.map((row) => `${row.object}:${row.action}`).sort();
    };

    const technicien = await droitsDe(ids.technicien);
    const selfService = await droitsDe(ids.selfService);

    expect(technicien).toEqual(['entity:read', 'ticket:read', 'ticket:update']);
    expect(selfService).toEqual(['kb:read', 'ticket:create']);

    // Le point du test : aucun droit du profil inactif ne doit apparaitre dans
    // l'autre. Les deux habilitations coexistent, les droits ne se melangent pas.
    for (const droit of selfService) expect(technicien).not.toContain(droit);

    await owner.db.delete(authorizations).where(eq(authorizations.userId, ids.utilisateur));
  });

  it("accorde les habilitations correspondant aux groupes d'annuaire", async () => {
    const resultat = await sync.applyDynamicAuthorizations(
      ids.utilisateur,
      profilAnnuaire([TECHNICIENS, `CN=Autre,OU=Groupes,${DOMAINE}`]),
    );

    expect(resultat.granted).toBe(1);

    const posees = await owner.db
      .select()
      .from(authorizations)
      .where(eq(authorizations.userId, ids.utilisateur));

    expect(posees).toHaveLength(1);
    expect(posees[0]?.profileId).toBe(ids.technicien);
    expect(posees[0]?.isDynamic).toBe(true);
  });

  it('compare les noms distinctifs sans tenir compte de la casse', async () => {
    const resultat = await sync.applyDynamicAuthorizations(
      ids.utilisateur,
      profilAnnuaire([TECHNICIENS.toLowerCase()]),
    );

    expect(resultat.granted).toBe(1);
    expect(resultat.revoked).toBe(0);
  });

  it('cumule les habilitations de plusieurs regles satisfaites', async () => {
    // Sans isolation entre regles, la seconde verrait le profil pose par la
    // premiere et n'accorderait rien : c'est le cas que le mode « sans
    // chainage » du moteur existe pour couvrir.
    const resultat = await sync.applyDynamicAuthorizations(
      ids.utilisateur,
      profilAnnuaire([TECHNICIENS, SUPERVISEURS]),
    );

    expect(resultat.granted).toBe(2);

    const posees = await owner.db
      .select()
      .from(authorizations)
      .where(eq(authorizations.userId, ids.utilisateur));

    expect(posees.map((ligne) => ligne.profileId).sort()).toEqual(
      [ids.technicien, ids.superviseur].sort(),
    );
    expect(posees.find((ligne) => ligne.profileId === ids.superviseur)?.isRecursive).toBe(true);
  });

  it('revoque les habilitations dynamiques perdues, et elles seules', async () => {
    // Habilitation accordee a la main par un administrateur : elle doit survivre.
    await owner.db.insert(authorizations).values({
      userId: ids.utilisateur,
      profileId: ids.selfService,
      entityId: ids.siege,
      isDynamic: false,
    });

    // L'utilisateur quitte tous ses groupes d'annuaire.
    const resultat = await sync.applyDynamicAuthorizations(ids.utilisateur, profilAnnuaire([]));

    expect(resultat.revoked).toBe(2);
    expect(resultat.granted).toBe(0);

    const restantes = await owner.db
      .select()
      .from(authorizations)
      .where(eq(authorizations.userId, ids.utilisateur));

    expect(restantes).toHaveLength(1);
    expect(restantes[0]?.profileId).toBe(ids.selfService);
    expect(restantes[0]?.isDynamic).toBe(false);
  });

  it('ne transforme pas une habilitation manuelle en habilitation revocable', async () => {
    // Le meme triplet existe deja a la main : une correspondance de groupe ne
    // doit pas le requalifier en dynamique, sans quoi la prochaine sortie de
    // groupe le supprimerait.
    await owner.db.insert(authorizations).values({
      userId: ids.utilisateur,
      profileId: ids.technicien,
      entityId: ids.site,
      isDynamic: false,
    });

    await sync.applyDynamicAuthorizations(ids.utilisateur, profilAnnuaire([TECHNICIENS]));

    const [conservee] = await owner.db
      .select()
      .from(authorizations)
      .where(
        and(
          eq(authorizations.userId, ids.utilisateur),
          eq(authorizations.profileId, ids.technicien),
        ),
      );

    expect(conservee?.isDynamic).toBe(false);

    await owner.db.delete(authorizations).where(eq(authorizations.userId, ids.utilisateur));
  });
});
