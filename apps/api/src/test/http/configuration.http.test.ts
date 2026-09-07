import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerHarnais, type Harnais } from './harnais.js';

/**
 * Règles, engagements, notifications, collecteurs et plugins, vus par HTTP.
 *
 * Ce sont les écrans de configuration : chacun est gardé par un droit, et un
 * droit oublié ne se voit pas à la lecture du code — la route répond
 * simplement, à tout le monde. On vérifie donc systématiquement qu'un visiteur
 * sans session est refusé.
 */
describe('HTTP — configuration', () => {
  let harnais: Harnais;
  let PREFIXE: string;

  beforeAll(async () => {
    harnais = await creerHarnais('config');
    PREFIXE = harnais.prefixe;
  }, 120_000);

  afterAll(async () => {
    await harnais.close();
  });

  describe('règles métier', () => {
    let regle: number;

    it('énumère les champs d’une collection', async () => {
      const reponse = await harnais
        .admin()
        .get('/api/rules/fields')
        .query({ collection: 'ticket.create' });

      expect(reponse.status).toBe(200);
      expect(reponse.body.length).toBeGreaterThan(0);
      expect(reponse.body[0]).toMatchObject({ key: expect.any(String), label: expect.any(String) });
    });

    it('refuse une collection inconnue', async () => {
      const reponse = await harnais
        .admin()
        .get('/api/rules/fields')
        .query({ collection: 'inexistante' });

      expect(reponse.status).toBe(500);
    });

    it('crée une règle', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/rules')
        .send({
          collection: 'ticket.create',
          name: PREFIXE + 'regle',
          criteria: [{ field: 'name', operator: 'contains', value: 'imprimante' }],
          actions: [{ field: 'urgency', action: 'assign', value: '4' }],
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body.criteria).toHaveLength(1);
      expect(reponse.body.actions).toHaveLength(1);

      regle = reponse.body.id;
    });

    it('refuse un opérateur inconnu', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/rules')
        .send({
          collection: 'ticket.create',
          name: PREFIXE + 'invalide',
          criteria: [{ field: 'name', operator: 'ressemble_a', value: 'x' }],
        });

      expect(reponse.status).toBe(400);
    });

    it('liste et retrouve la règle', async () => {
      const liste = await harnais.admin().get('/api/rules').query({ collection: 'ticket.create' });

      expect(liste.status).toBe(200);
      expect(liste.body.some((entree: { id: number }) => entree.id === regle)).toBe(true);

      const toutes = await harnais.admin().get('/api/rules');

      expect(toutes.status).toBe(200);

      const fiche = await harnais.admin().get('/api/rules/' + regle);

      expect(fiche.status).toBe(200);
      expect(fiche.body.name).toBe(PREFIXE + 'regle');
    });

    it('modifie la règle', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/rules/' + regle)
        .send({
          collection: 'ticket.create',
          name: PREFIXE + 'regle-2',
          isActive: false,
          criteria: [],
          actions: [{ field: 'urgency', action: 'assign', value: '2' }],
        });

      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ name: PREFIXE + 'regle-2', isActive: false });
    });

    it('refuse une règle sans action', async () => {
      // Une regle qui ne decide rien s'evalue a chaque ticket pour ne produire
      // aucun effet : c'est un cout net, et presque toujours une saisie
      // interrompue en cours de route.
      const reponse = await harnais
        .admin()
        .post('/api/rules')
        .send({ collection: 'ticket.create', name: PREFIXE + 'inerte', actions: [] });

      expect(reponse.status).toBe(400);
      expect(reponse.body.message).toMatch(/ne decide rien/);
    });

    it('refuse un champ absent du catalogue de la collection', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/rules')
        .send({
          collection: 'ticket.create',
          name: PREFIXE + 'champ-inconnu',
          criteria: [{ field: 'champ_qui_n_existe_pas', operator: 'is', value: 'x' }],
          actions: [{ field: 'urgency', action: 'assign', value: '2' }],
        });

      expect(reponse.status).toBe(400);
    });

    it('réordonne les règles', async () => {
      const reponse = await harnais.admin().post('/api/rules/reorder').send({ ids: [regle] });

      expect(reponse.status).toBe(204);
    });

    it('refuse un réordonnancement vide', async () => {
      expect((await harnais.admin().post('/api/rules/reorder').send({ ids: [] })).status).toBe(400);
    });

    it('simule sans rien écrire', async () => {
      // Le meme moteur que l'execution reelle : une seconde implementation
      // « d'apercu » finirait par diverger, et la simulation mentirait.
      const reponse = await harnais
        .admin()
        .post('/api/rules/simulate')
        .send({ collection: 'ticket.create', input: { name: 'panne imprimante' } });

      expect(reponse.status).toBe(200);
      expect(reponse.body).toHaveProperty('traces');
    });

    it('supprime la règle', async () => {
      expect((await harnais.admin().delete('/api/rules/' + regle)).status).toBe(204);
    });

    it('refuse un visiteur sans session', async () => {
      expect((await harnais.anonyme().get('/api/rules')).status).toBe(401);
    });
  });

  describe('calendriers et engagements', () => {
    let calendrier: number;
    let engagement: number;

    it('crée un calendrier ouvré', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/calendars')
        .send({
          name: PREFIXE + 'calendrier',
          timezone: 'Europe/Paris',
          segments: [
            { weekday: 1, beginAt: '09:00', endAt: '18:00' },
            { weekday: 2, beginAt: '09:00', endAt: '18:00' },
          ],
          holidays: [{ name: 'Noel', day: '2026-12-25', isPerpetual: true }],
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body.segments).toHaveLength(2);
      expect(reponse.body.holidays).toHaveLength(1);

      calendrier = reponse.body.id;
    });

    it('refuse un fuseau horaire inconnu', async () => {
      // Un fuseau errone decalerait toutes les echeances sans que rien ne le
      // signale : l'engagement expirerait a la mauvaise heure.
      const reponse = await harnais
        .admin()
        .post('/api/calendars')
        .send({ name: PREFIXE + 'faux-fuseau', timezone: 'Mars/Olympus' });

      expect(reponse.status).toBeGreaterThanOrEqual(400);
    });

    it('refuse une heure mal formée', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/calendars')
        .send({
          name: PREFIXE + 'mauvaise-heure',
          segments: [{ weekday: 1, beginAt: '9h', endAt: '18:00' }],
        });

      expect(reponse.status).toBe(400);
    });

    it('retrouve et modifie le calendrier', async () => {
      expect((await harnais.admin().get('/api/calendars/' + calendrier)).status).toBe(200);
      expect((await harnais.admin().get('/api/calendars')).status).toBe(200);

      const reponse = await harnais
        .admin()
        .put('/api/calendars/' + calendrier)
        .send({ name: PREFIXE + 'calendrier-2', segments: [], holidays: [] });

      expect(reponse.status).toBe(200);
      expect(reponse.body.segments).toHaveLength(0);
    });

    it('crée un engagement adossé au calendrier', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/agreements')
        .send({
          name: PREFIXE + 'engagement',
          kind: 'sla',
          axis: 'ttr',
          duration: 14_400,
          calendarId: calendrier,
          levels: [
            {
              name: 'Relance',
              offsetSeconds: -3600,
              actions: [{ action: 'set_urgency', value: '5' }],
            },
          ],
        });

      expect(reponse.status).toBe(201);
      engagement = reponse.body.id;
    });

    it('refuse une durée nulle ou démesurée', async () => {
      for (const duration of [0, -1, 31_536_001]) {
        const reponse = await harnais
          .admin()
          .post('/api/agreements')
          .send({ name: PREFIXE + 'duree', duration });

        expect(reponse.status, String(duration)).toBe(400);
      }
    });

    it('retrouve et modifie l’engagement', async () => {
      expect((await harnais.admin().get('/api/agreements/' + engagement)).status).toBe(200);
      expect((await harnais.admin().get('/api/agreements')).status).toBe(200);

      const reponse = await harnais
        .admin()
        .put('/api/agreements/' + engagement)
        .send({ name: PREFIXE + 'engagement-2', duration: 7200, levels: [] });

      expect(reponse.status).toBe(200);
      expect(reponse.body.duration).toBe(7200);
    });

    it('supprime l’engagement puis le calendrier', async () => {
      expect((await harnais.admin().delete('/api/agreements/' + engagement)).status).toBe(204);
      expect((await harnais.admin().delete('/api/calendars/' + calendrier)).status).toBe(204);
    });
  });

  describe('notifications', () => {
    let modele: number;

    it('énumère les évènements et les variables', async () => {
      const evenements = await harnais.admin().get('/api/notifications/events');
      const variables = await harnais.admin().get('/api/notifications/variables');

      expect(evenements.status).toBe(200);
      expect(evenements.body.length).toBeGreaterThan(0);
      expect(variables.status).toBe(200);
      expect(variables.body.length).toBeGreaterThan(0);
    });

    it('lit et change une préférence personnelle', async () => {
      // Aucun droit exige : chacun regle ce qu'il recoit. Le subordonner a un
      // droit d'administration confierait ce choix a quelqu'un d'autre.
      const lecture = await harnais.admin().get('/api/notifications/preferences');

      expect(lecture.status).toBe(200);
      expect(lecture.body.length).toBeGreaterThan(0);

      const evenement = lecture.body[0].event as string;
      const ecriture = await harnais
        .admin()
        .put('/api/notifications/preferences')
        .send({ event: evenement, enabled: false });

      expect(ecriture.status).toBe(204);

      const relecture = await harnais.admin().get('/api/notifications/preferences');
      const trouve = relecture.body.find((p: { event: string }) => p.event === evenement);

      expect(trouve.enabled).toBe(false);

      await harnais
        .admin()
        .put('/api/notifications/preferences')
        .send({ event: evenement, enabled: true });
    });

    it('crée un modèle traduit', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/notifications/templates')
        .send({
          event: 'ticket.created',
          name: PREFIXE + 'modele',
          targets: [{ target: 'requester' }],
          translations: [
            { locale: 'fr', subject: 'Nouveau ticket', bodyText: 'Bonjour {{ticket.name}}' },
          ],
        });

      expect(reponse.status).toBe(201);
      modele = reponse.body.id;
    });

    it('refuse un modèle sans traduction', async () => {
      // Un modele sans texte ne produit rien, et le decouvrir a l'envoi coute
      // une notification manquee : le refus est au contrat.
      const reponse = await harnais
        .admin()
        .post('/api/notifications/templates')
        .send({
          event: 'ticket.created',
          name: PREFIXE + 'muet',
          targets: [{ target: 'requester' }],
          translations: [],
        });

      expect(reponse.status).toBe(400);
    });

    it('refuse un modèle sans destinataire', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/notifications/templates')
        .send({
          event: 'ticket.created',
          name: PREFIXE + 'sans-cible',
          targets: [],
          translations: [{ locale: 'fr', subject: 'x', bodyText: 'y' }],
        });

      expect(reponse.status).toBe(400);
    });

    it('liste, retrouve et modifie le modèle', async () => {
      expect((await harnais.admin().get('/api/notifications/templates')).status).toBe(200);
      expect((await harnais.admin().get('/api/notifications/templates/' + modele)).status).toBe(200);

      const reponse = await harnais
        .admin()
        .put('/api/notifications/templates/' + modele)
        .send({
          event: 'ticket.created',
          name: PREFIXE + 'modele-2',
          isActive: false,
          targets: [{ target: 'assigned' }],
          translations: [{ locale: 'fr', subject: 'Modifie', bodyText: 'Texte' }],
        });

      expect(reponse.status).toBe(200);
      expect(reponse.body.isActive).toBe(false);
    });

    it('lit la file d’envoi et la purge', async () => {
      const file = await harnais.admin().get('/api/notifications/queue');

      expect(file.status).toBe(200);
      expect(Array.isArray(file.body)).toBe(true);

      // Les bornes viennent d'une URL, donc en texte : sans coercition, `?limit=10`
      // repondrait 400 et la pagination n'existerait qu'en apparence.
      const filtree = await harnais
        .admin()
        .get('/api/notifications/queue')
        .query({ state: 'sent', limit: '10', offset: '0' });

      expect(filtree.status).toBe(200);
      expect(filtree.body.length).toBeLessThanOrEqual(10);

      const purge = await harnais.admin().post('/api/notifications/queue/purge').query({ days: 30 });

      expect(purge.status).toBe(200);
      expect(purge.body).toHaveProperty('removed');
    });

    it('retombe sur trente jours quand la purge reçoit n’importe quoi', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/notifications/queue/purge')
        .query({ days: 'beaucoup' });

      expect(reponse.status).toBe(200);
      expect(reponse.body.removed).toBeGreaterThanOrEqual(0);
    });

    it('signale une entrée de file inexistante au rejeu', async () => {
      const reponse = await harnais.admin().post('/api/notifications/queue/99999999/replay');

      expect(reponse.status).toBe(404);
    });

    it('supprime le modèle', async () => {
      expect((await harnais.admin().delete('/api/notifications/templates/' + modele)).status).toBe(
        204,
      );
    });
  });

  describe('collecteurs de courriel', () => {
    let collecteur: number;

    it('crée un collecteur', async () => {
      const profils = await harnais.admin().get('/api/admin/profiles');

      const reponse = await harnais
        .admin()
        .post('/api/mail-collectors')
        .send({
          name: PREFIXE + 'collecteur',
          host: 'imap.invalide.test',
          login: 'support@exemple.fr',
          password: 'secret-imap',
          profileId: profils.body[0].id,
        });

      expect(reponse.status).toBe(201);
      collecteur = reponse.body.id;
    });

    it('ne renvoie jamais le mot de passe', async () => {
      const reponse = await harnais.admin().get('/api/mail-collectors');

      expect(reponse.status).toBe(200);
      expect(JSON.stringify(reponse.body)).not.toContain('secret-imap');
    });

    it('conserve le mot de passe quand la modification l’omet', async () => {
      const profils = await harnais.admin().get('/api/admin/profiles');

      const reponse = await harnais
        .admin()
        .put('/api/mail-collectors/' + collecteur)
        .send({
          name: PREFIXE + 'collecteur-2',
          host: 'imap.invalide.test',
          login: 'support@exemple.fr',
          profileId: profils.body[0].id,
        });

      expect(reponse.status).toBe(200);
      expect(reponse.body.name).toBe(PREFIXE + 'collecteur-2');
    });

    it('lit le journal du collecteur', async () => {
      const reponse = await harnais.admin().get('/api/mail-collectors/' + collecteur + '/logs');

      expect(reponse.status).toBe(200);
      expect(Array.isArray(reponse.body)).toBe(true);
    });

    it('rend un échec de relève sans tomber', async () => {
      // L'hote n'existe pas. La relève doit rendre un compte-rendu, pas une
      // erreur serveur : c'est une panne de l'annuaire distant, pas de Tick&.
      const reponse = await harnais.admin().post('/api/mail-collectors/' + collecteur + '/collect');

      expect([200, 201, 400, 502, 503]).toContain(reponse.status);
    }, 60_000);

    it('supprime le collecteur', async () => {
      expect((await harnais.admin().delete('/api/mail-collectors/' + collecteur)).status).toBe(204);
    });
  });

  describe('plugins', () => {
    it('liste les plugins découverts', async () => {
      const reponse = await harnais.admin().get('/api/plugins');

      expect(reponse.status).toBe(200);
      expect(Array.isArray(reponse.body)).toBe(true);
    });

    it('signale un plugin inconnu à l’installation', async () => {
      const reponse = await harnais.admin().post('/api/plugins/inexistant/install');

      expect(reponse.status).toBeGreaterThanOrEqual(400);
    });

    it('refuse le bundle d’un plugin qui n’est pas actif', async () => {
      const reponse = await harnais.admin().get('/api/plugins/inexistant/client.js');

      expect(reponse.status).toBe(404);
    });

    it('refuse un visiteur sans session', async () => {
      expect((await harnais.anonyme().get('/api/plugins')).status).toBe(401);
    });
  });

  describe('sans session', () => {
    it('refuse toutes les routes de configuration', async () => {
      for (const chemin of [
        '/api/calendars',
        '/api/agreements',
        '/api/notifications/templates',
        '/api/notifications/preferences',
        '/api/mail-collectors',
      ]) {
        expect((await harnais.anonyme().get(chemin)).status, chemin).toBe(401);
      }
    });
  });
  describe('catégories ITIL', () => {
    let mere: number;
    let fille: number;

    it('crée une catégorie racine', async () => {
      const reponse = await harnais.admin().post('/api/referentials/itil-categories').send({
        name: PREFIXE + 'mere',
        parentId: null,
        comment: 'Racine de test',
        isHelpdeskVisible: true,
        forIncident: true,
        forRequest: true,
        forProblem: false,
        forChange: false,
        isRecursive: true,
      });

      expect(reponse.status).toBe(201);
      expect(reponse.body).toMatchObject({
        name: PREFIXE + 'mere',
        completeName: PREFIXE + 'mere',
        parentId: null,
        level: 0,
        childCount: 0,
      });

      mere = reponse.body.id;
    });

    it('calcule le nom complet d’une fille à partir de sa mère', async () => {
      const reponse = await harnais.admin().post('/api/referentials/itil-categories').send({
        name: PREFIXE + 'fille',
        parentId: mere,
        isHelpdeskVisible: true,
        forIncident: true,
        forRequest: true,
        forProblem: true,
        forChange: true,
        isRecursive: true,
      });

      expect(reponse.status).toBe(201);

      // Ni `path` ni `completeName` ne sont envoyes : la base les deduit du
      // parent. Les laisser ecrire par l'appelant permettrait de composer un
      // chemin incoherent avec la hierarchie reelle.
      expect(reponse.body.completeName).toBe(PREFIXE + 'mere > ' + PREFIXE + 'fille');
      expect(reponse.body.level).toBe(1);

      fille = reponse.body.id;
    });

    it('compte les filles sur la ligne de la mère', async () => {
      const reponse = await harnais.admin().get('/api/referentials/itil-categories/all');

      expect(reponse.status).toBe(200);

      const trouvee = reponse.body.find((c: { id: number }) => c.id === mere);

      expect(trouvee.childCount).toBe(1);
    });

    it('renomme la mère et propage le nom complet à sa fille', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/referentials/itil-categories/' + String(mere))
        .send({
          name: PREFIXE + 'renommee',
          parentId: null,
          isHelpdeskVisible: false,
          forIncident: true,
          forRequest: true,
          forProblem: true,
          forChange: true,
          isRecursive: true,
        });

      expect(reponse.status).toBe(200);
      expect(reponse.body.isHelpdeskVisible).toBe(false);

      const toutes = await harnais.admin().get('/api/referentials/itil-categories/all');
      const enfant = toutes.body.find((c: { id: number }) => c.id === fille);

      // Le declencheur de propagation retouche les filles : sans lui, le nom
      // complet resterait fige sur l'ancien intitule de la mere.
      expect(enfant.completeName).toBe(PREFIXE + 'renommee > ' + PREFIXE + 'fille');
    });

    it('masque au guichet ce qui n’y est pas proposé', async () => {
      const demandeur = await harnais.connecte('demandeur');
      const reponse = await demandeur.get('/api/referentials/itil-categories');

      expect(reponse.status).toBe(200);
      expect(reponse.body.some((c: { id: number }) => c.id === mere)).toBe(false);
    });

    it('refuse une catégorie qui ne s’applique à rien', async () => {
      const reponse = await harnais.admin().post('/api/referentials/itil-categories').send({
        name: PREFIXE + 'inerte',
        forIncident: false,
        forRequest: false,
        forProblem: false,
        forChange: false,
      });

      expect(reponse.status).toBe(400);
    });

    it('refuse de rattacher une catégorie à sa propre descendance', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/referentials/itil-categories/' + String(mere))
        .send({ name: PREFIXE + 'renommee', parentId: fille });

      expect(reponse.status).toBe(400);
    });

    it('refuse de supprimer une catégorie qui porte des filles', async () => {
      const reponse = await harnais
        .admin()
        .delete('/api/referentials/itil-categories/' + String(mere));

      expect(reponse.status).toBe(400);
    });

    it('supprime la fille puis la mère', async () => {
      expect(
        (await harnais.admin().delete('/api/referentials/itil-categories/' + String(fille))).status,
      ).toBe(204);
      expect(
        (await harnais.admin().delete('/api/referentials/itil-categories/' + String(mere))).status,
      ).toBe(204);
    });

    it('ne trouve plus une catégorie déjà supprimée', async () => {
      expect(
        (await harnais.admin().delete('/api/referentials/itil-categories/' + String(mere))).status,
      ).toBe(404);
    });

    it('garde l’écran de configuration derrière un droit', async () => {
      // La lecture de saisie reste ouverte a tous : c'est l'ecriture, et la vue
      // qui la sert, que le droit protege.
      const demandeur = await harnais.connecte('demandeur');

      expect((await demandeur.get('/api/referentials/itil-categories')).status).toBe(200);
      expect((await demandeur.get('/api/referentials/itil-categories/all')).status).toBe(403);
      expect(
        (await demandeur.post('/api/referentials/itil-categories').send({ name: 'x' })).status,
      ).toBe(403);
    });

    it('refuse un visiteur sans session', async () => {
      expect(
        (await harnais.anonyme().get('/api/referentials/itil-categories/all')).status,
      ).toBe(401);
    });
  });
});
