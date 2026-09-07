import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerHarnais, type Harnais } from './harnais.js';

/**
 * Catalogue, connaissance, recherche, satisfaction et pièces jointes.
 *
 * Trois routes de ce périmètre sont **publiques** — la FAQ et le formulaire de
 * satisfaction — et deux d'entre elles le sont par conception : le demandeur
 * répond depuis son courriel, sans compte. Ce sont donc les seules du serveur
 * qu'un inconnu peut atteindre, et ce qu'elles laissent voir mérite d'être
 * vérifié ligne à ligne.
 */
describe('HTTP — libre-service', () => {
  let harnais: Harnais;
  let PREFIXE: string;

  beforeAll(async () => {
    harnais = await creerHarnais('libre');
    PREFIXE = harnais.prefixe;
  }, 120_000);

  afterAll(async () => {
    await harnais.close();
  });

  describe('formulaires et catalogue', () => {
    let formulaire: number;

    it('crée un formulaire', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/forms')
        .send({
          name: PREFIXE + 'demande',
          description: 'Demande de materiel',
          sections: [
            {
              name: 'Besoin',
              questions: [
                { kind: 'text', label: 'Quel materiel ?', isRequired: true },
                { kind: 'textarea', label: 'Pourquoi ?' },
              ],
            },
          ],
          destinations: [
            {
              kind: 'ticket',
              mappings: [
                { field: 'name', source: 'question', question: 0 },
                { field: 'urgency', source: 'literal', value: '3' },
              ],
            },
          ],
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body.sections[0].questions).toHaveLength(2);

      formulaire = reponse.body.id;
    });

    it('refuse un formulaire sans section', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/forms')
        .send({ name: PREFIXE + 'vide', sections: [] });

      expect(reponse.status).toBe(400);
    });

    it('le retrouve côté administration', async () => {
      expect((await harnais.admin().get('/api/forms')).status).toBe(200);
      expect((await harnais.admin().get('/api/forms/' + formulaire)).status).toBe(200);
    });

    it('apparaît au catalogue, sans droit d’administration', async () => {
      // Remplir un formulaire est ce que fait un demandeur : le subordonner a
      // un droit fermerait la porte qu'on vient d'ouvrir.
      const reponse = await harnais.admin().get('/api/catalogue');

      expect(reponse.status).toBe(200);
      expect(reponse.body.some((entree: { id: number }) => entree.id === formulaire)).toBe(true);
    });

    it('se rend prêt à être rempli', async () => {
      const reponse = await harnais.admin().get('/api/catalogue/' + formulaire);

      expect(reponse.status).toBe(200);
      expect(reponse.body.sections[0].questions[0].label).toBe('Quel materiel ?');
    });

    it('soumis, il ouvre un ticket', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/catalogue/' + formulaire)
        .send({ answers: { '0': 'Un ecran', '1': 'Le mien est casse' } });

      expect(reponse.status).toBe(201);
      expect(reponse.body.submissionId).toBeGreaterThan(0);
      expect(reponse.body.ticketId).toBeGreaterThan(0);

      const ticket = await harnais.admin().get('/api/tickets/' + reponse.body.ticketId);

      expect(ticket.status).toBe(200);
      expect(ticket.body.name).toBe('Un ecran');

      await harnais.admin().delete('/api/tickets/' + reponse.body.ticketId);
    });

    it('refuse une soumission sans réponse obligatoire', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/catalogue/' + formulaire)
        .send({ answers: { '1': 'Sans le materiel' } });

      expect(reponse.status).toBe(400);
    });

    it('accepte les natures de question calquées sur GLPI', async () => {
      // Les natures vivent a trois endroits -- le contrat Zod, l'enumeration
      // PostgreSQL et l'ecran -- et une seule oubliee suffit a rendre la nature
      // inutilisable. L'aller-retour complet est le seul moyen de le savoir.
      const natures = [
        'text',
        'textarea',
        'number',
        'date',
        'time',
        'datetime',
        'email',
        'url',
        'select',
        'radio',
        'multiselect',
        'checkbox',
        'urgency',
        'requesttype',
        'user',
        'group',
        'description',
      ];

      const reponse = await harnais
        .admin()
        .post('/api/forms')
        .send({
          name: PREFIXE + 'natures',
          sections: [
            {
              name: 'Toutes les natures',
              questions: natures.map((kind) => ({
                kind,
                label: 'Question ' + kind,
                options: ['A', 'B'],
              })),
            },
          ],
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body.sections[0].questions.map((q: { kind: string }) => q.kind)).toEqual(
        natures,
      );

      await harnais.admin().delete('/api/forms/' + reponse.body.id);
    });

    it('n’exige jamais un bloc d’explication', async () => {
      const forme = await harnais
        .admin()
        .post('/api/forms')
        .send({
          name: PREFIXE + 'explication',
          sections: [
            {
              name: 'Consignes',
              questions: [
                // Marque obligatoire par erreur : le demandeur n'aurait aucun
                // moyen d'y satisfaire, puisqu'il n'y a rien a saisir.
                { kind: 'description', label: 'Lisez ceci', isRequired: true },
                { kind: 'text', label: 'Votre nom' },
              ],
            },
          ],
          destinations: [
            { kind: 'ticket', mappings: [{ field: 'name', source: 'question', question: 1 }] },
          ],
        });

      expect(forme.status).toBe(201);

      const soumission = await harnais
        .admin()
        .post('/api/catalogue/' + forme.body.id)
        .send({ answers: { '1': 'Paul Durand' } });

      expect(soumission.status).toBe(201);

      await harnais.admin().delete('/api/tickets/' + soumission.body.ticketId);
      await harnais.admin().delete('/api/forms/' + forme.body.id);
    });

    it('modifie puis supprime le formulaire', async () => {
      const modification = await harnais
        .admin()
        .put('/api/forms/' + formulaire)
        .send({
          name: PREFIXE + 'demande-2',
          isActive: false,
          sections: [{ name: 'Besoin', questions: [] }],
        });

      expect(modification.status).toBe(200);
      expect(modification.body.isActive).toBe(false);

      expect((await harnais.admin().delete('/api/forms/' + formulaire)).status).toBe(204);
    });
  });

  describe('base de connaissances', () => {
    let categorie: number;
    let article: number;

    it('crée une catégorie', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/kb/categories')
        .send({ name: PREFIXE + 'categorie' });

      expect(reponse.status).toBe(201);
      categorie = reponse.body.id;
    });

    it('crée un article non publié', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/kb')
        .send({
          name: PREFIXE + 'article',
          content: 'Redemarrer le service, puis verifier les journaux.',
          categoryId: categorie,
          isFaq: false,
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body.version).toBe(1);

      article = reponse.body.id;
    });

    it('ne l’expose pas à la FAQ publique tant qu’il n’y est pas publié', async () => {
      // `isFaq` n'est pas un classement mais une **publication** : l'article
      // devient lisible sans compte par quiconque a l'adresse.
      const publique = await harnais.anonyme().get('/api/public/faq');

      expect(publique.status).toBe(200);
      expect(publique.body.some((entree: { id: number }) => entree.id === article)).toBe(false);

      expect((await harnais.anonyme().get('/api/public/faq/' + article)).status).toBe(404);
    });

    it('incrémente la version à chaque modification', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/kb/' + article)
        .send({
          name: PREFIXE + 'article-2',
          content: 'Redemarrer le service. Verifier les journaux. Escalader si besoin.',
          isFaq: true,
        });

      expect(reponse.status).toBe(200);
      expect(reponse.body.version).toBe(2);

      const revisions = await harnais.admin().get('/api/kb/' + article + '/revisions');

      expect(revisions.status).toBe(200);
      expect(revisions.body.length).toBeGreaterThan(0);
    });

    it('l’expose à la FAQ une fois publié, sans rien de plus', async () => {
      const liste = await harnais.anonyme().get('/api/public/faq');

      expect(liste.status).toBe(200);
      expect(liste.body.some((entree: { id: number }) => entree.id === article)).toBe(true);

      const fiche = await harnais.anonyme().get('/api/public/faq/' + article);

      expect(fiche.status).toBe(200);

      // Ni auteur, ni entite, ni compteur interne : la FAQ ne renseigne pas un
      // inconnu sur l'organisation qui la publie.
      expect(fiche.body).not.toHaveProperty('entityId');
      expect(fiche.body).not.toHaveProperty('entityName');
      expect(fiche.body).not.toHaveProperty('viewCount');
      expect(fiche.body).not.toHaveProperty('author');
    });

    it('cherche dans la FAQ publique', async () => {
      const reponse = await harnais.anonyme().get('/api/public/faq').query({ search: 'journaux' });

      expect(reponse.status).toBe(200);
    });

    it('filtre la liste interne', async () => {
      for (const filtre of [
        { search: PREFIXE },
        { categoryId: categorie },
        { faqOnly: 'true' },
        { favoritesOnly: 'true' },
        { limit: '5' },
      ]) {
        const reponse = await harnais.admin().get('/api/kb').query(filtre);

        expect(reponse.status, JSON.stringify(filtre)).toBe(200);
      }
    });

    it('bascule le favori', async () => {
      const premier = await harnais.admin().post('/api/kb/' + article + '/favorite');

      expect(premier.status).toBe(200);
      expect(premier.body.isFavorite).toBe(true);

      const second = await harnais.admin().post('/api/kb/' + article + '/favorite');

      expect(second.body.isFavorite).toBe(false);
    });

    it('supprime l’article et la catégorie', async () => {
      expect((await harnais.admin().delete('/api/kb/' + article)).status).toBe(204);
      expect((await harnais.admin().delete('/api/kb/categories/' + categorie)).status).toBe(204);
    });
  });

  describe('recherche', () => {
    let enregistree: number;

    it('énumère les champs interrogeables', async () => {
      const reponse = await harnais.admin().get('/api/search/fields');

      expect(reponse.status).toBe(200);
      expect(reponse.body.length).toBeGreaterThan(0);
      expect(reponse.body[0]).toMatchObject({
        key: expect.any(String),
        label: expect.any(String),
        operators: expect.any(Array),
      });
    });

    it('cherche sans critère', async () => {
      const reponse = await harnais.admin().post('/api/search/tickets').send({});

      expect(reponse.status).toBe(200);
      expect(reponse.body).toHaveProperty('items');
    });

    it('cherche avec un groupe de critères', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/search/tickets')
        .send({
          criteria: {
            kind: 'group',
            link: 'or',
            children: [
              { kind: 'criterion', field: 'ticket.status', operator: 'eq', value: 'new' },
              { kind: 'criterion', field: 'ticket.urgency', operator: 'gte', value: 4 },
            ],
          },
          limit: 10,
        });

      expect(reponse.status).toBe(200);
    });

    it('refuse un champ inconnu', async () => {
      // Un champ inconnu compile en SQL ou en rien : le refuser au compilateur
      // evite que la recherche reponde « aucun resultat » a une question mal
      // ecrite, ce qui se lit comme une reponse.
      const reponse = await harnais
        .admin()
        .post('/api/search/tickets')
        .send({
          criteria: { kind: 'criterion', field: 'champ_inexistant', operator: 'eq', value: 'x' },
        });

      expect(reponse.status).toBeGreaterThanOrEqual(400);
    });

    it('refuse un opérateur inconnu', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/search/tickets')
        .send({
          criteria: { kind: 'criterion', field: 'status', operator: 'ressemble', value: 'x' },
        });

      expect(reponse.status).toBe(400);
    });

    it('enregistre une recherche puis la retrouve', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/search/saved')
        .send({
          name: PREFIXE + 'recherche',
          criteria: { kind: 'criterion', field: 'ticket.status', operator: 'eq', value: 'new' },
        });

      expect(reponse.status).toBe(201);
      enregistree = reponse.body.id;

      const liste = await harnais.admin().get('/api/search/saved');

      expect(liste.status).toBe(200);
      expect(liste.body.some((entree: { id: number }) => entree.id === enregistree)).toBe(true);
    });

    it('modifie puis supprime la recherche', async () => {
      const modification = await harnais
        .admin()
        .put('/api/search/saved/' + enregistree)
        .send({
          name: PREFIXE + 'recherche-2',
          isPinned: true,
          criteria: {
            kind: 'criterion',
            field: 'ticket.status',
            operator: 'eq',
            value: 'assigned',
          },
        });

      expect(modification.status).toBe(200);
      expect(modification.body.isPinned).toBe(true);

      expect((await harnais.admin().delete('/api/search/saved/' + enregistree)).status).toBe(204);
    });

    it('refuse un visiteur sans session', async () => {
      expect((await harnais.anonyme().get('/api/search/fields')).status).toBe(401);
      expect((await harnais.anonyme().post('/api/search/tickets').send({})).status).toBe(401);
    });
  });

  describe('satisfaction', () => {
    it('lit la configuration et les statistiques', async () => {
      expect((await harnais.admin().get('/api/satisfaction/configs')).status).toBe(200);

      const stats = await harnais.admin().get('/api/satisfaction/stats');

      expect(stats.status).toBe(200);
      expect(stats.body).toMatchObject({
        requested: expect.any(Number),
        answered: expect.any(Number),
      });
    });

    it('écrit la configuration', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/satisfaction/configs')
        .send({ isActive: true, percentage: 50, delayDays: 2, durationDays: 15 });

      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ percentage: 50, delayDays: 2 });
    });

    it('refuse un pourcentage hors bornes', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/satisfaction/configs')
        .send({ percentage: 150 });

      expect(reponse.status).toBe(400);
    });

    it('refuse un jeton d’enquête inconnu, sans en dire plus', async () => {
      // Le jeton fait autorisation : distinguer « inconnu » de « expire »
      // aiderait a en deviner un valide.
      const reponse = await harnais.anonyme().get('/api/public/satisfaction/jeton-invente');

      expect(reponse.status).toBe(404);
    });

    it('refuse une réponse sur un jeton inconnu', async () => {
      const reponse = await harnais
        .anonyme()
        .post('/api/public/satisfaction/jeton-invente')
        .send({ rating: 5 });

      expect(reponse.status).toBe(404);
    });

    it('refuse une note hors échelle', async () => {
      const reponse = await harnais
        .anonyme()
        .post('/api/public/satisfaction/jeton-invente')
        .send({ rating: 9 });

      expect(reponse.status).toBe(400);
    });
  });

  describe('pièces jointes', () => {
    let ticket: number;
    let document: number;

    beforeAll(async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets')
        .send({ name: PREFIXE + 'avec-piece-jointe' });

      ticket = reponse.body.id as number;
    });

    afterAll(async () => {
      await harnais.admin().delete('/api/tickets/' + ticket);
    });

    it('dépose un fichier sur un ticket', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/documents/items/ticket/' + ticket)
        .attach('file', Buffer.from('journal;valeur\n1;2\n'), 'trace.csv');

      expect(reponse.status).toBe(201);
      expect(reponse.body).toMatchObject({ name: 'trace.csv' });

      document = reponse.body.id;
    });

    it('le liste sur son objet', async () => {
      const reponse = await harnais.admin().get('/api/documents/items/ticket/' + ticket);

      expect(reponse.status).toBe(200);
      expect(reponse.body.some((entree: { id: number }) => entree.id === document)).toBe(true);
    });

    it('le rend en pièce jointe, jamais exécutable', async () => {
      const reponse = await harnais.admin().get('/api/documents/' + document + '/content');

      expect(reponse.status).toBe(200);

      // Une piece deposee par un tiers ne doit jamais s'executer dans le
      // navigateur d'un collegue : les deux en-tetes ci-dessous sont ce qui
      // l'en empeche.
      expect(reponse.headers['x-content-type-options']).toBe('nosniff');
      expect(reponse.headers['content-disposition']).toMatch(/^attachment/);
    });

    it('reste hors de la chronologie, qui n’accueille que des échanges', async () => {
      // Etat des lieux, et non choix definitif : la chronologie porte les
      // suivis, taches, solutions, validations et changements de champ. Une
      // piece jointe se lit sur sa propre liste. GLPI l'y fait apparaitre ; si
      // Tick& doit suivre, c'est une entree a ajouter a l'union, pas un
      // ajustement de ce test.
      const reponse = await harnais.admin().get('/api/tickets/' + ticket + '/timeline');

      expect(reponse.status).toBe(200);

      for (const entree of reponse.body) {
        expect(['followup', 'task', 'solution', 'validation', 'log']).toContain(entree.kind);
      }
    });

    it('signale un document inexistant', async () => {
      expect((await harnais.admin().get('/api/documents/99999999/content')).status).toBe(404);
    });

    it('le supprime', async () => {
      expect((await harnais.admin().delete('/api/documents/' + document)).status).toBe(204);
    });

    it('refuse un visiteur sans session', async () => {
      expect((await harnais.anonyme().get('/api/documents/items/ticket/1')).status).toBe(401);
    });
  });
});
