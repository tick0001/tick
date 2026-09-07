import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileRights, profiles, sql, users } from '@tick/db';
import { RightsService } from '../auth/rights.service.js';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { EntitiesService } from '../entities/entities.service.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { RuleCatalogService } from '../rules/rule-catalog.service.js';
import { RuleEngineService } from '../rules/rule-engine.service.js';
import { RulesService } from '../rules/rules.service.js';
import { EscalationService } from '../slm/escalation.service.js';
import { SlaService } from '../slm/sla.service.js';
import { SlmService } from '../slm/slm.service.js';
import { workingSecondsBetween, type WorkingCalendar } from '../slm/working-time.js';
import { ActorsService } from '../tickets/actors.service.js';
import { HistoryService } from '../tickets/history.service.js';
import { PriorityService } from '../tickets/priority.service.js';
import { TicketScopeService } from '../tickets/ticket-scope.service.js';
import { TicketTemplatesService } from '../tickets/ticket-templates.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { createFixture, type Fixture } from './fixtures.js';

const HEURE = 3600;

/**
 * Normalise un horodatage lu en SQL brut.
 *
 * Le pilote rend les horodatages sous forme de chaines : les comparer sans
 * conversion produirait des erreurs a l'execution plutot que des assertions.
 */
function date(valeur: unknown): Date {
  return valeur instanceof Date ? valeur : new Date(String(valeur));
}

/**
 * Niveaux de service et moteur de règles, de bout en bout.
 *
 * Ces deux mécanismes se testent ensemble parce qu'ils ne servent à rien l'un
 * sans l'autre : ce sont les règles qui décident quel engagement s'applique, et
 * l'engagement qui donne aux règles quelque chose à décider.
 */
