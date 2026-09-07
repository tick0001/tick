import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileRights, profiles, sql, users } from '@tick/db';
import { RightsService } from '../auth/rights.service.js';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { EntitiesService } from '../entities/entities.service.js';
import { PlanningService } from '../planning/planning.service.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { RuleCatalogService } from '../rules/rule-catalog.service.js';
import { RuleEngineService } from '../rules/rule-engine.service.js';
import { RulesService } from '../rules/rules.service.js';
import { SlaService } from '../slm/sla.service.js';
import { SlmService } from '../slm/slm.service.js';
import { DashboardsService } from '../stats/dashboards.service.js';
import { StatsService } from '../stats/stats.service.js';
import { WidgetRegistry } from '../stats/widget-registry.service.js';
import { BulkService } from '../tickets/bulk.service.js';
import { HistoryService } from '../tickets/history.service.js';
import { PriorityService } from '../tickets/priority.service.js';
import { TicketScopeService } from '../tickets/ticket-scope.service.js';
import { TicketTemplatesService } from '../tickets/ticket-templates.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { TimelineService } from '../tickets/timeline.service.js';
import { createFixture, type Fixture } from './fixtures.js';

/**
 * Pilotage : planning, statistiques, tableaux de bord, actions massives.
 *
 * Ce qui se casse en silence ici, c'est le **périmètre**. Un agrégat est une
 * lecture comme une autre : compter « tous les tickets » sans passer par la
 * portée du droit divulgue exactement ce que la liste refuse de montrer, et
 * personne ne s'en aperçoit — un nombre ne ressemble pas à une fuite.
 */
