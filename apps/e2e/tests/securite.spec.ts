import { expect, test } from '@playwright/test';
import { ADMIN, DEMANDEUR, MOT_DE_PASSE, TECHNICIEN, sessionDe, type Compte } from './comptes.js';

/**
 * Ce qui se paie comptant si ca casse.
 *
 * Ces scenarios ne verifient pas des ecrans mais des promesses : une session
 * fermee l'est vraiment, une recherche ne franchit pas les portees, une piece
 * jointe suit le droit de l'objet qui la porte, un article interne ne sort pas
 * en public, un jeton d'enquete ne s'invente pas.
 *
 * Ils passent volontairement par l'API depuis le navigateur : c'est ainsi qu'un
 * attaquant s'y prend, et cacher un bouton n'a jamais ferme une route.
 */

test.describe('Fermeture de session', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('se deconnecter invalide le cookie cote serveur', async ({ page }) => {
    await page.goto('/');
    const connexion = await page.request.post('/api/auth/login', {
      data: { username: TECHNICIEN.nom, password: MOT_DE_PASSE },
    });
    expect(connexion.ok()).toBeTruthy();

    // La session vit : sans cette verification, le test passerait aussi sur
    // une connexion qui n'a jamais fonctionne.
    expect((await page.request.get('/api/auth/session')).status()).toBe(200);

    await page.request.post('/api/auth/logout');

    // Le cookie est toujours dans le navigateur si le serveur a oublie de
    // l'effacer, et il pourrait etre rejoue. C'est le **serveur** qui doit
    // refuser, pas le navigateur oublier.
    expect(
      (await page.request.get('/api/auth/session')).status(),
      'Une session fermee doit etre refusee, meme si le cookie est rejoue.',
    ).toBe(401);
  });
});

test.describe('Recherche', () => {
  test.use({ storageState: sessionDe(TECHNICIEN) });

  test('ne franchit pas la portee du profil actif', async ({ page }) => {
    await page.goto('/search');

    const reponse = await page.request.post('/api/search/tickets', { data: {} });
    expect(reponse.ok()).toBeTruthy();

    const { items } = (await reponse.json()) as { items: { id: number; name: string }[] };
    const identifiants = items.map((t) => t.id);

    // Thomas est technicien sur Site A, sans descendance. Les tickets 3, 5 et 6
    // vivent ailleurs : une recherche qui les ramene contourne le
    // cloisonnement par un chemin que la navigation n'emprunte pas.
    expect(identifiants, 'La recherche ne doit ramener que Site A.').not.toContain(3);
    expect(identifiants).not.toContain(5);
    expect(identifiants).not.toContain(6);
    expect(items.length, 'Et elle doit tout de meme ramener quelque chose.').toBeGreaterThan(0);
  });

  test('un terme qui ne matche que hors portee ne ramene rien', async ({ browser }) => {
    const chercher = async (compte: Compte): Promise<number> => {
      const contexte = await browser.newContext({ storageState: sessionDe(compte) });
      const page = await contexte.newPage();
      await page.goto('/search');

      const reponse = await page.request.post('/api/search/tickets', {
        data: {
          criteria: {
            kind: 'criterion',
            field: 'ticket.name',
            operator: 'contains',
            value: 'comptabilite',
          },
        },
      });
      expect(reponse.ok(), `Recherche refusee (${String(reponse.status())}).`).toBeTruthy();

      const { items } = (await reponse.json()) as { items: unknown[] };
      await contexte.close();

      return items.length;
    };

    // « comptabilite » n'apparait que dans le ticket 6, hors de la portee de
    // Thomas. Le meme critere chez l'administrateur le trouve : sans ce
    // controle, un critere simplement mal ecrit passerait pour un
    // cloisonnement qui fonctionne.
    expect(await chercher(ADMIN), 'Le critere doit trouver le ticket pour qui y a droit.').toBe(1);
    expect(await chercher(TECHNICIEN), 'Et ne rien ramener a qui ne l a pas dans sa portee.').toBe(
      0,
    );
  });
});