describe('Niveaux de service et regles', () => {
  let fixture: Fixture;
  let db: DatabaseService;
  let slm: SlmService;
  let sla: SlaService;
  let regles: RulesService;
  let escalade: EscalationService;
  let tickets: TicketsService;

  const ids = { profil: 0, utilisateur: 0, calendrier: 0, tto: 0, ttrStandard: 0, ttrRapide: 0 };
  let calendrier: WorkingCalendar;

  /** Exécute le travail comme le ferait une requête dans l'entité donnée. */
  const dans = async <T>(cle: string, work: () => Promise<T>): Promise<T> => {
    const path = fixture.paths[cle] as string;

    return runWithContext(
      {
        sessionId: 'test',
        userId: ids.utilisateur,
        profileId: ids.profil,
        entityId: fixture.entityIds[cle] as number,
        entityPath: path,
        includeSubEntities: true,
        locale: 'fr',
        profileInterface: 'standard',
        scope: { subtreePaths: [path], exactPaths: [] },
      },
      work,
    );
  };

  beforeAll(async () => {
    fixture = await createFixture('SLM');
    db = new DatabaseService(fixture.app.db, fixture.owner.db, {
      owner: fixture.owner,
      app: fixture.app,
    });

    const hooks = new HookBus();
    const entites = new EntitiesService(db, hooks);
    const rights = new RightsService(db);

    slm = new SlmService(db);
    sla = new SlaService(db, slm);
    regles = new RulesService(db, new RuleCatalogService(), new RuleEngineService());
    escalade = new EscalationService(db, sla);
    const historique = new HistoryService();

    tickets = new TicketsService(
      db,
      hooks,
      historique,
      new PriorityService(entites),
      new TicketScopeService(db, rights),
      new TicketTemplatesService(db, entites),
      regles,
      sla,
      new ActorsService(db, historique),
    );

    const [profil] = await fixture.owner.db
      .insert(profiles)
      .values({ name: `SLM profil ${String(Date.now())}` })
      .returning({ id: profiles.id });
    ids.profil = (profil as { id: number }).id;

    await fixture.owner.db.insert(profileRights).values(
      (
        [
          ['ticket', 'read'],
          ['ticket', 'create'],
          ['ticket', 'update'],
          ['slm', 'read'],
          ['slm', 'update'],
          ['rule', 'read'],
          ['rule', 'update'],
        ] as const
      ).map(([object, action]) => ({
        profileId: ids.profil,
        object,
        action,
        scope: 'all' as const,
      })),
    );

    const [utilisateur] = await fixture.owner.db
      .insert(users)
      .values({ username: `slm-${String(Date.now())}` })
      .returning({ id: users.id });
    ids.utilisateur = (utilisateur as { id: number }).id;

    // Calendrier et engagements posés à la racine du jeu de test, récursifs :
    // c'est la configuration partagée que toute l'arborescence doit voir.
    const cree = await dans('racine', () =>
      slm.saveCalendar({
        name: 'Ouvre',
        timezone: 'Europe/Paris',
        isRecursive: true,
        segments: [1, 2, 3, 4, 5].flatMap((weekday) => [
          { weekday, beginAt: '08:00:00', endAt: '12:00:00' },
          { weekday, beginAt: '13:00:00', endAt: '18:00:00' },
        ]),
        holidays: [],
      }),
    );
    ids.calendrier = cree.id;
    calendrier = {
      timezone: cree.timezone,
      segments: cree.segments,
      holidays: cree.holidays.map((ferie) => ({ day: ferie.day, isPerpetual: ferie.isPerpetual })),
    };

    const engagement = async (
      kind: 'sla' | 'ola',
      axis: 'tto' | 'ttr',
      name: string,
      duration: number,
      levels: Parameters<SlmService['saveAgreement']>[0]['levels'] = [],
      calendarId: number | null = ids.calendrier,
    ): Promise<number> => {
      const ligne = await dans('racine', () =>
        slm.saveAgreement({
          kind,
          axis,
          name,
          duration,
          calendarId,
          isRecursive: true,
          levels,
        }),
      );

      return ligne.id;
    };

    ids.tto = await engagement('sla', 'tto', 'Prise en compte 2 h', 2 * HEURE);
    ids.ttrStandard = await engagement('sla', 'ttr', 'Resolution 8 h', 8 * HEURE);
    // Cet engagement compte en temps calendaire, sans calendrier : son niveau
    // se declenche quatre heures avant une echeance a quatre heures, donc des
    // l'ouverture, quelle que soit l'heure a laquelle le test tourne. Avec un
    // calendrier ouvre, l'echeance sauterait au lendemain matin et le balayage
    // n'aurait rien a traiter la nuit.
    ids.ttrRapide = await engagement(
      'sla',
      'ttr',
      'Resolution 4 h',
      4 * HEURE,
      [
        {
          name: 'Escalade immediate',
          offsetSeconds: -4 * HEURE,
          isActive: true,
          actions: [{ action: 'set_urgency', value: '5' }],
        },
      ],
      null,
    );
  }, 30_000);

  afterAll(async () => {
    const racine = fixture.paths['racine'] as string;

    await fixture.owner.db.execute(sql`
      DELETE FROM ticket_escalations WHERE ticket_id IN
        (SELECT id FROM tickets WHERE entity_path <@ ${racine}::ltree)
    `);
    await fixture.owner.db.execute(sql`DELETE FROM logs WHERE entity_path <@ ${racine}::ltree`);
    await fixture.owner.db.execute(
      sql`DELETE FROM itil_actors WHERE itil_id IN
            (SELECT id FROM tickets WHERE entity_path <@ ${racine}::ltree)`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM tickets WHERE entity_path <@ ${racine}::ltree`);
    await fixture.owner.db.execute(sql`DELETE FROM rules WHERE entity_path <@ ${racine}::ltree`);
    await fixture.owner.db.execute(
      sql`DELETE FROM agreements WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM calendars WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM users WHERE id = ${ids.utilisateur}`);
    await fixture.owner.db.execute(sql`DELETE FROM profiles WHERE id = ${ids.profil}`);
    await fixture.cleanup();
  });

  /** Crée une règle dans l'entité courante et renvoie son identifiant. */
  const creerRegle = async (
    cle: string,
    input: Parameters<RulesService['save']>[0],
  ): Promise<number> => {
    const regle = await dans(cle, () => regles.save(input));

    return regle.id;
  };

  const echeancesDe = async (
    ticketId: number,
  ): Promise<{ dateOpened: Date; dateDue: Date | null; dateDueOwn: Date | null }> => {
    const resultat = await fixture.owner.db.execute<Record<string, unknown>>(sql`
      SELECT date_opened AS "dateOpened", date_due AS "dateDue",
             date_due_own AS "dateDueOwn"
        FROM tickets WHERE id = ${ticketId}
    `);

    const ligne = resultat.rows[0] as Record<string, unknown>;

    return {
      dateOpened: date(ligne['dateOpened']),
      dateDue: ligne['dateDue'] === null ? null : date(ligne['dateDue']),
      dateDueOwn: ligne['dateDueOwn'] === null ? null : date(ligne['dateDueOwn']),
    };
  };

  describe('engagements', () => {
    it('pose les echeances decidees par une regle, en temps ouvre', async () => {
      await creerRegle('racine', {
        collection: 'ticket.create',
        name: 'Engagements standard',
        ranking: 10,
        isActive: true,
        matchAll: true,
        stopAfter: false,
        isRecursive: true,
        criteria: [],
        actions: [
          { field: 'slaTtoId', action: 'assign', value: String(ids.tto) },
          { field: 'slaTtrId', action: 'assign', value: String(ids.ttrStandard) },
        ],
      });

      const ticket = await dans('siteA', () =>
        tickets.create({
          name: 'Poste inutilisable',
          content: 'Ecran noir au demarrage.',
          type: 'incident',
          urgency: 3,
          impact: 3,
          actors: [],
        }),
      );

      const echeances = await echeancesDe(ticket.id);

      expect(echeances.dateDue).not.toBeNull();
      expect(echeances.dateDueOwn).not.toBeNull();

      // Le controle porte sur la duree **ouvree** separant l'ouverture de
      // l'echeance : une comparaison calendaire passerait a cote du week-end.
      expect(
        workingSecondsBetween(calendrier, echeances.dateOpened, echeances.dateDue as Date),
      ).toBe(8 * HEURE);
      expect(
        workingSecondsBetween(calendrier, echeances.dateOpened, echeances.dateDueOwn as Date),
      ).toBe(2 * HEURE);
    });

    it("repousse l'echeance du temps passe en attente", async () => {
      const ticket = await dans('siteA', () =>
        tickets.create({
          name: 'Fournisseur a relancer',
          content: 'En attente de piece.',
          type: 'incident',
          urgency: 3,
          impact: 3,
          actors: [],
        }),
      );

      const avant = await echeancesDe(ticket.id);

      // Une heure ouvree d'attente, posee directement : attendre reellement
      // rendrait le test tributaire de l'horloge.
      await fixture.owner.db.execute(
        sql`UPDATE tickets SET waiting_duration = ${HEURE} WHERE id = ${ticket.id}`,
      );
      await sla.refresh(ticket.id);

      const apres = await echeancesDe(ticket.id);

      expect(workingSecondsBetween(calendrier, avant.dateDue as Date, apres.dateDue as Date)).toBe(
        HEURE,
      );
    });

    it('rend le temps restant et signale un depassement', async () => {
      const ticket = await dans('siteA', () =>
        tickets.create({
          name: 'Suivi des engagements',
          content: 'Verification de l affichage.',
          type: 'incident',
          urgency: 3,
          impact: 3,
          actors: [],
        }),
      );

      const etats = await dans('siteA', () => sla.statusOf(ticket.id));

      expect(etats.map((etat) => etat.axis).sort()).toEqual(['tto', 'ttr']);
      for (const etat of etats) {
        expect(etat.isBreached).toBe(false);
        expect(etat.remainingSeconds).toBeGreaterThan(0);
      }

      // Echeance ramenee dans le passe : l'axe non satisfait devient depasse.
      await fixture.owner.db.execute(
        sql`UPDATE tickets SET date_due = now() - interval '1 hour' WHERE id = ${ticket.id}`,
      );

      const apres = await dans('siteA', () => sla.statusOf(ticket.id));
      const resolution = apres.find((etat) => etat.axis === 'ttr');

      expect(resolution?.isBreached).toBe(true);
      expect(resolution?.remainingSeconds).toBeLessThanOrEqual(0);
    });
  });

  describe('escalade', () => {
    it('execute un niveau echu, une seule fois', async () => {
      await creerRegle('siteB', {
        collection: 'ticket.create',
        name: 'Resolution rapide sur Site B',
        ranking: 20,
        isActive: true,
        matchAll: true,
        stopAfter: false,
        isRecursive: false,
        criteria: [],
        actions: [{ field: 'slaTtrId', action: 'assign', value: String(ids.ttrRapide) }],
      });

      const ticket = await dans('siteB', () =>
        tickets.create({
          name: 'Incident a escalader',
          content: 'Doit declencher le niveau immediat.',
          type: 'incident',
          urgency: 2,
          impact: 2,
          actors: [],
        }),
      );

      const traces = async (): Promise<number> => {
        const resultat = await fixture.owner.db.execute<{ total: number }>(
          sql`SELECT count(*)::int AS total FROM ticket_escalations WHERE ticket_id = ${ticket.id}`,
        );

        return resultat.rows[0]?.total ?? 0;
      };

      const urgenceDe = async (): Promise<number> => {
        const resultat = await fixture.owner.db.execute<{ urgency: number }>(
          sql`SELECT urgency FROM tickets WHERE id = ${ticket.id}`,
        );

        return resultat.rows[0]?.urgency ?? 0;
      };

      expect(await traces()).toBe(0);

      // L'echeance d'escalade a bien ete planifiee, et elle est due.
      const planifie = await fixture.owner.db.execute<Record<string, unknown>>(
        sql`SELECT escalation_at AS "at" FROM tickets WHERE id = ${ticket.id}`,
      );

      expect(planifie.rows[0]?.['at']).not.toBeNull();
      expect(date(planifie.rows[0]?.['at']).getTime()).toBeLessThanOrEqual(Date.now());

      await escalade.sweep();

      expect(await traces()).toBe(1);
      expect(await urgenceDe()).toBe(5);

      // Second passage : la trace empeche le rejeu, et l'urgence ne bouge plus.
      await escalade.sweep();

      expect(await traces()).toBe(1);
    });

    it("n'escalade pas un ticket clos", async () => {
      const ticket = await dans('siteB', () =>
        tickets.create({
          name: 'Incident clos avant escalade',
          content: 'Ne doit pas etre escalade.',
          type: 'incident',
          urgency: 2,
          impact: 2,
          actors: [],
        }),
      );

      await fixture.owner.db.execute(
        sql`UPDATE tickets SET status = 'closed' WHERE id = ${ticket.id}`,
      );
      await escalade.sweep();

      const resultat = await fixture.owner.db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM ticket_escalations WHERE ticket_id = ${ticket.id}`,
      );

      expect(resultat.rows[0]?.total).toBe(0);
    });
  });

  describe('regles', () => {
    it('normalise le titre par le dictionnaire avant toute autre regle', async () => {
      await creerRegle('racine', {
        collection: 'dictionary.ticket',
        name: 'Retirer le prefixe de reponse',
        ranking: 10,
        isActive: true,
        matchAll: true,
        stopAfter: false,
        isRecursive: true,
        criteria: [{ field: 'name', operator: 'regex', value: '^(?:re|tr)\\s*:\\s*(.+)$' }],
        actions: [{ field: 'name', action: 'regex_result', value: '#1' }],
      });

      const ticket = await dans('siteA', () =>
        tickets.create({
          name: 'RE: Imprimante bloquee',
          content: 'Recu par courriel.',
          type: 'incident',
          urgency: 3,
          impact: 3,
          actors: [],
        }),
      );

      expect(ticket.name).toBe('Imprimante bloquee');
    });

    it('applique une regle conditionnelle, et seulement quand elle correspond', async () => {
      await creerRegle('racine', {
        collection: 'ticket.create',
        name: 'Une panne bloquante est tres urgente',
        ranking: 30,
        isActive: true,
        matchAll: true,
        stopAfter: false,
        isRecursive: true,
        criteria: [
          { field: 'name', operator: 'contains', value: 'bloquant' },
          { field: 'type', operator: 'is', value: 'incident' },
        ],
        actions: [{ field: 'urgency', action: 'assign', value: '5' }],
      });

      const bloquant = await dans('siteA', () =>
        tickets.create({
          name: 'Incident bloquant en production',
          content: 'Service indisponible.',
          type: 'incident',
          urgency: 2,
          impact: 2,
          actors: [],
        }),
      );

      const ordinaire = await dans('siteA', () =>
        tickets.create({
          name: 'Question sur un logiciel',
          content: 'Simple demande.',
          type: 'request',
          urgency: 2,
          impact: 2,
          actors: [],
        }),
      );

      expect(bloquant.urgency).toBe(5);
      // La priorite suit l'urgence relevee : une regle qui change l'un sans
      // l'autre laisserait un ticket incoherent avec lui-meme.
      expect(bloquant.priority).toBeGreaterThan(ordinaire.priority);
      expect(ordinaire.urgency).toBe(2);
    });

    it('affecte un groupe, qui devient acteur du ticket', async () => {
      const groupe = fixture.groupIds['equipeA'] as number;

      await creerRegle('siteA', {
        collection: 'ticket.create',
        name: 'Aiguillage vers l equipe du site',
        ranking: 40,
        isActive: true,
        matchAll: true,
        stopAfter: false,
        isRecursive: false,
        criteria: [{ field: 'content', operator: 'contains', value: 'imprimante' }],
        actions: [{ field: 'assignedGroupId', action: 'assign', value: String(groupe) }],
      });

      const ticket = await dans('siteA', () =>
        tickets.create({
          name: 'Bourrage papier',
          content: 'Imprimante du couloir.',
          type: 'incident',
          urgency: 3,
          impact: 3,
          actors: [],
        }),
      );

      const acteurs = await dans('siteA', () => tickets.actorsOf(ticket.id));

      expect(
        acteurs.some((acteur) => acteur.role === 'assigned' && acteur.actorId === groupe),
      ).toBe(true);
    });

    it('explique une decision par le simulateur, sans rien ecrire', async () => {
      const avant = await fixture.owner.db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM tickets
             WHERE entity_path <@ ${fixture.paths['racine'] as string}::ltree`,
      );

      const resultat = await dans('siteA', () =>
        regles.simulate('ticket.create', {
          name: 'Incident bloquant sur le stockage',
          type: 'incident',
        }),
      );

      const trace = resultat.traces.find(
        (ligne) => ligne.name === 'Une panne bloquante est tres urgente',
      );

      expect(trace?.matched).toBe(true);
      expect(trace?.criteria.every((critere) => critere.matched)).toBe(true);
      expect(resultat.output['urgency']).toBe('5');

      const apres = await fixture.owner.db.execute<{ total: number }>(
        sql`SELECT count(*)::int AS total FROM tickets
             WHERE entity_path <@ ${fixture.paths['racine'] as string}::ltree`,
      );

      expect(apres.rows[0]?.total).toBe(avant.rows[0]?.total);
    });

    it('refuse un champ inconnu ou un operateur inapplicable', async () => {
      await expect(
        dans('racine', () =>
          regles.save({
            collection: 'ticket.create',
            name: 'Champ invente',
            ranking: 90,
            isActive: true,
            matchAll: true,
            stopAfter: false,
            isRecursive: false,
            criteria: [{ field: 'couleurDuTicket', operator: 'is', value: 'bleu' }],
            actions: [{ field: 'urgency', action: 'assign', value: '5' }],
          }),
        ),
      ).rejects.toThrow(/Champ inconnu/);

      await expect(
        dans('racine', () =>
          regles.save({
            collection: 'ticket.create',
            name: 'Operateur hors sujet',
            ranking: 91,
            isActive: true,
            matchAll: true,
            stopAfter: false,
            isRecursive: false,
            criteria: [{ field: 'urgency', operator: 'contains', value: '5' }],
            actions: [{ field: 'urgency', action: 'assign', value: '5' }],
          }),
        ),
      ).rejects.toThrow(/inapplicable/);
    });

    it('ne laisse pas voir une regle locale depuis une entite soeur', async () => {
      await creerRegle('siteA', {
        collection: 'ticket.update',
        name: 'Regle propre au Site A',
        ranking: 50,
        isActive: true,
        matchAll: true,
        stopAfter: false,
        isRecursive: false,
        criteria: [],
        actions: [{ field: 'urgency', action: 'assign', value: '4' }],
      });

      const depuisA = await dans('siteA', () => regles.list('ticket.update'));
      const depuisB = await dans('siteB', () => regles.list('ticket.update'));

      expect(depuisA.map((regle) => regle.name)).toContain('Regle propre au Site A');
      expect(depuisB.map((regle) => regle.name)).not.toContain('Regle propre au Site A');
    });
  });
});