describe('Pilotage', () => {
  let fixture: Fixture;
  let planning: PlanningService;
  let stats: StatsService;
  let dashboards: DashboardsService;
  let bulk: BulkService;
  let tickets: TicketsService;
  let timeline: TimelineService;

  const ids = {
    profilComplet: 0,
    profilPropre: 0,
    intervenant: 0,
    demandeur: 0,
    ticketA: 0,
    ticketB: 0,
  };

  const dans = <T>(
    profileId: number,
    userId: number,
    entite: 'siteA' | 'siteB',
    work: () => Promise<T>,
  ): Promise<T> => {
    const path = fixture.paths[entite] as string;

    return runWithContext(
      {
        sessionId: 'test',
        userId,
        profileId,
        entityId: fixture.entityIds[entite] as number,
        entityPath: path,
        includeSubEntities: true,
        locale: 'fr',
        profileInterface: 'standard',
        scope: { subtreePaths: [path], exactPaths: [] },
      },
      work,
    );
  };

  const commeIntervenant = <T>(work: () => Promise<T>): Promise<T> =>
    dans(ids.profilComplet, ids.intervenant, 'siteA', work);

  beforeAll(async () => {
    fixture = await createFixture('PIL');

    const db = new DatabaseService(fixture.app.db, fixture.owner.db, {
      owner: fixture.owner,
      app: fixture.app,
    });

    const hooks = new HookBus();
    const entites = new EntitiesService(db, hooks);
    const rights = new RightsService(db);
    const history = new HistoryService();
    const priority = new PriorityService(entites);
    const scopes = new TicketScopeService(db, rights);

    tickets = new TicketsService(
      db,
      hooks,
      history,
      priority,
      scopes,
      new TicketTemplatesService(db, entites),
      new RulesService(db, new RuleCatalogService(), new RuleEngineService()),
      new SlaService(db, new SlmService(db)),
    );
    timeline = new TimelineService(db, hooks, history, scopes);
    planning = new PlanningService(db, scopes);
    stats = new StatsService(db, scopes);
    dashboards = new DashboardsService(db, new WidgetRegistry());
    bulk = new BulkService(db, tickets);

    const creerProfil = async (
      nom: string,
      droits: readonly (readonly [string, string, 'own' | 'all'])[],
    ): Promise<number> => {
      const [ligne] = await fixture.owner.db
        .insert(profiles)
        .values({ name: `PIL ${nom} ${String(Date.now())}` })
        .returning({ id: profiles.id });

      const id = (ligne as { id: number }).id;

      await fixture.owner.db
        .insert(profileRights)
        .values(droits.map(([object, action, scope]) => ({ profileId: id, object, action, scope })));

      return id;
    };

    ids.profilComplet = await creerProfil('Complet', [
      ['ticket', 'read', 'all'],
      ['ticket', 'create', 'all'],
      ['ticket', 'update', 'all'],
      ['ticket', 'delete', 'all'],
    ]);

    // Portée `own` : ce profil ne voit que ses propres tickets. Les agrégats
    // doivent s'y plier exactement comme les listes.
    ids.profilPropre = await creerProfil('Propre', [['ticket', 'read', 'own']]);

    const creerUtilisateur = async (nom: string): Promise<number> => {
      const [ligne] = await fixture.owner.db
        .insert(users)
        .values({ username: `pil-${nom}-${String(Date.now())}`, email: `${nom}@pilotage.test` })
        .returning({ id: users.id });

      return (ligne as { id: number }).id;
    };

    ids.intervenant = await creerUtilisateur('intervenant');
    ids.demandeur = await creerUtilisateur('demandeur');

    await commeIntervenant(async () => {
      const a = await tickets.create({
        name: 'PIL Imprimante hors service',
        content: 'Voyant rouge.',
        type: 'incident',
        urgency: 4,
        impact: 3,
        actors: [{ role: 'requester', actorType: 'user', actorId: ids.demandeur }],
      });

      ids.ticketA = a.id;

      const b = await tickets.create({
        name: 'PIL Licence bureautique',
        content: 'Poste a equiper.',
        type: 'request',
        urgency: 2,
        impact: 2,
        actors: [],
      });

      ids.ticketB = b.id;

      await timeline.addTask(a.id, {
        content: 'PIL Intervention sur site',
        state: 'todo',
        isPrivate: false,
        actionTime: 60,
        beginAt: '2026-11-02T08:00:00.000Z',
        endAt: '2026-11-02T10:00:00.000Z',
        technicianId: ids.intervenant,
      });

      await timeline.addTask(a.id, {
        content: 'PIL Commande de piece',
        state: 'todo',
        isPrivate: false,
        actionTime: 15,
        beginAt: '2026-11-02T09:00:00.000Z',
        endAt: '2026-11-02T11:00:00.000Z',
        technicianId: ids.intervenant,
      });
    });
  });

  afterAll(async () => {
    const chemin = fixture.paths['racine'] as string;

    for (const table of ['itil_tasks', 'itil_followups', 'logs', 'unavailabilities']) {
      await fixture.owner.db.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE entity_path <@ ${chemin}::ltree`,
      );
    }

    await fixture.owner.db.execute(sql`
      DELETE FROM dashboard_widgets WHERE dashboard_id IN (
        SELECT id FROM dashboards WHERE entity_path <@ ${chemin}::ltree)
    `);
    await fixture.owner.db.execute(
      sql`DELETE FROM dashboards WHERE entity_path <@ ${chemin}::ltree`,
    );
    await fixture.owner.db.execute(sql`
      DELETE FROM itil_actors WHERE itil_type = 'ticket' AND itil_id IN (
        SELECT id FROM tickets WHERE entity_path <@ ${chemin}::ltree)
    `);
    await fixture.owner.db.execute(sql`DELETE FROM tickets WHERE entity_path <@ ${chemin}::ltree`);

    await fixture.cleanup();
  });

  describe('Planning', () => {
    it('superpose tâches et indisponibilités, et marque les chevauchements', async () => {
      await commeIntervenant(() =>
        planning.createUnavailability({
          userId: ids.intervenant,
          beginAt: '2026-11-03T00:00:00.000Z',
          endAt: '2026-11-04T00:00:00.000Z',
          reason: 'PIL Conges',
        }),
      );

      const entrees = await commeIntervenant(() =>
        planning.list({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z' }),
      );

      const taches = entrees.filter((entree) => entree.kind === 'task');
      const absences = entrees.filter((entree) => entree.kind === 'unavailability');

      expect(taches).toHaveLength(2);
      expect(absences).toHaveLength(1);
      expect(taches.every((tache) => tache.conflicts.length === 1)).toBe(true);
    });

    it('refuse une fenêtre trop large', async () => {
      await expect(
        commeIntervenant(() =>
          planning.list({ from: '2026-01-01T00:00:00.000Z', to: '2027-01-01T00:00:00.000Z' }),
        ),
      ).rejects.toThrow(/trop large/i);
    });

    it('refuse une fenêtre inversée', async () => {
      await expect(
        commeIntervenant(() =>
          planning.list({ from: '2026-11-06T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' }),
        ),
      ).rejects.toThrow(/precede/i);
    });
  });

  describe('Statistiques', () => {
    it('compte les tickets du périmètre et les ventile', async () => {
      const rapport = await commeIntervenant(() =>
        stats.report({ dimension: 'type', from: '2026-01-01T00:00:00.000Z' }),
      );

      expect(rapport.summary.opened).toBeGreaterThanOrEqual(2);

      const incidents = rapport.buckets.find((seau) => seau.key === 'incident');

      expect(incidents?.opened).toBeGreaterThanOrEqual(1);
    });

    it('respecte la portée du droit, comme le ferait une liste', async () => {
      // Le demandeur n'est acteur que du premier ticket : un agrégat qui
      // compterait les deux lui révélerait l'existence du second.
      const rapport = await dans(ids.profilPropre, ids.demandeur, 'siteA', () =>
        stats.report({ dimension: 'status' }),
      );

      const total = rapport.buckets.reduce((somme, seau) => somme + seau.opened, 0);

      expect(total).toBe(1);
      expect(rapport.summary.opened).toBe(1);
    });

    it('produit un point par jour, y compris les jours sans activité', async () => {
      const courbe = await commeIntervenant(() =>
        stats.trend({
          dimension: 'status',
          from: '2026-11-01T00:00:00.000Z',
          to: '2026-11-05T00:00:00.000Z',
        }),
      );

      expect(courbe).toHaveLength(5);
      expect(courbe[0]?.day).toBe('2026-11-01');
    });
  });

  describe('Tableaux de bord', () => {
    it('refuse un widget inconnu', async () => {
      await expect(
        commeIntervenant(() =>
          dashboards.save({
            name: 'PIL Essai',
            isPublic: false,
            isRecursive: false,
            widgets: [{ kind: 'core.inexistant', title: '', width: 6, config: {} }],
          }),
        ),
      ).rejects.toThrow(/inconnu/i);
    });

    it('garde un tableau personnel invisible des autres', async () => {
      const cree = await commeIntervenant(() =>
        dashboards.save({
          name: 'PIL Personnel',
          isPublic: false,
          isRecursive: false,
          widgets: [{ kind: 'core.counts', title: '', width: 12, config: {} }],
        }),
      );

      expect(cree.widgets).toHaveLength(1);
      expect(cree.isMine).toBe(true);

      const vusParUnAutre = await dans(ids.profilComplet, ids.demandeur, 'siteA', () =>
        dashboards.list(),
      );

      expect(vusParUnAutre.some((tableau) => tableau.id === cree.id)).toBe(false);
    });
  });

  describe('Actions massives', () => {
    it('applique l’urgence et laisse la matrice dériver la priorité', async () => {
      const resultat = await commeIntervenant(() =>
        bulk.apply({
          ids: [ids.ticketA, ids.ticketB],
          operation: { action: 'setUrgency', value: 5 },
        }),
      );

      expect(resultat.applied).toBe(2);
      expect(resultat.failures).toHaveLength(0);

      const detail = await commeIntervenant(() => tickets.findById(ids.ticketA));

      expect(detail.urgency).toBe(5);
      expect(detail.priority).toBeGreaterThanOrEqual(4);
    });

    it('rapporte chaque échec sans interrompre la série', async () => {
      const resultat = await commeIntervenant(() =>
        bulk.apply({ ids: [ids.ticketA, 999_999_999], operation: { action: 'delete' } }),
      );

      expect(resultat.applied).toBe(1);
      expect(resultat.failures).toHaveLength(1);
      expect(resultat.failures[0]?.id).toBe(999_999_999);
    });
  });
});