test.describe('Pieces jointes', () => {
  test('une piece jointe suit le droit de l objet qui la porte', async ({ browser }) => {
    // Le ticket 6 appartient au demandeur. Un administrateur y depose un
    // fichier ; un technicien hors portee ne doit ni le lister ni le lire.
    const cote = await browser.newContext({ storageState: sessionDe(ADMIN) });
    const admin = await cote.newPage();
    await admin.goto('/tickets/6');
    await expect(
      admin.getByRole('heading', { name: 'Acces au partage comptabilite refuse' }),
    ).toBeVisible();

    const depot = await admin.request.post('/api/documents/items/ticket/6', {
      multipart: {
        file: {
          name: 'note-interne.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('Contenu reserve au service.'),
        },
      },
    });
    expect(depot.ok(), `Depot refuse (${String(depot.status())}).`).toBeTruthy();
    const document = (await depot.json()) as { id: number };
    await cote.close();

    const ailleurs = await browser.newContext({ storageState: sessionDe(TECHNICIEN) });
    const thomas = await ailleurs.newPage();
    await thomas.goto('/tickets');

    // Le Row-Level Security cloisonne par **entite**, pas par portee de droit :
    // il arrete une autre organisation, pas un collegue de la meme. C'est
    // l'objet porteur qui doit etre verifie, et ce test garde ce correctif.
    const liste = await thomas.request.get('/api/documents/items/ticket/6');
    expect(
      liste.status(),
      'Lister les pieces jointes d un ticket hors portee doit etre refuse.',
    ).toBeGreaterThanOrEqual(400);

    const contenu = await thomas.request.get(`/api/documents/${String(document.id)}/content`);
    expect(
      contenu.status(),
      'Telecharger une piece jointe hors portee doit etre refuse, meme avec son identifiant.',
    ).toBeGreaterThanOrEqual(400);
    await ailleurs.close();
  });

  test('le porteur legitime, lui, la retrouve', async ({ browser }) => {
    // Le pendant : sans lui, les refus ci-dessus passeraient sur une
    // fonctionnalite entierement cassee.
    const chez = await browser.newContext({ storageState: sessionDe(DEMANDEUR) });
    const demandeur = await chez.newPage();
    await demandeur.goto('/tickets/6');

    const liste = await demandeur.request.get('/api/documents/items/ticket/6');
    expect(
      liste.ok(),
      'Le demandeur doit voir les pieces jointes de sa propre demande.',
    ).toBeTruthy();

    const documents = (await liste.json()) as unknown[];
    expect(documents.length).toBeGreaterThan(0);
    await chez.close();
  });
});

test.describe('Base de connaissances', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('un article interne ne sort jamais en public', async ({ page }) => {
    await page.goto('/faq');

    const reponse = await page.request.get('/api/public/faq');
    const articles = (await reponse.json()) as { name: string }[];
    const noms = articles.map((a) => a.name);

    // Celui-la est marque interne dans le jeu de demonstration : il decrit une
    // procedure d'exploitation, et le publier renseignerait un inconnu sur le
    // fonctionnement interne du service.
    expect(noms, "L'article interne ne doit pas figurer dans la FAQ publique.").not.toContain(
      'Reinitialiser un mot de passe de session',
    );
    expect(
      noms.length,
      'Et la FAQ publique doit tout de meme publier quelque chose.',
    ).toBeGreaterThan(0);

    await expect(page.getByText(/Reinitialiser un mot de passe/)).toHaveCount(0);
  });
});

test.describe('Enquete de satisfaction', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('un jeton invente n ouvre aucune enquete', async ({ page }) => {
    await page.goto('/satisfaction/jeton-invente-au-hasard-1234567890');

    // Une enquete se repond sans compte : le jeton est la seule barriere, et
    // il doit se comporter comme telle.
    await expect(page.getByText(/introuvable|n’est plus disponible/i)).toBeVisible();
  });

  test('la route publique refuse un jeton inconnu', async ({ page }) => {
    await page.goto('/faq');

    const reponse = await page.request.get('/api/public/satisfaction/jeton-invente-au-hasard');
    expect(reponse.status()).toBe(404);
  });
});
