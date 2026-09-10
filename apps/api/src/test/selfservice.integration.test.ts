import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupMembers, profileRights, profiles, sql, users } from '@tick/db';
import { RightsService } from '../auth/rights.service.js';
import { runWithContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { EntitiesService } from '../entities/entities.service.js';
import { FormsService } from '../forms/forms.service.js';
import { KnowledgeService } from '../knowledge/knowledge.service.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { RuleCatalogService } from '../rules/rule-catalog.service.js';
import { RuleEngineService } from '../rules/rule-engine.service.js';
import { RulesService } from '../rules/rules.service.js';
import { SlaService } from '../slm/sla.service.js';
import { SlmService } from '../slm/slm.service.js';
import { ActorsService } from '../tickets/actors.service.js';
import { HistoryService } from '../tickets/history.service.js';
import { PriorityService } from '../tickets/priority.service.js';
import { TicketScopeService } from '../tickets/ticket-scope.service.js';
import { TicketTemplatesService } from '../tickets/ticket-templates.service.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { createFixture, type Fixture } from './fixtures.js';

/**
 * Self-service : connaissance et formulaires.
 *
 * Ce qui se casse en silence ici, c'est la **visibilité** : un article réservé
 * qui fuit, un brouillon publié par inadvertance, un formulaire proposé à
 * quelqu'un qui ne peut pas le remplir. D'où le poids des cas de ciblage.
 */
describe('Self-service', () => {
  let fixture: Fixture;
  let knowledge: KnowledgeService;
  let formsService: FormsService;

  const ids = {
    profilTechnicien: 0,
    profilDemandeur: 0,
    technicien: 0,
    demandeur: 0,
    categorie: 0,
    article: 0,
    articleReserve: 0,
    brouillon: 0,
    faq: 0,
    formulaire: 0,
    formulaireReserve: 0,
  };

  /** Exécute le travail comme le ferait une requête, avec le profil choisi. */
  const dans = async <T>(
    profileId: number,
    userId: number,
    work: () => Promise<T>,
    locale: 'fr' | 'en' = 'fr',
  ): Promise<T> => {
    const path = fixture.paths['siteA'] as string;

    return runWithContext(
      {
        sessionId: 'test',
        userId,
        profileId,
        entityId: fixture.entityIds['siteA'] as number,
        entityPath: path,
        includeSubEntities: true,
        locale,
        profileInterface: 'standard',
        scope: { subtreePaths: [path], exactPaths: [] },
      },
      work,
    );
  };

  const commeTechnicien = <T>(work: () => Promise<T>): Promise<T> =>
    dans(ids.profilTechnicien, ids.technicien, work);
  const commeDemandeur = <T>(work: () => Promise<T>): Promise<T> =>
    dans(ids.profilDemandeur, ids.demandeur, work);

  beforeAll(async () => {
    fixture = await createFixture('SLF');

    const db = new DatabaseService(fixture.app.db, fixture.owner.db, {
      owner: fixture.owner,
      app: fixture.app,
    });

    const hooks = new HookBus();
    const entites = new EntitiesService(db, hooks);
    const rights = new RightsService(db);

    const historique = new HistoryService();

    knowledge = new KnowledgeService(db);
    formsService = new FormsService(
      db,
      new TicketsService(
        db,
        hooks,
        historique,
        new PriorityService(entites),
        new TicketScopeService(db, rights),
        new TicketTemplatesService(db, entites),
        new RulesService(db, new RuleCatalogService(), new RuleEngineService()),
        new SlaService(db, new SlmService(db)),
        new ActorsService(db, historique),
      ),
    );

    const creerProfil = async (nom: string): Promise<number> => {
      const [ligne] = await fixture.owner.db
        .insert(profiles)
        .values({ name: `SLF ${nom} ${String(Date.now())}` })
        .returning({ id: profiles.id });

      const id = (ligne as { id: number }).id;

      await fixture.owner.db.insert(profileRights).values(
        (
          [
            ['kb', 'read'],
            ['kb', 'update'],
            ['form', 'read'],
            ['form', 'update'],
            ['ticket', 'create'],
            ['ticket', 'read'],
          ] as const
        ).map(([object, action]) => ({
          profileId: id,
          object,
          action,
          scope: 'all' as const,
        })),
      );

      return id;
    };

    ids.profilTechnicien = await creerProfil('Technicien');
    ids.profilDemandeur = await creerProfil('Demandeur');

    const creerUtilisateur = async (nom: string): Promise<number> => {
      const [ligne] = await fixture.owner.db
        .insert(users)
        .values({ username: `slf-${nom}-${String(Date.now())}`, email: `${nom}@self.test` })
        .returning({ id: users.id });

      return (ligne as { id: number }).id;
    };

    ids.technicien = await creerUtilisateur('technicien');
    ids.demandeur = await creerUtilisateur('demandeur');

    await fixture.owner.db.insert(groupMembers).values({
      userId: ids.technicien,
      groupId: fixture.groupIds['equipeA'] as number,
    });

    // Toute la configuration est posee a la racine, recursive : c'est ainsi
    // qu'un article ou un formulaire ecrit une fois sert toute l'organisation.
    await dans(ids.profilTechnicien, ids.technicien, async () => {
      const categorie = await knowledge.saveCategory({ name: 'SLF Procedures', isRecursive: true });

      ids.categorie = categorie.id;
    });

    const ecrire = async (patch: Parameters<KnowledgeService['save']>[0]): Promise<number> => {
      const article = await commeTechnicien(() => knowledge.save(patch));

      return article.id;
    };

    ids.article = await ecrire({
      name: 'SLF Article ouvert',
      content: 'Visible de tout le perimetre.',
      categoryId: ids.categorie,
      isFaq: false,
      isPublished: true,
      isRecursive: true,
      targets: [],
    });

    ids.articleReserve = await ecrire({
      name: 'SLF Article reserve aux techniciens',
      content: 'Procedure interne, avec des details qui ne regardent pas le demandeur.',
      categoryId: ids.categorie,
      isFaq: false,
      isPublished: true,
      isRecursive: true,
      targets: [{ targetType: 'profile', targetId: ids.profilTechnicien }],
    });

    ids.brouillon = await ecrire({
      name: 'SLF Brouillon',
      content: 'Pas encore relu.',
      categoryId: ids.categorie,
      isFaq: false,
      isPublished: false,
      isRecursive: true,
      targets: [],
    });

    ids.faq = await ecrire({
      name: 'SLF Question frequente',
      content: 'Reponse publiee pour tout le monde.',
      categoryId: ids.categorie,
      isFaq: true,
      isPublished: true,
      isRecursive: true,
      targets: [],
    });
  }, 30_000);

  afterAll(async () => {
    const racine = fixture.paths['racine'] as string;

    await fixture.owner.db.execute(
      sql`DELETE FROM form_submissions WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM forms WHERE entity_path <@ ${racine}::ltree`);
    await fixture.owner.db.execute(
      sql`DELETE FROM kb_articles WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM kb_categories WHERE entity_path <@ ${racine}::ltree`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM logs WHERE entity_path <@ ${racine}::ltree`);
    await fixture.owner.db.execute(
      sql`DELETE FROM itil_actors WHERE itil_id IN
            (SELECT id FROM tickets WHERE entity_path <@ ${racine}::ltree)`,
    );
    await fixture.owner.db.execute(sql`DELETE FROM tickets WHERE entity_path <@ ${racine}::ltree`);
    await fixture.owner.db.execute(
      sql`DELETE FROM group_members WHERE user_id = ${ids.technicien}`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM users WHERE id IN (${ids.technicien}, ${ids.demandeur})`,
    );
    await fixture.owner.db.execute(
      sql`DELETE FROM profiles WHERE id IN (${ids.profilTechnicien}, ${ids.profilDemandeur})`,
    );
    await fixture.cleanup();
  });

  describe('base de connaissances', () => {
    it('montre a chacun les articles qui lui sont destines', async () => {
      const vusParTechnicien = (
        await commeTechnicien(() =>
          knowledge.list({ limit: 50, faqOnly: false, favoritesOnly: false }),
        )
      ).map((article) => article.name);
      const vusParDemandeur = (
        await commeDemandeur(() =>
          knowledge.list({ limit: 50, faqOnly: false, favoritesOnly: false }),
        )
      ).map((article) => article.name);

      expect(vusParTechnicien).toContain('SLF Article ouvert');
      expect(vusParTechnicien).toContain('SLF Article reserve aux techniciens');

      expect(vusParDemandeur).toContain('SLF Article ouvert');
      // Le ciblage n'est pas un classement : l'article ne doit pas apparaitre.
      expect(vusParDemandeur).not.toContain('SLF Article reserve aux techniciens');
    });

    it('refuse la lecture directe d’un article non destine', async () => {
      await expect(commeDemandeur(() => knowledge.findById(ids.articleReserve))).rejects.toThrow(
        /introuvable/i,
      );
    });

    it('garde un brouillon pour son seul auteur', async () => {
      const vusParAuteur = (
        await commeTechnicien(() =>
          knowledge.list({ limit: 50, faqOnly: false, favoritesOnly: false }),
        )
      ).map((article) => article.name);
      const vusParAutre = (
        await commeDemandeur(() =>
          knowledge.list({ limit: 50, faqOnly: false, favoritesOnly: false }),
        )
      ).map((article) => article.name);

      expect(vusParAuteur).toContain('SLF Brouillon');
      expect(vusParAutre).not.toContain('SLF Brouillon');
    });

    it('conserve l’etat precedent a chaque modification', async () => {
      await commeTechnicien(() =>
        knowledge.save(
          {
            name: 'SLF Article ouvert (corrige)',
            content: 'Contenu revu.',
            categoryId: ids.categorie,
            isFaq: false,
            isPublished: true,
            isRecursive: true,
            targets: [],
          },
          ids.article,
        ),
      );

      const revisions = await commeTechnicien(() => knowledge.revisions(ids.article));

      expect(revisions).toHaveLength(1);
      // La revision garde ce que l'article disait **avant** : c'est tout
      // l'interet, et l'inverse serait un doublon de l'etat courant.
      expect(revisions[0]?.name).toBe('SLF Article ouvert');
      expect(revisions[0]?.content).toBe('Visible de tout le perimetre.');
    });

    it('compte les consultations, et seulement elles', async () => {
      const avant = await commeTechnicien(() => knowledge.findById(ids.faq));
      const lu = await commeTechnicien(() => knowledge.read(ids.faq));

      expect(lu.viewCount).toBe(avant.viewCount + 1);

      // `findById` sert aussi a l'edition et a l'apercu : il ne doit pas gonfler
      // un chiffre cense mesurer l'usage reel.
      const apres = await commeTechnicien(() => knowledge.findById(ids.faq));

      expect(apres.viewCount).toBe(lu.viewCount);
    });

    it('bascule un favori, et le retire', async () => {
      expect(await commeDemandeur(() => knowledge.toggleFavorite(ids.article))).toBe(true);

      const favoris = await commeDemandeur(() =>
        knowledge.list({ limit: 50, faqOnly: false, favoritesOnly: true }),
      );

      expect(favoris.map((article) => article.id)).toEqual([ids.article]);
      expect(await commeDemandeur(() => knowledge.toggleFavorite(ids.article))).toBe(false);
    });

    it('ne publie dans la FAQ que ce qui y a ete mis', async () => {
      const publics = (await knowledge.publicList()).map((article) => article.name);

      expect(publics).toContain('SLF Question frequente');
      expect(publics).not.toContain('SLF Article ouvert (corrige)');
      expect(publics).not.toContain('SLF Article reserve aux techniciens');
      expect(publics).not.toContain('SLF Brouillon');
    });
  });

  describe('formulaires', () => {
    beforeAll(async () => {
      const ouvert = await commeTechnicien(() =>
        formsService.save({
          name: 'SLF Demande ouverte',
          description: null,
          category: 'Test',
          isActive: true,
          ranking: 10,
          isRecursive: true,
          access: [],
          translations: [],
          sections: [
            {
              name: 'Questions',
              description: null,
              translations: [],
              questions: [
                {
                  kind: 'select',
                  label: 'Nature',
                  description: null,
                  isRequired: true,
                  options: ['Standard', 'Autre'],
                  defaultValue: null,
                  translations: [],
                  conditions: [],
                },
                {
                  kind: 'text',
                  label: 'Precisez',
                  description: null,
                  isRequired: true,
                  options: [],
                  defaultValue: null,
                  // Ne s'affiche que si « Autre » : exiger une reponse a une
                  // question cachee bloquerait la soumission sans rien montrer.
                  translations: [],
                  conditions: [{ dependsOn: 0, operator: 'is', value: 'Autre' }],
                },
                {
                  kind: 'urgency',
                  label: 'Urgence',
                  description: null,
                  isRequired: false,
                  options: [],
                  defaultValue: '3',
                  translations: [],
                  conditions: [],
                },
              ],
            },
          ],
          destinations: [
            {
              kind: 'ticket',
              mappings: [
                { field: 'type', source: 'literal', value: 'request', question: null },
                { field: 'urgency', source: 'question', question: 2, value: null },
              ],
            },
          ],
        }),
      );

      ids.formulaire = ouvert.id;

      const reserve = await commeTechnicien(() =>
        formsService.save({
          name: 'SLF Demande reservee',
          description: null,
          category: 'Test',
          isActive: true,
          ranking: 20,
          isRecursive: true,
          access: [{ targetType: 'profile', targetId: ids.profilTechnicien }],
          translations: [],
          sections: [
            {
              name: 'Questions',
              description: null,
              translations: [],
              questions: [
                {
                  kind: 'text',
                  label: 'Objet',
                  description: null,
                  isRequired: false,
                  options: [],
                  defaultValue: null,
                  translations: [],
                  conditions: [],
                },
              ],
            },
          ],
          destinations: [],
        }),
      );

      ids.formulaireReserve = reserve.id;
    }, 30_000);

    it('n’offre au catalogue que les formulaires accessibles', async () => {
      const pourTechnicien = (await commeTechnicien(() => formsService.catalogue())).map(
        (forme) => forme.name,
      );
      const pourDemandeur = (await commeDemandeur(() => formsService.catalogue())).map(
        (forme) => forme.name,
      );

      expect(pourTechnicien).toEqual(
        expect.arrayContaining(['SLF Demande ouverte', 'SLF Demande reservee']),
      );
      expect(pourDemandeur).toContain('SLF Demande ouverte');
      expect(pourDemandeur).not.toContain('SLF Demande reservee');
    });

    it('refuse d’ouvrir un formulaire non accessible', async () => {
      await expect(
        commeDemandeur(() => formsService.render(ids.formulaireReserve)),
      ).rejects.toThrow(/introuvable|accessible/i);
    });

    it('rend les conditions par rang, pas par identifiant', async () => {
      const forme = await commeDemandeur(() => formsService.render(ids.formulaire));
      const questions = forme.sections.flatMap((section) => section.questions);

      // L'interface compose un formulaire avant que ses questions existent :
      // elle ne peut designer une dependance que par sa position.
      expect(questions[1]?.conditions).toEqual([{ dependsOn: 0, operator: 'is', value: 'Autre' }]);
    });

    it('n’exige pas une reponse a une question masquee', async () => {
      const resultat = await commeDemandeur(() =>
        formsService.submit(ids.formulaire, { answers: { '0': 'Standard', '2': '4' } }),
      );

      expect(resultat.ticketId).toBeGreaterThan(0);

      const ticket = await fixture.owner.db.execute<{
        name: string;
        type: string;
        urgency: number;
        content: string;
      }>(sql`
        SELECT name, type::text AS type, urgency, content
          FROM tickets WHERE id = ${resultat.ticketId}
      `);

      const ligne = ticket.rows[0];

      // Sans correspondance sur le titre, le nom du formulaire fait l'affaire.
      expect(ligne?.name).toBe('SLF Demande ouverte');
      expect(ligne?.type).toBe('request');
      expect(ligne?.urgency).toBe(4);
      // La description reprend les reponses : un formulaire rempli ne doit pas
      // produire un ticket vide.
      expect(ligne?.content).toContain('Nature : Standard');
    });

    it('exige une reponse a une question rendue visible par une condition', async () => {
      await expect(
        commeDemandeur(() =>
          formsService.submit(ids.formulaire, { answers: { '0': 'Autre', '2': '3' } }),
        ),
      ).rejects.toThrow(/obligatoire/i);
    });

    it('conserve les reponses completes, meme celles qu’aucune correspondance ne reprend', async () => {
      const resultat = await commeDemandeur(() =>
        formsService.submit(ids.formulaire, {
          answers: { '0': 'Autre', '1': 'Un cas particulier', '2': '2' },
        }),
      );

      const soumission = await fixture.owner.db.execute<{ answers: Record<string, unknown> }>(sql`
        SELECT answers FROM form_submissions WHERE ticket_id = ${resultat.ticketId}
      `);

      expect(soumission.rows[0]?.answers).toEqual({
        '0': 'Autre',
        '1': 'Un cas particulier',
        '2': '2',
      });
    });
  });

  describe('Traductions des libelles', () => {
    it("sert la langue du lecteur, et l'original a l'editeur", async () => {
      const cree = await commeTechnicien(() =>
        formsService.save({
          name: 'Demande de materiel',
          description: 'Ecran, clavier, souris',
          category: 'Materiel',
          isActive: true,
          ranking: 0,
          isRecursive: true,
          access: [],
          destinations: [],
          translations: [
            { locale: 'en', label: 'Hardware request', description: 'Screen, keyboard, mouse' },
          ],
          sections: [
            {
              name: 'Votre besoin',
              description: null,
              translations: [{ locale: 'en', label: 'What you need', description: null }],
              questions: [
                {
                  kind: 'text',
                  label: 'Quel materiel ?',
                  description: null,
                  isRequired: true,
                  options: [],
                  defaultValue: null,
                  translations: [{ locale: 'en', label: 'Which hardware?', description: null }],
                  conditions: [],
                },
              ],
            },
          ],
        }),
      );

      // L'editeur voit la saisie d'origine, et la traduction a cote. Servir la
      // traduction ici la ferait reenregistrer a la place de l'original au
      // premier enregistrement.
      const pourEditeur = await commeTechnicien(() => formsService.findById(cree.id));

      expect(pourEditeur.name).toBe('Demande de materiel');
      expect(pourEditeur.translations).toEqual([
        { locale: 'en', label: 'Hardware request', description: 'Screen, keyboard, mouse' },
      ]);
      expect(pourEditeur.sections[0]?.questions[0]?.label).toBe('Quel materiel ?');

      // Le demandeur anglophone recoit les libelles traduits.
      const enAnglais = await dans(
        ids.profilDemandeur,
        ids.demandeur,
        () => formsService.render(cree.id),
        'en',
      );

      expect(enAnglais.name).toBe('Hardware request');
      expect(enAnglais.sections[0]?.name).toBe('What you need');
      expect(enAnglais.sections[0]?.questions[0]?.label).toBe('Which hardware?');

      // Le francophone garde la saisie d'origine.
      const enFrancais = await commeDemandeur(() => formsService.render(cree.id));

      expect(enFrancais.name).toBe('Demande de materiel');
      expect(enFrancais.sections[0]?.questions[0]?.label).toBe('Quel materiel ?');

      // Et la **liste** du catalogue traduit elle aussi. C'est le seul endroit
      // ou le demandeur lit ce nom pour choisir : servir l'original ici et la
      // traduction apres le clic fait changer le titre de langue sous ses yeux,
      // et laisse un lecteur anglophone chercher dans une liste en francais.
      const catalogueAnglais = await dans(
        ids.profilDemandeur,
        ids.demandeur,
        () => formsService.catalogue(),
        'en',
      );

      expect(catalogueAnglais.find((f) => f.id === cree.id)?.name).toBe('Hardware request');

      const catalogueFrancais = await commeDemandeur(() => formsService.catalogue());

      expect(catalogueFrancais.find((f) => f.id === cree.id)?.name).toBe('Demande de materiel');
    });

    it('retombe sur la saisie quand la langue manque', async () => {
      const cree = await commeTechnicien(() =>
        formsService.save({
          name: 'Sans traduction',
          description: null,
          category: null,
          isActive: true,
          ranking: 1,
          isRecursive: true,
          access: [],
          destinations: [],
          translations: [],
          sections: [
            {
              name: 'Section',
              description: null,
              translations: [],
              questions: [
                {
                  kind: 'text',
                  label: 'Question',
                  description: null,
                  isRequired: false,
                  options: [],
                  defaultValue: null,
                  translations: [],
                  conditions: [],
                },
              ],
            },
          ],
        }),
      );

      // Afficher un vide serait pire que d'afficher l'autre langue : ces
      // libelles sont ecrits par un administrateur, pas traduits par le produit.
      const enAnglais = await dans(
        ids.profilDemandeur,
        ids.demandeur,
        () => formsService.render(cree.id),
        'en',
      );

      expect(enAnglais.name).toBe('Sans traduction');
      expect(enAnglais.sections[0]?.questions[0]?.label).toBe('Question');
    });

    it('ne laisse pas de traduction orpheline apres un enregistrement', async () => {
      const cree = await commeTechnicien(() =>
        formsService.save({
          name: 'A remplacer',
          description: null,
          category: null,
          isActive: true,
          ranking: 2,
          isRecursive: true,
          access: [],
          destinations: [],
          translations: [{ locale: 'en', label: 'To replace', description: null }],
          sections: [
            {
              name: 'Section',
              description: null,
              translations: [{ locale: 'en', label: 'Section EN', description: null }],
              questions: [],
            },
          ],
        }),
      );

      // La table est polymorphe, donc sans cle etrangere : rien ne supprime ses
      // lignes en cascade quand les sections sont remplacees.
      await commeTechnicien(() =>
        formsService.save(
          {
            name: 'A remplacer',
            description: null,
            category: null,
            isActive: true,
            ranking: 2,
            isRecursive: true,
            access: [],
            destinations: [],
            translations: [],
            sections: [
              { name: 'Nouvelle section', description: null, translations: [], questions: [] },
            ],
          },
          cree.id,
        ),
      );

      const relu = await commeTechnicien(() => formsService.findById(cree.id));

      expect(relu.translations).toEqual([]);
      expect(relu.sections[0]?.translations).toEqual([]);
    });
  });
});
