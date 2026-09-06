import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerHarnais, type Harnais } from './harnais.js';

/**
 * Planning, récurrences, statistiques et exports, vus par HTTP.
 *
 * Ce sont les écrans d'exploitation. Deux points y méritent une vérification
 * par le réseau plutôt que par le service : les exports, dont les en-têtes
 * décident si le navigateur télécharge ou affiche, et le balayage des
 * récurrences, dont la trace anti-rejeu doit rester la même qu'il soit
 * déclenché à la main ou par la minuterie.
 */
describe('HTTP — pilotage', () => {
  let harnais: Harnais;
  let PREFIXE: string;

  beforeAll(async () => {
    harnais = await creerHarnais('pilotage');
    PREFIXE = harnais.prefixe;
  }, 120_000);

  afterAll(async () => {
    await harnais.close();
  });

  describe('planning', () => {
    const fenetre = { from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T23:59:59.000Z' };
    let indisponibilite: number;

    it('liste la fenêtre demandée', async () => {
      const reponse = await harnais.admin().get('/api/planning').query(fenetre);

      expect(reponse.status).toBe(200);
      expect(Array.isArray(reponse.body)).toBe(true);
    });

    it('refuse une fenêtre démesurée', async () => {
      // Cent jours au plus : au-dela, la requete balaie assez de taches pour
      // que l'ecran mette une minute a s'afficher, sans qu'on sache pourquoi.
      const reponse = await harnais
        .admin()
        .get('/api/planning')
        .query({ from: '2026-01-01T00:00:00.000Z', to: '2026-12-31T00:00:00.000Z' });

      expect(reponse.status).toBe(400);
      expect(reponse.body.message).toMatch(/trop large/);
    });

    it('refuse une fenêtre à l’envers', async () => {
      const reponse = await harnais
        .admin()
        .get('/api/planning')
        .query({ from: '2026-07-31T00:00:00.000Z', to: '2026-07-01T00:00:00.000Z' });

      expect(reponse.status).toBe(400);
    });

    it('refuse une date illisible', async () => {
      const reponse = await harnais
        .admin()
        .get('/api/planning')
        .query({ from: 'hier', to: 'demain' });

      expect(reponse.status).toBe(400);
    });

    it('exige des bornes', async () => {
      // Sans bornes, la requete balaierait tout l'historique visible : le refus
      // est au contrat plutot qu'a la charge du serveur.
      expect((await harnais.admin().get('/api/planning')).status).toBe(400);
    });

    it('accepte un filtre par technicien', async () => {
      const comptes = await harnais.admin().get('/api/admin/users').query({ search: 'admin' });
      const reponse = await harnais
        .admin()
        .get('/api/planning')
        .query({ ...fenetre, technicianId: String(comptes.body[0].id) });

      expect(reponse.status).toBe(200);
    });

    it('exporte en iCalendar, en pièce jointe', async () => {
      const reponse = await harnais.admin().get('/api/planning/ical').query(fenetre);

      expect(reponse.status).toBe(200);
      expect(reponse.headers['content-type']).toMatch(/text\/calendar/);
      expect(reponse.headers['content-disposition']).toMatch(/attachment/);
      expect(reponse.text).toMatch(/^BEGIN:VCALENDAR/);
      expect(reponse.text.trimEnd()).toMatch(/END:VCALENDAR$/);
    });

    it('pose puis retire une indisponibilité', async () => {
      const comptes = await harnais.admin().get('/api/admin/users').query({ search: 'admin' });

      const pose = await harnais
        .admin()
        .post('/api/planning/unavailabilities')
        .send({
          userId: comptes.body[0].id,
          beginAt: '2026-07-01T08:00:00.000Z',
          endAt: '2026-07-15T18:00:00.000Z',
          reason: PREFIXE + 'conges',
        });

      expect(pose.status).toBe(204);

      const entrees = await harnais
        .admin()
        .get('/api/planning')
        .query({ from: '2026-07-01T00:00:00.000Z', to: '2026-07-31T00:00:00.000Z' });

      const trouve = entrees.body.find(
        (entree: { title?: string }) => entree.title === PREFIXE + 'conges',
      );

      expect(trouve).toBeDefined();
      indisponibilite = trouve.id as number;

      expect(
        (await harnais.admin().delete('/api/planning/unavailabilities/' + indisponibilite)).status,
      ).toBe(204);
    });
  });

  describe('tickets récurrents', () => {
    let modele: number;
    let recurrence: number;

    beforeAll(async () => {
      const reponse = await harnais
        .admin()
        .post('/api/ticket-templates')
        .send({ name: PREFIXE + 'modele', fields: [] });

      modele = reponse.body.id as number;
    });

    afterAll(async () => {
      await harnais.admin().delete('/api/ticket-templates/' + modele);
    });

    it('crée une récurrence', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/planning/recurring')
        .send({
          name: PREFIXE + 'sauvegardes',
          content: 'Verifier les sauvegardes hebdomadaires.',
          templateId: modele,
          step: 'weekly',
          interval: 1,
          beginAt: '2026-01-05T06:00:00.000Z',
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body.nextOccurrenceAt).not.toBeNull();

      recurrence = reponse.body.id;
    });

    it('refuse un modèle qui rendrait la génération impossible', async () => {
      // Le modele est verifie a l'enregistrement, et non a 3 h du matin : un
      // champ obligatoire que la recurrence ne fournit pas ferait echouer
      // chaque generation, sans que personne ne le voie.
      const strict = await harnais
        .admin()
        .post('/api/ticket-templates')
        .send({
          name: PREFIXE + 'strict',
          fields: [{ field: 'locationId', kind: 'mandatory' }],
        });

      const reponse = await harnais
        .admin()
        .post('/api/planning/recurring')
        .send({
          name: PREFIXE + 'impossible',
          templateId: strict.body.id,
          beginAt: '2026-01-05T06:00:00.000Z',
        });

      expect(reponse.status).toBe(400);

      await harnais.admin().delete('/api/ticket-templates/' + strict.body.id);
    });

    it('liste, avec ou sans filtre d’activité', async () => {
      for (const filtre of [{}, { active: 'true' }, { active: 'false' }]) {
        const reponse = await harnais.admin().get('/api/planning/recurring').query(filtre);

        expect(reponse.status, JSON.stringify(filtre)).toBe(200);
      }
    });

    it('modifie la récurrence', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/planning/recurring/' + recurrence)
        .send({
          name: PREFIXE + 'sauvegardes-2',
          templateId: modele,
          step: 'monthly',
          interval: 2,
          beginAt: '2026-02-01T06:00:00.000Z',
          isActive: false,
        });

      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ step: 'monthly', interval: 2, isActive: false });
    });

    it('refuse un intervalle nul', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/planning/recurring')
        .send({
          name: PREFIXE + 'intervalle',
          templateId: modele,
          interval: 0,
          beginAt: '2026-01-05T06:00:00.000Z',
        });

      expect(reponse.status).toBe(400);
    });

    it('balaie à la demande sans rien créer en double', async () => {
      // Le balayage manuel emprunte le meme chemin que la minuterie, trace
      // anti-rejeu comprise : deux appels de suite ne doivent pas produire deux
      // fois la meme occurrence.
      const premier = await harnais.admin().post('/api/planning/recurring/run');

      expect(premier.status).toBe(201);
      expect(premier.body).toHaveProperty('created');

      const second = await harnais.admin().post('/api/planning/recurring/run');

      expect(second.status).toBe(201);
      expect(second.body.created).toBe(0);
    }, 60_000);

    it('supprime la récurrence', async () => {
      expect((await harnais.admin().delete('/api/planning/recurring/' + recurrence)).status).toBe(
        204,
      );
    });
  });

  describe('statistiques', () => {
    it('rend le rapport du périmètre', async () => {
      const reponse = await harnais.admin().get('/api/stats');

      expect(reponse.status).toBe(200);
      expect(reponse.body.summary).toMatchObject({
        opened: expect.any(Number),
        solved: expect.any(Number),
        pending: expect.any(Number),
      });
    });

    it('accepte chaque dimension prévue', async () => {
      for (const dimension of ['status', 'priority', 'category', 'entity', 'technician']) {
        const reponse = await harnais.admin().get('/api/stats').query({ dimension });

        expect(reponse.status, dimension).toBe(200);
      }
    });

    it('refuse une dimension inconnue', async () => {
      expect((await harnais.admin().get('/api/stats').query({ dimension: 'lune' })).status).toBe(
        400,
      );
    });

    it('rend la tendance', async () => {
      const reponse = await harnais
        .admin()
        .get('/api/stats/trend')
        .query({ from: '2026-01-01', to: '2026-12-31' });

      expect(reponse.status).toBe(200);
      expect(Array.isArray(reponse.body)).toBe(true);
    });

    it('énumère les widgets disponibles', async () => {
      const reponse = await harnais.admin().get('/api/stats/widgets');

      expect(reponse.status).toBe(200);
      expect(reponse.body.length).toBeGreaterThan(0);
      expect(reponse.body[0]).toMatchObject({
        kind: expect.any(String),
        label: expect.any(String),
        description: expect.any(String),
      });
    });
  });

  describe('tableaux de bord', () => {
    let tableau: number;

    it('en compose un', async () => {
      const catalogue = await harnais.admin().get('/api/stats/widgets');

      const reponse = await harnais
        .admin()
        .post('/api/stats/dashboards')
        .send({
          name: PREFIXE + 'tableau',
          widgets: [
            { kind: catalogue.body[0].kind, title: 'Vue d ensemble', width: 6 },
            { kind: catalogue.body[0].kind, title: 'Second', width: 6 },
          ],
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body.widgets).toHaveLength(2);
      expect(reponse.body.widgets[0].position).toBe(0);

      tableau = reponse.body.id;
    });

    it('refuse un widget hors catalogue', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/stats/dashboards')
        .send({ name: PREFIXE + 'fantome', widgets: [{ kind: 'widget-inexistant' }] });

      expect(reponse.status).toBeGreaterThanOrEqual(400);
    });

    it('le liste et le modifie', async () => {
      const liste = await harnais.admin().get('/api/stats/dashboards');

      expect(liste.status).toBe(200);
      expect(liste.body.some((entree: { id: number }) => entree.id === tableau)).toBe(true);

      const reponse = await harnais
        .admin()
        .put('/api/stats/dashboards/' + tableau)
        .send({ name: PREFIXE + 'tableau-2', isPublic: true, widgets: [] });

      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ name: PREFIXE + 'tableau-2', isPublic: true });
      expect(reponse.body.widgets).toHaveLength(0);
    });

    it('le supprime', async () => {
      expect((await harnais.admin().delete('/api/stats/dashboards/' + tableau)).status).toBe(204);
    });
  });

  describe('exports', () => {
    it('exporte en CSV, en pièce jointe', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/stats/export')
        .query({ format: 'csv' })
        .send({ limit: 20 });

      expect(reponse.status).toBe(200);
      expect(reponse.headers['content-type']).toMatch(/text\/csv/);
      expect(reponse.headers['content-disposition']).toMatch(/attachment/);

      // L'export ne doit jamais etre mis en cache : il porte des donnees
      // filtrees par le perimetre de celui qui l'a demande.
      expect(reponse.headers['cache-control']).toMatch(/no-store/);

      const texte = reponse.text;

      expect(texte.split('\n')[0]).toContain('Sujet');
    });

    it('exporte en PDF', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/stats/export')
        .query({ format: 'pdf' })
        .send({ limit: 20 });

      expect(reponse.status).toBe(200);
      expect(reponse.headers['content-type']).toMatch(/application\/pdf/);
    });

    it('refuse un format inconnu', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/stats/export')
        .query({ format: 'docx' })
        .send({});

      expect(reponse.status).toBe(400);
    });

    it('exporte exactement la recherche envoyée', async () => {
      // Le corps est la meme requete que la recherche : lui passer un filtre
      // distinct serait le moyen le plus sur de livrer autre chose que ce qui a
      // ete verifie a l'ecran.
      const reponse = await harnais
        .admin()
        .post('/api/stats/export')
        .query({ format: 'csv' })
        .send({
          criteria: { kind: 'criterion', field: 'ticket.status', operator: 'eq', value: 'closed' },
          limit: 50,
        });

      expect(reponse.status).toBe(200);
    });
  });

  describe('sans session', () => {
    it('refuse toutes les routes de pilotage', async () => {
      for (const chemin of [
        '/api/planning',
        '/api/planning/recurring',
        '/api/stats',
        '/api/stats/dashboards',
      ]) {
        expect((await harnais.anonyme().get(chemin)).status, chemin).toBe(401);
      }
    });
  });
});
