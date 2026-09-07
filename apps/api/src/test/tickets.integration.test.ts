import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  entities,
  entitySettings,
  eq,
  groupMembers,
  groups,
  itilActors,
  profileRights,
  profiles,
  sql,
  tickets,
  users,
  type Connection,
} from '@tick/db';
import { RightsService, type RightScope } from '../auth/rights.service.js';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { EntitiesService } from '../entities/entities.service.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { RuleCatalogService } from '../rules/rule-catalog.service.js';
import { RuleEngineService } from '../rules/rule-engine.service.js';
import { RulesService } from '../rules/rules.service.js';
import { SlaService } from '../slm/sla.service.js';
import { SlmService } from '../slm/slm.service.js';
import { HistoryService } from '../tickets/history.service.js';
import { PriorityService } from '../tickets/priority.service.js';
import { TicketScopeService } from '../tickets/ticket-scope.service.js';
import { TicketTemplatesService } from '../tickets/ticket-templates.service.js';
import { TicketsService } from '../tickets/tickets.service.js';

/**
 * Portées de droits sur les tickets.
 *
 * Le Row-Level Security borne au périmètre de travail ; la portée du droit
 * resserre à l'intérieur. Ces deux mécanismes sont testés séparément parce
 * qu'ils échouent séparément : le premier est une protection, le second une
 * règle métier.
 */
