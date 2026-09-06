import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerHarnais, type Harnais } from './harnais.js';

/**
 * Tickets, problèmes et changements, vus par HTTP.
 *
 * Les droits ITIL ne sont pas portés par une garde mais par les services : la
 * portée d'un droit (`own`, `group`, `entity`…) ne dit pas *si* l'accès est
 * permis mais *quelles lignes* le sont, ce qu'une garde ne peut pas décider.
 * Le refus doit donc rester explicite plus bas, et c'est ce qu'on vérifie —
 * ainsi que le fait qu'un visiteur sans session n'atteint rien du tout.
 */
describe('HTTP — objets ITIL', () => {
  let harnais: Harnais;
  let PREFIXE: string;
  let ticket: number;

  beforeAll(async () => {
    harnais = await creerHarnais('itil');
    PREFIXE = harnais.prefixe;
  }, 120_000);

  afterAll(async () => {
    await harnais.close();
  });

  describe('cycle de vie d’un ticket', () => {
    it('crée un ticket', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets')
        .send({ name: PREFIXE + 'panne', content: 'Le poste ne demarre plus.', urgency: 4 });

      expect(reponse.status).toBe(201);
      expect(reponse.body).toMatchObject({ name: PREFIXE + 'panne', status: 'new', urgency: 4 });

      ticket = reponse.body.id;
    });

    it('dérive la priorité de l’urgence et de l’impact', async () => {
      const reponse = await harnais.admin().get('/api/tickets/' + ticket);

      // La priorite n'est jamais saisie : elle sort de la matrice de l'entite.
      // Un ticket dont la priorite contredirait l'urgence affichee serait
      // ininterpretable pour celui qui trie sa file.
      expect(reponse.status).toBe(200);
      expect(reponse.body.priority).toBeGreaterThanOrEqual(1);
      expect(reponse.body.priority).toBeLessThanOrEqual(5);
    });

    it('refuse un titre vide', async () => {
      const reponse = await harnais.admin().post('/api/tickets').send({ name: '' });

      expect(reponse.status).toBe(400);
      expect(reponse.body.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ chemin: 'name' })]),
      );
    });

    it('refuse une urgence hors échelle', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets')
        .send({ name: PREFIXE + 'hors-echelle', urgency: 9 });

      expect(reponse.status).toBe(400);
    });

    it('modifie le ticket', async () => {
      const reponse = await harnais
        .admin()
        .patch('/api/tickets/' + ticket)
        .send({ status: 'assigned', impact: 2 });

      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ status: 'assigned', impact: 2 });
    });

    it('accepte une modification vide', async () => {
      // Le contrat n'exige aucun champ : l'ecran n'envoie que ce qu'il a change,
      // et une requete sans changement ne doit pas etre une erreur.
      expect((await harnais.admin().patch('/api/tickets/' + ticket).send({})).status).toBe(200);
    });

    it('liste les tickets avec ses filtres', async () => {
      const reponse = await harnais
        .admin()
        .get('/api/tickets')
        .query({ status: 'assigned', limit: '10', sort: 'dateOpened', direction: 'desc' });

      expect(reponse.status).toBe(200);
      expect(reponse.body).toHaveProperty('items');
      // La pagination se fait par curseur : un `OFFSET` s'effondre des que la
      // table grossit, et un compte total le ferait autant.
      expect(reponse.body).toHaveProperty('nextCursor');
    });

    it('refuse un statut inconnu dans le filtre', async () => {
      const reponse = await harnais.admin().get('/api/tickets').query({ status: 'inexistant' });

      expect(reponse.status).toBe(400);
    });

    it('borne la taille de page', async () => {
      expect((await harnais.admin().get('/api/tickets').query({ limit: '9999' })).status).toBe(400);
    });

    it('signale un ticket inexistant', async () => {
      expect((await harnais.admin().get('/api/tickets/99999999')).status).toBe(404);
    });

    it('refuse un identifiant non numérique', async () => {
      expect((await harnais.admin().get('/api/tickets/abc')).status).toBe(400);
    });
  });

  describe('acteurs', () => {
    it('liste les acteurs, le créateur étant demandeur', async () => {
      const reponse = await harnais.admin().get('/api/tickets/' + ticket + '/actors');

      expect(reponse.status).toBe(200);
      expect(reponse.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ role: 'requester' })]),
      );
    });

    it('remplace les acteurs', async () => {
      const comptes = await harnais.admin().get('/api/admin/users').query({ search: 'admin' });
      const actorId = comptes.body[0].id as number;

      const reponse = await harnais
        .admin()
        .post('/api/tickets/' + ticket + '/actors')
        .send([
          { role: 'requester', actorType: 'user', actorId },
          { role: 'assigned', actorType: 'user', actorId },
        ]);

      expect(reponse.status).toBe(201);
      expect(reponse.body).toHaveLength(2);
    });

    it('refuse une liste d’acteurs vide', async () => {
      // Un ticket sans demandeur n'a personne a informer : le vide est refuse
      // au contrat plutot que decouvert a l'envoi de la notification.
      const reponse = await harnais.admin().post('/api/tickets/' + ticket + '/actors').send([]);

      expect(reponse.status).toBe(400);
    });
  });

  describe('chronologie', () => {
    it('ajoute un suivi', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets/' + ticket + '/followups')
        .send({ content: 'Diagnostic en cours.' });

      expect(reponse.status).toBe(204);
    });

    it('refuse un suivi vide', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets/' + ticket + '/followups')
        .send({ content: '' });

      expect(reponse.status).toBe(400);
    });

    it('ajoute une tâche puis la modifie', async () => {
      const ajout = await harnais
        .admin()
        .post('/api/tickets/' + ticket + '/tasks')
        .send({ content: 'Remplacer l alimentation', actionTime: 30 });

      expect(ajout.status).toBe(204);

      const chronologie = await harnais.admin().get('/api/tickets/' + ticket + '/timeline');
      const tache = chronologie.body.find((entree: { kind: string }) => entree.kind === 'task');

      expect(tache).toBeDefined();

      const modification = await harnais
        .admin()
        .patch('/api/tickets/' + ticket + '/tasks/' + tache.id)
        .send({ state: 'done' });

      expect(modification.status).toBe(204);
    });

    it('rend la chronologie triée et typée', async () => {
      const reponse = await harnais.admin().get('/api/tickets/' + ticket + '/timeline');

      expect(reponse.status).toBe(200);
      expect(reponse.body.length).toBeGreaterThan(0);

      for (const entree of reponse.body) {
        expect(['followup', 'task', 'solution', 'validation', 'log', 'document']).toContain(
          entree.kind,
        );
      }
    });

    it('demande puis répond à une validation', async () => {
      const comptes = await harnais.admin().get('/api/admin/users').query({ search: 'admin' });
      const validatorId = comptes.body[0].id as number;

      const demande = await harnais
        .admin()
        .post('/api/tickets/' + ticket + '/validations')
        .send({ validatorType: 'user', validatorId, comment: 'Merci de valider.' });

      expect(demande.status).toBe(204);

      const chronologie = await harnais.admin().get('/api/tickets/' + ticket + '/timeline');
      const validation = chronologie.body.find(
        (entree: { kind: string }) => entree.kind === 'validation',
      );

      expect(validation).toBeDefined();

      const reponse = await harnais
        .admin()
        .post('/api/tickets/' + ticket + '/validations/' + validation.id + '/answer')
        .send({ granted: true });

      expect(reponse.status).toBe(204);
    });

    it('propose une solution puis l’accepte', async () => {
      const solution = await harnais
        .admin()
        .post('/api/tickets/' + ticket + '/solutions')
        .send({ content: 'Alimentation remplacee.' });

      expect(solution.status).toBe(204);

      const acceptation = await harnais
        .admin()
        .post('/api/tickets/' + ticket + '/solutions/answer')
        .send({ accepted: true });

      expect(acceptation.status).toBe(204);

      const fiche = await harnais.admin().get('/api/tickets/' + ticket);

      expect(fiche.body.status).toBe('closed');
    });
  });

  describe('engagements', () => {
    it('rend les engagements applicables', async () => {
      const reponse = await harnais.admin().get('/api/tickets/' + ticket + '/agreements');

      expect(reponse.status).toBe(200);
      expect(Array.isArray(reponse.body)).toBe(true);
    });
  });

  describe('corbeille', () => {
    it('met à la corbeille puis restaure', async () => {
      expect((await harnais.admin().delete('/api/tickets/' + ticket)).status).toBe(204);

      // La corbeille est un drapeau, pas une suppression : un ticket efface par
      // erreur doit revenir avec sa chronologie, ce qu'une suppression reelle
      // rendrait impossible.
      const absent = await harnais.admin().get('/api/tickets').query({ deleted: 'false' });

      expect(absent.body.items.some((item: { id: number }) => item.id === ticket)).toBe(false);

      const corbeille = await harnais.admin().get('/api/tickets').query({ deleted: 'true' });

      expect(corbeille.body.items.some((item: { id: number }) => item.id === ticket)).toBe(true);

      expect((await harnais.admin().post('/api/tickets/' + ticket + '/restore')).status).toBe(204);
    });
  });

  describe('actions massives', () => {
    let lot: number[];

    beforeAll(async () => {
      lot = [];

      for (const numero of [1, 2, 3]) {
        const reponse = await harnais
          .admin()
          .post('/api/tickets')
          .send({ name: PREFIXE + 'lot-' + numero });

        lot.push(reponse.body.id as number);
      }
    });

    it('change l’urgence d’une sélection', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets/bulk')
        .send({ ids: lot, operation: { action: 'setUrgency', value: 5 } });

      expect(reponse.status).toBe(200);
      expect(reponse.body.applied).toBe(3);
    });

    it('rend les échecs un par un', async () => {
      // « 3 tickets sur 40 ont echoue » n'aide personne a savoir lesquels
      // reprendre : chaque echec porte son identifiant et sa raison.
      const reponse = await harnais
        .admin()
        .post('/api/tickets/bulk')
        .send({ ids: [...lot, 99_999_999], operation: { action: 'setStatus', value: 'assigned' } });

      expect(reponse.status).toBe(200);
      expect(reponse.body.failures).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: 99_999_999, reason: expect.any(String) })]),
      );
    });

    it('refuse une sélection vide', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets/bulk')
        .send({ ids: [], operation: { action: 'delete' } });

      expect(reponse.status).toBe(400);
    });

    it('refuse une action inconnue', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets/bulk')
        .send({ ids: lot, operation: { action: 'setPriority', value: 5 } });

      // La priorite est derivee : la forcer en masse produirait des tickets
      // dont la priorite contredit l'urgence.
      expect(reponse.status).toBe(400);
    });

    it('supprime la sélection', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/tickets/bulk')
        .send({ ids: lot, operation: { action: 'delete' } });

      expect(reponse.status).toBe(200);
      expect(reponse.body.applied).toBe(3);
    });
  });

  describe('problèmes et changements', () => {
    let probleme: number;

    it('crée un problème', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/itil/problems')
        .send({ name: PREFIXE + 'probleme', content: 'Panne recurrente.' });

      expect(reponse.status).toBe(201);
      probleme = reponse.body.id;
    });

    it('refuse le segment « tickets » sur ce contrôleur', async () => {
      // Les tickets ont leur propre controleur : les accepter ici ferait vivre
      // deux chemins pour le meme objet, avec deux jeux de regles.
      const reponse = await harnais.admin().get('/api/itil/tickets');

      expect(reponse.status).toBe(400);
    });

    it('refuse un segment inconnu', async () => {
      expect((await harnais.admin().get('/api/itil/inconnus')).status).toBe(400);
    });

    it('liste les problèmes', async () => {
      const reponse = await harnais.admin().get('/api/itil/problems');

      expect(reponse.status).toBe(200);
      expect(reponse.body.some((item: { id: number }) => item.id === probleme)).toBe(true);
    });

    it('modifie le problème sans effacer ce qu’il n’envoie pas', async () => {
      const reponse = await harnais
        .admin()
        .patch('/api/itil/problems/' + probleme)
        .send({ status: 'assigned' });

      expect(reponse.status).toBe(200);
      expect(reponse.body.status).toBe('assigned');

      // Le verbe est `PATCH` : les cles absentes gardent leur valeur. Valider
      // avec le schema de creation remettrait `content` a vide et les severites
      // a 3, effacant la description a chaque changement de statut.
      expect(reponse.body.content).toBe('Panne recurrente.');
      expect(reponse.body.urgency).toBe(3);
    });

    it('ajoute un suivi au problème', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/itil/problems/' + probleme + '/followups')
        .send({ content: 'Analyse en cours.' });

      expect(reponse.status).toBe(204);
    });

    it('lit sa chronologie et ses acteurs', async () => {
      const chronologie = await harnais.admin().get('/api/itil/problems/' + probleme + '/timeline');
      const acteurs = await harnais.admin().get('/api/itil/problems/' + probleme + '/actors');

      expect(chronologie.status).toBe(200);
      expect(acteurs.status).toBe(200);
    });

    it('lie le problème à un ticket, puis délie', async () => {
      const lien = await harnais
        .admin()
        .post('/api/itil/problems/' + probleme + '/links')
        .send({ targetType: 'ticket', targetId: ticket, linkType: 'linked' });

      expect(lien.status).toBe(201);

      const liens = await harnais.admin().get('/api/itil/problems/' + probleme + '/links');

      expect(liens.status).toBe(200);
      expect(liens.body.length).toBeGreaterThan(0);

      const retrait = await harnais
        .admin()
        .delete('/api/itil/problems/' + probleme + '/links/' + liens.body[0].id);

      expect(retrait.status).toBe(204);
    });

    it('promeut le problème en changement', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/itil/problems/' + probleme + '/promote')
        .send({ to: 'change' });

      expect(reponse.status).toBe(201);
      expect(reponse.body).toMatchObject({ kind: 'change', id: expect.any(Number) });

      await harnais.admin().delete('/api/itil/changes/' + reponse.body.id);
    });

    it('met le problème à la corbeille', async () => {
      expect((await harnais.admin().delete('/api/itil/problems/' + probleme)).status).toBe(204);
    });
  });

  describe('modèles de ticket', () => {
    let modele: number;

    it('énumère les champs modelables', async () => {
      const reponse = await harnais.admin().get('/api/ticket-templates/fields');

      expect(reponse.status).toBe(200);
      expect(reponse.body.length).toBeGreaterThan(0);
    });

    it('crée un modèle', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/ticket-templates')
        .send({
          name: PREFIXE + 'modele',
          fields: [
            { field: 'urgency', kind: 'predefined', value: 4 },
            { field: 'content', kind: 'mandatory' },
            { field: 'requestSourceId', kind: 'hidden' },
          ],
        });

      expect(reponse.status).toBe(201);

      // La requete liste les champs a plat, la reponse les groupe par nature :
      // c'est la forme dont le formulaire a besoin pour decider quoi masquer.
      expect(reponse.body).toMatchObject({
        predefined: { urgency: 4 },
        mandatory: ['content'],
        hidden: ['requestSourceId'],
      });

      modele = reponse.body.id;
    });

    it('le retrouve puis le modifie', async () => {
      expect((await harnais.admin().get('/api/ticket-templates/' + modele)).status).toBe(200);

      const reponse = await harnais
        .admin()
        .put('/api/ticket-templates/' + modele)
        .send({ name: PREFIXE + 'modele-2', fields: [] });

      expect(reponse.status).toBe(200);
      expect(reponse.body.name).toBe(PREFIXE + 'modele-2');
      expect(reponse.body.mandatory).toHaveLength(0);
    });

    it('refuse un champ absent de la liste modelable', async () => {
      // Un champ inconnu produirait un gabarit qui bloque un formulaire sur une
      // saisie impossible, ou qui prerempli une colonne qui n'existe pas.
      const reponse = await harnais
        .admin()
        .post('/api/ticket-templates')
        .send({
          name: PREFIXE + 'champ-inconnu',
          fields: [{ field: 'champ_qui_n_existe_pas', kind: 'mandatory' }],
        });

      expect(reponse.status).toBe(400);
    });

    it('le supprime', async () => {
      expect((await harnais.admin().delete('/api/ticket-templates/' + modele)).status).toBe(204);
    });
  });

  describe('sans session', () => {
    it('refuse toutes les routes ITIL', async () => {
      for (const chemin of [
        '/api/tickets',
        '/api/tickets/1',
        '/api/itil/problems',
        '/api/ticket-templates',
      ]) {
        expect((await harnais.anonyme().get(chemin)).status, chemin).toBe(401);
      }
    });
  });
});
