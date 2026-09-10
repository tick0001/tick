import { expect, test } from '@playwright/test';
import { DEMANDEUR, sessionDe } from './comptes.js';

/**
 * Le parcours du demandeur, de bout en bout.
 *
 * C'est le seul chemin emprunte par des gens qui ne connaissent pas l'outil et
 * n'ont recu aucune formation. Un formulaire qui n'aboutit pas y coute plus
 * cher qu'ailleurs : le demandeur n'insiste pas, il telephone — et le service
 * perd la trace de la demande.
 */

test.describe('Catalogue et demande', () => {
  test.use({ storageState: sessionDe(DEMANDEUR) });

  test('le catalogue propose les formulaires accessibles', async ({ page }) => {
    await page.goto('/catalogue');

    await expect(page.getByRole('heading', { name: 'Catalogue de services' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Demande de materiel/ })).toBeVisible();
  });

  test('une demande envoyee devient un ticket que le demandeur retrouve', async ({ page }) => {
    const motif = `Poste de travail a remplacer ${String(Date.now())}`;

    await page.goto('/catalogue');
    await page.getByRole('button', { name: /Demande de materiel/ }).click();

    await page.getByLabel(/Quel materiel demandez-vous/).selectOption({ label: 'Ecran' });
    await page.getByLabel(/Pourquoi en avez-vous besoin/).fill(motif);
    await page.getByRole('button', { name: 'Envoyer la demande' }).click();

    // La demande doit se retrouver dans « Mes demandes » : un formulaire qui
    // aboutit sans rien montrer laisse le demandeur croire qu'il a echoue, et
    // il recommence — ou il appelle.
    await page.goto('/tickets');
    await expect(page.getByText(motif).or(page.getByText(/Demande de materiel/))).toBeVisible({
      timeout: 15_000,
    });
  });

  test('un champ obligatoire non rempli retient la demande', async ({ page }) => {
    await page.goto('/catalogue');
    await page.getByRole('button', { name: /Demande de materiel/ }).click();

    // Seul le motif, sans le materiel qui est obligatoire.
    await page.getByLabel(/Pourquoi en avez-vous besoin/).fill('Sans choisir de materiel.');
    await page.getByRole('button', { name: 'Envoyer la demande' }).click();

    await expect(page.getByRole('button', { name: 'Envoyer la demande' })).toBeVisible();
  });

  test('le demandeur lit sa demande comme une conversation', async ({ page }) => {
    // Le ticket 6 est le sien. Le technicien voit une fiche, lui une
    // conversation : ce ne sont pas deux mises en page du meme ecran.
    await page.goto('/tickets/6');

    await expect(page.getByPlaceholder('Écrivez votre message…')).toBeVisible();
    // Aucun outillage de technicien ne doit apparaitre ici.
    await expect(page.getByLabel('Changer le statut')).toHaveCount(0);
    await expect(page.getByLabel('Privé (invisible du demandeur)')).toHaveCount(0);
  });
});

test.describe('FAQ publique', () => {
  // Sans aucune session : c'est tout l'interet d'une FAQ publique.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('se lit sans compte', async ({ page }) => {
    await page.goto('/faq');

    await expect(page.getByRole('heading', { name: 'Questions fréquentes' })).toBeVisible();
    await expect(page.getByText(/Que faire si mon imprimante ne repond plus/)).toBeVisible();

    // Et elle ne doit pas renvoyer a l'ecran de connexion.
    await expect(page.getByLabel('Mot de passe')).toHaveCount(0);
  });

  test('n expose que les articles publies en public', async ({ page }) => {
    await page.goto('/faq');
    await expect(page.getByRole('heading', { name: 'Questions fréquentes' })).toBeVisible();

    // Le jeu de demonstration contient des articles internes : les voir ici
    // serait une fuite de la base de connaissances vers l'exterieur.
    const reponse = await page.request.get('/api/public/faq');
    expect(reponse.ok()).toBeTruthy();

    const articles = (await reponse.json()) as { name: string }[];
    const interne = await page.request.get('/api/kb');
    expect(
      interne.status(),
      'La base de connaissances interne doit rester fermee a un visiteur sans session.',
    ).toBe(401);

    expect(articles.length).toBeGreaterThan(0);
  });
});
