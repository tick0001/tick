import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { profileRights, profiles, sql, users } from '@tick/db';
import { RightsService } from '../auth/rights.service.js';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { EntitiesService } from '../entities/entities.service.js';
import { ItilObjectsService } from '../itil/itil-objects.service.js';
import { LinksService } from '../itil/links.service.js';
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
import { TimelineService } from '../tickets/timeline.service.js';
import { createFixture, type Fixture } from './fixtures.js';

/**
 * Problèmes, changements, liens et promotion.
 *
 * Ce qui se casse en silence ici : un satellite qui vise la mauvaise table et
 * fait apparaître le suivi d'un ticket sur le problème portant le même numéro,
 * et une promotion qui déplace au lieu de dupliquer, laissant le demandeur
 * d'origine sans réponse.
 */
describe('Objets ITIL', () => {
  let fixture: Fixture;
  let objets: ItilObjectsService;
  let liens: LinksService;
  let tickets: TicketsService;
  let timeline: TimelineService;

  const ids = {
    profilComplet: 0,
    profilLecteur: 0,
    intervenant: 0,
    demandeur: 0,
    ticket: 0,
    probleme: 0,
    changement: 0,
  };

  const dans = async <T>(
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
        scope: { subtreePaths: [path], exactPaths: [] },
      },
      work,
    );
  };

  const commeIntervenant = <T>(work: () => Promise<T>): Promise<T> =>
    dans(ids.profilComplet, ids.intervenant, 'siteA', work);

  beforeAll(async () => {
    fixture = await createFixture('ITL');

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

    objets = new ItilObjectsService(db, history, priority, scopes);
    liens = new LinksService(db, history, objets, scopes);
    timeline = new TimelineService(db, hooks, history, scopes);
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

    const creerProfil = async (
      nom: string,
      droits: readonly (readonly [string, string, 'own' | 'all'])[],
    ): Promise<number> => {
      const [ligne] = await fixture.owner.db
        .insert(profiles)
        .values({ name: `ITL ${nom} ${String(Date.now())}` })
        .returning({ id: profiles.id });

      const id = (ligne as { id: number }).id;

      await fixture.owner.db.insert(profileRights).values(
        droits.map(([object, action, scope]) => ({
          profileId: id,
          object,
          action,
          scope,
        })),
      );

      return id;
    };

    ids.profilComplet = await creerProfil('Complet', [
      ['ticket', 'read', 'all'],
      ['ticket', 'create', 'all'],
      ['ticket', 'update', 'all'],
      ['problem', 'read', 'all'],
      ['problem', 'create', 'all'],
      ['problem', 'update', 'all'],
      ['change', 'read', 'all'],
      ['change', 'create', 'all'],
      ['change', 'update', 'all'],
    ]);

    // Portee `own` : c'est un demandeur. Il ne doit voir ni les objets des
    // autres, ni les elements prives des siens.
    ids.profilLecteur = await creerProfil('Lecteur', [
      ['ticket', 'read', 'own'],
      ['problem', 'read', 'own'],
      ['change', 'read', 'own'],
    ]);

    const creerUtilisateur = async (nom: string): Promise<number> => {
      const [ligne] = await fixture.owner.db
        .insert(users)
        .values({ username: `itl-${nom}-${String(Date.now())}`, email: `${nom}@itil.test` })
        .returning({ id: users.id });

      return (ligne as { id: number }).id;
    };

    ids.intervenant = await creerUtilisateur('intervenant');
    ids.demandeur = await creerUtilisateur('demandeur');

    await commeIntervenant(async () => {
      const ticket = await tickets.create({
        name: 'ITL Messagerie inaccessible',
        content: 'Erreur 502 depuis les acces distants.',
        type: 'incident',
        urgency: 5,
        impact: 4,
        actors: [{ role: 'requester', actorType: 'user', actorId: ids.demandeur }],
      });

      ids.ticket = ticket.id;

      const probleme = await objets.create('problem', {
        name: 'ITL Instabilite du relais SMTP',
        content: 'Trois incidents en deux semaines.',
        urgency: 4,
        impact: 4,
        checklist: [],
        symptoms: 'Coupures de quelques minutes, sans trace applicative.',
      });

      ids.probleme = probleme.id;

      const changement = await objets.create('change', {
        name: 'ITL Bascule du relais SMTP',
        content: 'Migrer vers le relais de secours.',
        urgency: 3,
        impact: 4,
        checklist: [{ label: 'Prevenir les utilisateurs', done: false }],
        rollbackPlan: 'Repointer le champ MX sur l ancien relais.',
      });

      ids.changement = changement.id;
    });
  });

  /**
   * Le nettoyage suit les cles etrangeres, des satellites vers les porteurs.
   *
   * La fixture ne sait pas defaire ce que ce test a ecrit : elle retire les
   * entites, et un suivi qui les reference encore ferait echouer sa suppression
   * bien apres la derniere assertion, la ou la cause est la plus difficile a
   * relier a l'effet.
   */
  afterAll(async () => {
    const chemin = fixture.paths['racine'] as string;

    for (const table of [
      'itil_followups',
      'itil_tasks',
      'itil_solutions',
      'itil_validations',
      'logs',
    ]) {
      await fixture.owner.db.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE entity_path <@ ${chemin}::ltree`,
      );
    }

    for (const [type, table] of [
      ['ticket', 'tickets'],
      ['problem', 'problems'],
      ['change', 'changes'],
    ] as const) {
      await fixture.owner.db.execute(sql`
        DELETE FROM itil_links
         WHERE (source_type = ${type} AND source_id IN (
                 SELECT id FROM ${sql.raw(table)} WHERE entity_path <@ ${chemin}::ltree))
            OR (target_type = ${type} AND target_id IN (
                 SELECT id FROM ${sql.raw(table)} WHERE entity_path <@ ${chemin}::ltree))
      `);
      await fixture.owner.db.execute(sql`
        DELETE FROM itil_actors
         WHERE itil_type = ${type}
           AND itil_id IN (SELECT id FROM ${sql.raw(table)} WHERE entity_path <@ ${chemin}::ltree)
      `);
      await fixture.owner.db.execute(
        sql`DELETE FROM ${sql.raw(table)} WHERE entity_path <@ ${chemin}::ltree`,
      );
    }

    await fixture.cleanup();
  });

  describe('Socle commun', () => {
    it('écrit les champs propres au type, et ceux-là seulement', async () => {
      const probleme = await commeIntervenant(() => objets.findById('problem', ids.probleme));
      const changement = await commeIntervenant(() => objets.findById('change', ids.changement));

      expect(probleme.symptoms).toBe('Coupures de quelques minutes, sans trace applicative.');
      // Le plan de deploiement est une colonne de `changes` : le probleme ne
      // peut pas le porter, meme si le contrat le declare.
      expect(probleme.deploymentPlan).toBeNull();

      expect(changement.rollbackPlan).toBe('Repointer le champ MX sur l ancien relais.');
      expect(changement.checklist).toEqual([{ label: 'Prevenir les utilisateurs', done: false }]);
      expect(changement.symptoms).toBeNull();
    });

    it('dérive la priorité de l’urgence et de l’impact', async () => {
      const probleme = await commeIntervenant(() => objets.findById('problem', ids.probleme));

      expect(probleme.priority).toBe(4);
    });

    it('porte la chronologie du problème, sans mélange avec le ticket', async () => {
      await commeIntervenant(async () => {
        await timeline.addFollowup(
          ids.probleme,
          { content: 'ITL Analyse en cours cote reseau.', isPrivate: false, source: 'interface' },
          'problem',
        );
      });

      const surProbleme = await commeIntervenant(() =>
        timeline.timelineFor(ids.probleme, 'problem'),
      );
      const surTicket = await commeIntervenant(() => timeline.timelineFor(ids.ticket));

      expect(surProbleme.some((entree) => 'content' in entree && entree.content.includes('reseau')))
        .toBe(true);
      expect(surTicket.some((entree) => 'content' in entree && entree.content.includes('reseau')))
        .toBe(false);
    });

    it('cache les éléments privés au lecteur en portée « own »', async () => {
      await commeIntervenant(async () => {
        await timeline.addFollowup(
          ids.probleme,
          { content: 'ITL Note interne.', isPrivate: true, source: 'interface' },
          'problem',
        );
      });

      // Le demandeur est acteur du probleme, sinon il ne le verrait pas du tout.
      await commeIntervenant(() =>
        objets.setActors('problem', ids.probleme, [
          { role: 'requester', actorType: 'user', actorId: ids.demandeur },
        ]),
      );

      const vu = await dans(ids.profilLecteur, ids.demandeur, 'siteA', () =>
        timeline.timelineFor(ids.probleme, 'problem'),
      );

      expect(vu.some((entree) => 'content' in entree && entree.content.includes('Note interne')))
        .toBe(false);
    });
  });

  describe('Liens', () => {
    it('se lit depuis les deux bouts', async () => {
      await commeIntervenant(() =>
        liens.create('ticket', ids.ticket, {
          targetType: 'problem',
          targetId: ids.probleme,
          linkType: 'linked',
        }),
      );

      const depuisTicket = await commeIntervenant(() => liens.linksOf('ticket', ids.ticket));
      const depuisProbleme = await commeIntervenant(() => liens.linksOf('problem', ids.probleme));

      expect(depuisTicket).toContainEqual(
        expect.objectContaining({ targetType: 'problem', targetId: ids.probleme }),
      );
      expect(depuisProbleme).toContainEqual(
        expect.objectContaining({ targetType: 'ticket', targetId: ids.ticket }),
      );
    });

    it('refuse un objet lié à lui-même', async () => {
      await expect(
        commeIntervenant(() =>
          liens.create('problem', ids.probleme, {
            targetType: 'problem',
            targetId: ids.probleme,
            linkType: 'linked',
          }),
        ),
      ).rejects.toThrow(/lui-meme/i);
    });

    it('retire un lien depuis l’autre bout', async () => {
      const avant = await commeIntervenant(() => liens.linksOf('problem', ids.probleme));
      const lien = avant.find((valeur) => valeur.targetId === ids.ticket);

      await commeIntervenant(() => liens.remove('problem', ids.probleme, lien?.id ?? 0));

      const apres = await commeIntervenant(() => liens.linksOf('ticket', ids.ticket));

      expect(apres.some((valeur) => valeur.id === lien?.id)).toBe(false);
    });
  });

  describe('Promotion', () => {
    it('laisse l’original ouvert et reporte demandeurs, urgence et entité', async () => {
      const promu = await commeIntervenant(() =>
        liens.promote('ticket', ids.ticket, { to: 'problem' }),
      );

      const source = await commeIntervenant(() => tickets.findById(ids.ticket));
      const cible = await commeIntervenant(() => objets.findById('problem', promu.id));
      const acteurs = await commeIntervenant(() => objets.actorsOf('problem', promu.id));

      // L'incident reste a traiter : celui qui l'a signale attend toujours une
      // reponse, independamment de l'analyse de fond qui commence.
      expect(source.status).toBe('new');
      expect(cible.urgency).toBe(5);
      expect(cible.impact).toBe(4);
      expect(cible.entityId).toBe(source.entity.id);
      expect(acteurs.map((acteur) => acteur.actorId)).toContain(ids.demandeur);
      // Celui qui promeut n'est pas demandeur du probleme : il l'ouvre.
      expect(acteurs.some((acteur) => acteur.actorId === ids.intervenant)).toBe(false);

      const rattaches = await commeIntervenant(() => liens.linksOf('ticket', ids.ticket));

      expect(rattaches).toContainEqual(
        expect.objectContaining({ targetType: 'problem', targetId: promu.id }),
      );

      await fixture.owner.db.execute(sql`
        DELETE FROM itil_links WHERE target_type = 'problem' AND target_id = ${promu.id}
      `);
    });

    it('refuse de promouvoir vers le type déjà porté', async () => {
      await expect(
        commeIntervenant(() => liens.promote('problem', ids.probleme, { to: 'problem' })),
      ).rejects.toThrow(/deja de ce type/i);
    });
  });

  describe('Périmètre', () => {
    it('masque un problème hors du contexte de travail', async () => {
      const depuisSiteB = await dans(ids.profilComplet, ids.intervenant, 'siteB', () =>
        objets.list('problem', { deleted: false, limit: 50 }),
      );

      expect(depuisSiteB.some((objet) => objet.id === ids.probleme)).toBe(false);
    });
  });
});
