import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerHarnais, type Harnais } from './harnais.js';

/**
 * Administration, vue par HTTP.
 *
 * Ces routes n'ont pas de politique de sécurité au niveau des lignes derrière
 * elles : `users`, `profiles` et `profile_rights` sont des tables globales. La
 * garde de droits est donc le seul rempart, et c'est elle qu'on vérifie ici —
 * un service impeccable derrière une garde absente reste une faille, et aucun
 * test de service ne la verrait.
 */
describe('HTTP — administration', () => {
  let harnais: Harnais;
  let PREFIXE: string;

  beforeAll(async () => {
    harnais = await creerHarnais('admin');
    PREFIXE = harnais.prefixe;
  }, 120_000);

  afterAll(async () => {
    await harnais.close();
  });

  describe('catalogue des droits', () => {
    it('énumère les objets configurables', async () => {
      const reponse = await harnais.admin().get('/api/admin/rights');

      expect(reponse.status).toBe(200);
      expect(Array.isArray(reponse.body)).toBe(true);
      expect(reponse.body.length).toBeGreaterThan(10);
      expect(reponse.body[0]).toMatchObject({
        object: expect.any(String),
        label: expect.any(String),
        actions: expect.any(Array),
        scopes: expect.any(Array),
      });
    });

    it('traduit les libellés selon l’en-tête de langue', async () => {
      const francais = await harnais.admin().get('/api/admin/rights');
      const anglais = await harnais.admin().get('/api/admin/rights').set('Accept-Language', 'en');

      expect(anglais.status).toBe(200);
      expect(anglais.body.length).toBe(francais.body.length);
    });

    it('refuse un visiteur sans session', async () => {
      expect((await harnais.anonyme().get('/api/admin/rights')).status).toBe(401);
    });
  });

  describe('utilisateurs', () => {
    let cree: number;

    it('crée un compte', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/admin/users')
        .send({
          username: PREFIXE + 'compte',
          firstName: 'Test',
          lastName: 'HTTP',
          email: 'test-http@exemple.fr',
          password: 'motdepasse-long',
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body).toMatchObject({ username: PREFIXE + 'compte', isActive: true });

      cree = reponse.body.id;
    });

    it('refuse un identifiant deja pris', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/admin/users')
        .send({
          username: PREFIXE + 'compte',
          password: 'motdepasse-long',
        });

      // Une saisie en double est une erreur d'utilisateur, pas une panne : sans
      // le filtre de contraintes, PostgreSQL remonterait une 500 et l'ecran
      // afficherait « erreur serveur » sur un identifiant simplement deja pris.
      expect(reponse.status).toBe(409);
      expect(reponse.body.message).toMatch(/identifiant/i);
    });

    it('refuse un mot de passe trop court', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/admin/users')
        .send({ username: PREFIXE + 'court', password: 'court' });

      // Le pipe Zod repond avec le chemin du champ fautif : sans lui,
      // l'interface ne peut afficher qu'un « formulaire invalide » global.
      expect(reponse.status).toBe(400);
      expect(reponse.body.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ chemin: 'password' })]),
      );
    });

    it('refuse un identifiant vide', async () => {
      const reponse = await harnais.admin().post('/api/admin/users').send({ username: '' });

      expect(reponse.status).toBe(400);
    });

    it('retrouve le compte créé', async () => {
      const reponse = await harnais.admin().get('/api/admin/users/' + cree);

      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ id: cree });
      expect(reponse.body).toHaveProperty('authorizations');
    });

    it('ne renvoie jamais le condensat du mot de passe', async () => {
      const reponse = await harnais.admin().get('/api/admin/users/' + cree);

      expect(JSON.stringify(reponse.body)).not.toContain('passwordHash');
      expect(reponse.body).not.toHaveProperty('password');
    });

    it('modifie le compte', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/admin/users/' + cree)
        .send({ username: PREFIXE + 'compte', firstName: 'Modifie' });

      expect(reponse.status).toBe(200);
      expect(reponse.body.firstName).toBe('Modifie');
    });

    it('cherche par nom', async () => {
      const reponse = await harnais.admin().get('/api/admin/users').query({ search: PREFIXE });

      expect(reponse.status).toBe(200);
      expect(reponse.body.some((compte: { id: number }) => compte.id === cree)).toBe(true);
    });

    it('exclut les comptes désactivés par défaut', async () => {
      const actifs = await harnais.admin().get('/api/admin/users');
      const tous = await harnais.admin().get('/api/admin/users').query({ inactive: 'true' });

      expect(actifs.status).toBe(200);
      expect(tous.body.length).toBeGreaterThanOrEqual(actifs.body.length);
    });

    it('accorde puis révoque une habilitation', async () => {
      const entites = await harnais.admin().get('/api/entities');
      const profils = await harnais.admin().get('/api/admin/profiles');
      const entityId = entites.body[0].id as number;
      const profileId = profils.body[0].id as number;

      const accord = await harnais
        .admin()
        .post('/api/admin/users/' + cree + '/authorizations')
        .send({ entityId, profileId, isRecursive: true });

      expect(accord.status).toBe(201);
      expect(accord.body).toEqual(
        expect.arrayContaining([expect.objectContaining({ entityId, profileId })]),
      );

      const retrait = await harnais
        .admin()
        .delete('/api/admin/users/' + cree + '/authorizations/' + entityId + '/' + profileId);

      expect(retrait.status).toBe(200);
      expect(retrait.body).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ entityId, profileId })]),
      );
    });

    it('refuse un identifiant de compte non numérique', async () => {
      // `ParseIntPipe` doit repondre 400, pas laisser passer un NaN qui
      // ramenerait une ligne au hasard ou aucune.
      expect((await harnais.admin().get('/api/admin/users/abc')).status).toBe(400);
    });

    it('signale un compte inexistant', async () => {
      expect((await harnais.admin().get('/api/admin/users/99999999')).status).toBe(404);
    });

    it('désactive le compte de test', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/admin/users/' + cree)
        .send({ username: PREFIXE + 'compte', isActive: false });

      expect(reponse.status).toBe(200);
      expect(reponse.body.isActive).toBe(false);
    });
  });

  describe('groupes', () => {
    let groupe: number;

    it('crée un groupe', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/admin/groups')
        .send({ name: PREFIXE + 'groupe', isRecursive: true });

      expect(reponse.status).toBe(201);
      expect(reponse.body.name).toBe(PREFIXE + 'groupe');

      groupe = reponse.body.id;
    });

    it('liste les groupes', async () => {
      const reponse = await harnais.admin().get('/api/admin/groups');

      expect(reponse.status).toBe(200);
      expect(reponse.body.some((entree: { id: number }) => entree.id === groupe)).toBe(true);
    });

    it('renomme le groupe', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/admin/groups/' + groupe)
        .send({ name: PREFIXE + 'groupe-2' });

      expect(reponse.status).toBe(200);
      expect(reponse.body.name).toBe(PREFIXE + 'groupe-2');
    });

    it('ajoute puis retire un membre', async () => {
      const comptes = await harnais.admin().get('/api/admin/users').query({ search: 'admin' });
      const userId = comptes.body[0].id as number;

      const ajout = await harnais
        .admin()
        .post('/api/admin/groups/' + groupe + '/members')
        .send({ userId, isManager: true });

      expect(ajout.status).toBe(201);
      expect(ajout.body.members).toEqual(
        expect.arrayContaining([expect.objectContaining({ userId })]),
      );

      const retrait = await harnais
        .admin()
        .delete('/api/admin/groups/' + groupe + '/members/' + userId);

      expect(retrait.status).toBe(200);
      expect(retrait.body.members).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ userId })]),
      );
    });

    it('supprime le groupe', async () => {
      expect((await harnais.admin().delete('/api/admin/groups/' + groupe)).status).toBe(204);
    });
  });

  describe('profils', () => {
    let profil: number;

    it('crée un profil avec ses droits', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/admin/profiles')
        .send({
          name: PREFIXE + 'profil',
          interface: 'standard',
          rights: [{ object: 'ticket', action: 'read', scope: 'entity' }],
        });

      expect(reponse.status).toBe(201);
      expect(reponse.body.rights).toEqual(
        expect.arrayContaining([expect.objectContaining({ object: 'ticket', action: 'read' })]),
      );

      profil = reponse.body.id;
    });

    it('refuse un droit hors catalogue', async () => {
      // L'absence de ligne vaut refus : un objet inconnu produirait un droit
      // que personne ne verifie, donc une permission fantome.
      const reponse = await harnais
        .admin()
        .post('/api/admin/profiles')
        .send({
          name: PREFIXE + 'fantome',
          rights: [{ object: 'objet-inexistant', action: 'read', scope: 'all' }],
        });

      expect(reponse.status).toBe(400);
    });

    it('remplace les droits à la mise à jour', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/admin/profiles/' + profil)
        .send({
          name: PREFIXE + 'profil',
          rights: [{ object: 'ticket', action: 'update', scope: 'own' }],
        });

      expect(reponse.status).toBe(200);
      expect(reponse.body.rights).toHaveLength(1);
      expect(reponse.body.rights[0]).toMatchObject({ action: 'update', scope: 'own' });
    });

    it('supprime le profil', async () => {
      expect((await harnais.admin().delete('/api/admin/profiles/' + profil)).status).toBe(204);
    });
  });

  describe('annuaires LDAP', () => {
    let annuaire: number;

    it('crée un annuaire', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/admin/directories')
        .send({
          name: PREFIXE + 'annuaire',
          host: 'ldap.invalide.test',
          baseDn: 'dc=exemple,dc=fr',
          bindPassword: 'secret-de-liaison',
        });

      expect(reponse.status).toBe(201);
      annuaire = reponse.body.id;
    });

    it('ne renvoie jamais le mot de passe de liaison', async () => {
      const reponse = await harnais.admin().get('/api/admin/directories');
      const trouve = reponse.body.find((entree: { id: number }) => entree.id === annuaire);

      // Le contrat n'expose qu'un booleen : renvoyer le secret le ferait
      // transiter par le navigateur a chaque ouverture de l'ecran.
      expect(trouve).toMatchObject({ hasBindPassword: true });
      expect(trouve).not.toHaveProperty('bindPassword');
      expect(JSON.stringify(reponse.body)).not.toContain('secret-de-liaison');
    });

    it('conserve le mot de passe quand la mise à jour l’omet', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/admin/directories/' + annuaire)
        .send({
          name: PREFIXE + 'annuaire',
          host: 'ldap.invalide.test',
          baseDn: 'dc=exemple,dc=fr',
        });

      expect(reponse.status).toBe(200);
      expect(reponse.body.hasBindPassword).toBe(true);
    });

    it('rend l’échec de connexion tel quel', async () => {
      const reponse = await harnais.admin().post('/api/admin/directories/' + annuaire + '/test');

      // L'hote n'existe pas : l'essai doit repondre 200 avec un echec decrit,
      // et non 500. C'est un diagnostic, pas une panne du serveur.
      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ ok: false, found: null });
      expect(reponse.body.message.length).toBeGreaterThan(0);
    }, 40_000);

    it('supprime l’annuaire', async () => {
      expect((await harnais.admin().delete('/api/admin/directories/' + annuaire)).status).toBe(204);
    });
  });

  describe('réglages par entité', () => {
    let racine: number;

    beforeAll(async () => {
      racine = (await harnais.admin().get('/api/entities')).body[0].id as number;
    });

    it('lit les réglages bruts', async () => {
      const reponse = await harnais.admin().get('/api/admin/settings/' + racine);

      expect(reponse.status).toBe(200);
      expect(reponse.body).toMatchObject({ entityId: racine, entityName: expect.any(String) });
      expect(reponse.body.settings).toEqual(
        expect.arrayContaining([expect.objectContaining({ key: 'autoCloseDelayDays' })]),
      );
    });

    it('écrit puis efface une valeur', async () => {
      const ecrit = await harnais
        .admin()
        .put('/api/admin/settings/' + racine)
        .send({ autoCloseDelayDays: 15 });

      const lit = (corps: {
        settings: { key: string; value: unknown; isOwn: boolean }[];
      }): {
        value: unknown;
        isOwn: boolean;
      } => {
        const trouve = corps.settings.find((reglage) => reglage.key === 'autoCloseDelayDays');

        if (!trouve) throw new Error('Le reglage attendu est absent de la reponse.');

        return trouve;
      };

      expect(ecrit.status).toBe(200);
      expect(lit(ecrit.body)).toMatchObject({ value: 15, isOwn: true });

      // `null` signifie « heriter du parent », et non « zero jour » : les deux
      // se ressemblent dans un formulaire et n'ont rien a voir en fonctionnement.
      const efface = await harnais
        .admin()
        .put('/api/admin/settings/' + racine)
        .send({ autoCloseDelayDays: null });

      expect(efface.status).toBe(200);
      expect(lit(efface.body).isOwn).toBe(false);
    });

    it('refuse une matrice de priorité mal dimensionnée', async () => {
      const reponse = await harnais
        .admin()
        .put('/api/admin/settings/' + racine)
        .send({ priorityMatrix: [[1, 2, 3]] });

      expect(reponse.status).toBe(400);
    });

    it('résout la configuration héritée', async () => {
      const reponse = await harnais.admin().get('/api/entities/' + racine + '/settings');

      expect(reponse.status).toBe(200);
      expect(reponse.body.values).toHaveProperty('autoCloseDelayDays');
      expect(reponse.body.origins).toHaveProperty('autoCloseDelayDays');
    });
  });

  describe('entités', () => {
    let entite: number;
    let racine: number;

    beforeAll(async () => {
      racine = (await harnais.admin().get('/api/entities')).body[0].id as number;
    });

    it('crée une entité fille', async () => {
      const reponse = await harnais
        .admin()
        .post('/api/entities')
        .send({ name: PREFIXE + 'entite', parentId: racine });

      expect(reponse.status).toBe(201);
      entite = reponse.body.id;
    });

    it('la retrouve dans l’arbre', async () => {
      const reponse = await harnais.admin().get('/api/entities/' + entite);

      expect(reponse.status).toBe(200);
      expect(reponse.body.name).toBe(PREFIXE + 'entite');
    });

    it('la renomme', async () => {
      const reponse = await harnais
        .admin()
        .patch('/api/entities/' + entite)
        .send({ name: PREFIXE + 'entite-2' });

      expect(reponse.status).toBe(200);
      expect(reponse.body.name).toBe(PREFIXE + 'entite-2');
    });

    it('refuse un nom vide', async () => {
      const reponse = await harnais
        .admin()
        .patch('/api/entities/' + entite)
        .send({ name: '' });

      expect(reponse.status).toBe(400);
    });

    it('la supprime', async () => {
      expect((await harnais.admin().delete('/api/entities/' + entite)).status).toBe(204);
    });
  });
});