describe('Portées de droits sur les tickets', () => {
  let owner: Connection;
  let appDb: Connection;
  let db: DatabaseService;
  let service: TicketsService;
  let rights: RightsService;

  const ids = {
    racine: 0,
    siege: 0,
    siteA: 0,
    siteB: 0,
    groupe: 0,
    technicien: 0,
    demandeur: 0,
    ticketSiteA: 0,
    ticketSiteADemandeur: 0,
    ticketSiteB: 0,
    ticketSiege: 0,
    ticketGroupe: 0,
  };

  /** Un profil par portée, pour basculer sans reconstruire le jeu de données. */
  const profils: Record<RightScope, number> = {
    own: 0,
    group: 0,
    entity: 0,
    recursive: 0,
    all: 0,
  };
  let profilSansDroit = 0;

  const cheminDe = async (entityId: number): Promise<string> => {
    const [ligne] = await owner.db
      .select({ path: entities.path })
      .from(entities)
      .where(eq(entities.id, entityId));

    return (ligne as { path: string }).path;
  };

  /** Exécute le travail dans un contexte donné, comme le ferait une requête. */
  const dans = async <T>(
    entityId: number,
    profileId: number,
    userId: number,
    work: () => Promise<T>,
    recursif = true,
  ): Promise<T> => {
    const path = await cheminDe(entityId);

    return runWithContext(
      {
        sessionId: 'test',
        userId,
        profileId,
        entityId,
        entityPath: path,
        includeSubEntities: recursif,
        locale: 'fr',
        profileInterface: 'standard',
        scope: recursif
          ? { subtreePaths: [path], exactPaths: [] }
          : { subtreePaths: [], exactPaths: [path] },
      },
      work,
    );
  };

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);

    owner = createDatabase({ connectionString: process.env.DATABASE_URL as string, max: 2 });
    appDb = createDatabase({ connectionString: process.env.DATABASE_APP_URL as string, max: 4 });
    db = new DatabaseService(appDb.db, owner.db, { owner, app: appDb });

    const hooks = new HookBus();
    const entiteService = new EntitiesService(db, hooks);

    rights = new RightsService(db);
    service = new TicketsService(
      db,
      hooks,
      new HistoryService(),
      new PriorityService(entiteService),
      new TicketScopeService(db, rights),
      new TicketTemplatesService(db, entiteService),
      new RulesService(db, new RuleCatalogService(), new RuleEngineService()),
      new SlaService(db, new SlmService(db)),
    );

    const creerEntite = async (nom: string, parent: number | null): Promise<number> => {
      const [ligne] = await owner.db
        .insert(entities)
        .values({ name: `TKT ${nom}`, parentId: parent, path: 'x', completeName: nom })
        .returning({ id: entities.id });

      return (ligne as { id: number }).id;
    };

    ids.racine = await creerEntite('Racine', null);
    ids.siege = await creerEntite('Siege', ids.racine);
    ids.siteA = await creerEntite('Site A', ids.racine);
    ids.siteB = await creerEntite('Site B', ids.racine);

    const creerProfil = async (nom: string, portee: RightScope | null): Promise<number> => {
      const [ligne] = await owner.db
        .insert(profiles)
        .values({ name: `TKT ${nom} ${String(Date.now())}${nom}` })
        .returning({ id: profiles.id });

      const id = (ligne as { id: number }).id;

      if (portee) {
        await owner.db.insert(profileRights).values(
          (['read', 'create', 'update', 'delete'] as const).map((action) => ({
            profileId: id,
            object: 'ticket',
            action,
            scope: portee,
          })),
        );
      }

      return id;
    };

    for (const portee of ['own', 'group', 'entity', 'recursive', 'all'] as const) {
      profils[portee] = await creerProfil(portee, portee);
    }
    profilSansDroit = await creerProfil('aucun', null);

    const creerUtilisateur = async (nom: string): Promise<number> => {
      const [ligne] = await owner.db
        .insert(users)
        .values({ username: `tkt-${nom}-${String(Date.now())}` })
        .returning({ id: users.id });

      return (ligne as { id: number }).id;
    };

    ids.technicien = await creerUtilisateur('technicien');
    ids.demandeur = await creerUtilisateur('demandeur');

    const [groupe] = await owner.db
      .insert(groups)
      .values({
        entityId: ids.racine,
        entityPath: 'x',
        isRecursive: true,
        name: `TKT Equipe ${String(Date.now())}`,
        completeName: 'Equipe',
      })
      .returning({ id: groups.id });
    ids.groupe = (groupe as { id: number }).id;

    await owner.db.insert(groupMembers).values({ userId: ids.technicien, groupId: ids.groupe });

    const creerTicket = async (
      entityId: number,
      titre: string,
      acteurs: { role: 'requester' | 'assigned'; type: 'user' | 'group'; id: number }[],
    ): Promise<number> => {
      const [ligne] = await owner.db
        .insert(tickets)
        .values({
          entityId,
          entityPath: 'x',
          name: titre,
          content: 'contenu',
          createdById: acteurs[0]?.type === 'user' ? acteurs[0].id : null,
        })
        .returning({ id: tickets.id });

      const id = (ligne as { id: number }).id;

      await owner.db.insert(itilActors).values(
        acteurs.map((acteur) => ({
          itilType: 'ticket' as const,
          itilId: id,
          role: acteur.role,
          actorType: acteur.type,
          actorId: acteur.id,
        })),
      );

      return id;
    };

    ids.ticketSiteA = await creerTicket(ids.siteA, 'TKT Site A tiers', [
      { role: 'requester', type: 'user', id: ids.demandeur },
    ]);
    ids.ticketSiteADemandeur = await creerTicket(ids.siteA, 'TKT Site A du technicien', [
      { role: 'requester', type: 'user', id: ids.technicien },
    ]);
    ids.ticketSiteB = await creerTicket(ids.siteB, 'TKT Site B', [
      { role: 'requester', type: 'user', id: ids.demandeur },
    ]);
    ids.ticketSiege = await creerTicket(ids.siege, 'TKT Siege', [
      { role: 'requester', type: 'user', id: ids.demandeur },
    ]);
    ids.ticketGroupe = await creerTicket(ids.siteB, 'TKT confie au groupe', [
      { role: 'requester', type: 'user', id: ids.demandeur },
      { role: 'assigned', type: 'group', id: ids.groupe },
    ]);
  }, 60_000);

  afterAll(async () => {
    const chemin = await cheminDe(ids.racine);

    await owner.db.execute(
      sql`DELETE FROM itil_actors WHERE itil_type = 'ticket' AND itil_id IN (
            SELECT id FROM tickets WHERE entity_path <@ ${chemin}::ltree)`,
    );
    await owner.db.execute(sql`DELETE FROM logs WHERE entity_path <@ ${chemin}::ltree`);
    await owner.db.execute(sql`DELETE FROM tickets WHERE entity_path <@ ${chemin}::ltree`);
    await owner.db.execute(sql`DELETE FROM group_members WHERE group_id = ${ids.groupe}`);
    await owner.db.execute(sql`DELETE FROM groups WHERE id = ${ids.groupe}`);
    await owner.db.execute(sql`DELETE FROM entity_settings WHERE entity_id = ${ids.racine}`);
    await owner.db.execute(
      sql`DELETE FROM users WHERE id IN (${ids.technicien}, ${ids.demandeur})`,
    );
    await owner.db.execute(
      sql`DELETE FROM profiles WHERE id IN (${sql.join(
        [...Object.values(profils), profilSansDroit].map((id) => sql`${id}`),
        sql`, `,
      )})`,
    );
    await owner.db.execute(
      sql`DELETE FROM entities WHERE id IN (${ids.siege}, ${ids.siteA}, ${ids.siteB})`,
    );
    await owner.db.execute(sql`DELETE FROM entities WHERE id = ${ids.racine}`);
    await Promise.all([owner.close(), appDb.close()]);
  });

  const titresVus = async (
    portee: RightScope,
    entityId: number,
    userId: number,
    recursif = true,
  ): Promise<string[]> => {
    rights.invalidate();

    const page = await dans(
      entityId,
      profils[portee],
      userId,
      () => service.list({ limit: 50, deleted: false, sort: 'dateOpened', direction: 'desc' }),
      recursif,
    );

    return page.items.map((ticket) => ticket.name).sort();
  };

  it('portee « all » : tout le perimetre de travail', async () => {
    const vus = await titresVus('all', ids.racine, ids.technicien);

    // Tri par code de caractere : « Siege » precede « Site », le e valant
    // moins que le t.
    expect(vus).toEqual([
      'TKT Siege',
      'TKT Site A du technicien',
      'TKT Site A tiers',
      'TKT Site B',
      'TKT confie au groupe',
    ]);
  });

  it('portee « recursive » : l entite active et sa descendance', async () => {
    // Depuis Site A, la descendance ne contient que Site A.
    expect(await titresVus('recursive', ids.siteA, ids.technicien)).toEqual([
      'TKT Site A du technicien',
      'TKT Site A tiers',
    ]);
  });

  it('portee « entity » : l entite active seule, meme session recursive', async () => {
    // La session inclut la descendance, mais la portee du droit ne la suit pas.
    const vus = await titresVus('entity', ids.racine, ids.technicien);

    expect(vus).toEqual([]);
  });

  it('portee « own » : seulement ses propres tickets', async () => {
    expect(await titresVus('own', ids.racine, ids.technicien)).toEqual([
      'TKT Site A du technicien',
    ]);
    expect(await titresVus('own', ids.racine, ids.demandeur)).toEqual([
      'TKT Siege',
      'TKT Site A tiers',
      'TKT Site B',
      'TKT confie au groupe',
    ]);
  });

  it('portee « group » : ses tickets, plus ceux de ses groupes', async () => {
    // Le technicien n'est demandeur que d'un ticket, mais son groupe est
    // affecte a un autre : les deux doivent apparaitre.
    expect(await titresVus('group', ids.racine, ids.technicien)).toEqual([
      'TKT Site A du technicien',
      'TKT confie au groupe',
    ]);
  });

  it('refuse explicitement au lieu de renvoyer une liste vide', async () => {
    rights.invalidate();

    // Une liste vide et un acces refuse demandent des reactions differentes :
    // les confondre transforme un probleme d'habilitation en apparente perte
    // de donnees.
    await expect(
      dans(ids.racine, profilSansDroit, ids.technicien, () =>
        service.list({ limit: 50, deleted: false, sort: 'dateOpened', direction: 'desc' }),
      ),
    ).rejects.toThrow(/ticket:read/);
  });

  it('respecte le Row-Level Security en plus de la portee', async () => {
    // Portee « all », mais perimetre de travail limite a Site B : le RLS borne
    // meme le droit le plus large.
    expect(await titresVus('all', ids.siteB, ids.technicien, false)).toEqual([
      'TKT Site B',
      'TKT confie au groupe',
    ]);
  });

  it('derive la priorite de la matrice heritee de l entite', async () => {
    // Matrice posee sur la racine : les sous-entites en heritent sans la
    // redeclarer. Celle-ci inverse l'echelle pour se distinguer de la valeur
    // par defaut de maniere non ambigue.
    await owner.db
      .insert(entitySettings)
      .values({
        entityId: ids.racine,
        priorityMatrix: [
          [5, 5, 5, 5, 5],
          [5, 5, 5, 5, 5],
          [5, 5, 5, 5, 5],
          [5, 5, 5, 5, 5],
          [5, 5, 5, 5, 5],
        ],
      })
      .onConflictDoUpdate({
        target: entitySettings.entityId,
        set: {
          priorityMatrix: [
            [5, 5, 5, 5, 5],
            [5, 5, 5, 5, 5],
            [5, 5, 5, 5, 5],
            [5, 5, 5, 5, 5],
            [5, 5, 5, 5, 5],
          ],
        },
      });

    rights.invalidate();

    const cree = await dans(ids.siteA, profils.all, ids.technicien, () =>
      service.create({
        name: 'TKT priorite heritee',
        content: '',
        type: 'incident',
        urgency: 1,
        impact: 1,
        actors: [],
      }),
    );

    // Urgence et impact au minimum, mais la matrice de la racine impose 5.
    expect(cree.priority).toBe(5);
  });
});
