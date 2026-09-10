import { expect, test, type Page } from '@playwright/test';
import { ADMIN, DEMANDEUR, SUPERVISEUR, TECHNICIEN, sessionDe, type Compte } from './comptes.js';

/**
 * Le cloisonnement, verifie de bout en bout.
 *
 * C'est la promesse centrale du produit, et la seule dont un defaut se paie
 * comptant : un technicien qui lit les tickets d'une autre organisation. Le
 * Row-Level Security de PostgreSQL est deja couvert par les tests
 * d'integration ; ce qui ne l'est nulle part, c'est la chaine complete —
 * navigateur, cookie, API, base — et surtout **l'acces direct par URL**, qui
 * contourne toute la navigation.
 *
 * Le jeu de demonstration donne quatre portees emboitees, et c'est ce qui rend
 * ces scenarios possibles :
 *
 *   admin      Racine, recursif      tickets 1 a 7
 *   sophie     Filiale Nord, recursif    1, 2, 3, 5
 *   thomas     Site A, non recursif      1, 2
 *   demandeur  DSI, ses tickets a lui    6
 */

/** Le nombre de lignes du tableau des tickets, une fois la page etablie. */
async function ticketsVisibles(page: Page): Promise<number> {
  await page.goto('/tickets');
  await expect(page.getByRole('navigation')).toBeVisible();

  // Attendre une ligne plutot qu'un delai : le tableau se remplit apres la
  // reponse de l'API, et compter trop tot donnerait zero partout.
  const lignes = page.getByRole('row');
  await expect.poll(async () => lignes.count(), { timeout: 15_000 }).toBeGreaterThan(1);

  // Moins l'en-tete, qui est une ligne comme les autres pour l'accessibilite.
  return (await lignes.count()) - 1;
}

test.describe('Portee des droits', () => {
  test('chaque profil voit strictement moins que celui qui l englobe', async ({ browser }) => {
    const compte = async (c: Compte): Promise<number> => {
      const contexte = await browser.newContext({ storageState: sessionDe(c) });
      const page = await contexte.newPage();
      const total = await ticketsVisibles(page);
      await contexte.close();

      return total;
    };

    const [racine, nord, siteA, self] = await Promise.all([
      compte(ADMIN),
      compte(SUPERVISEUR),
      compte(TECHNICIEN),
      compte(DEMANDEUR),
    ]);

    // Les valeurs exactes bougeraient au moindre ticket cree par un autre
    // scenario ; l'emboitement, lui, est la promesse elle-meme.
    expect(racine, `admin voit ${String(racine)}, sophie ${String(nord)}`).toBeGreaterThan(nord);
    expect(nord, `sophie voit ${String(nord)}, thomas ${String(siteA)}`).toBeGreaterThan(siteA);
    expect(siteA).toBeGreaterThan(self);
    expect(self).toBeGreaterThan(0);
  });
});

test.describe('Acces direct par URL', () => {
  test.use({ storageState: sessionDe(TECHNICIEN) });

  test('un ticket hors portee ne s ouvre pas en tapant son adresse', async ({ page }) => {
    // Le ticket 5 appartient a la Filiale Nord : Sophie le voit, Thomas non.
    // Cacher le lien ne protege de rien — c'est l'adresse qu'on essaie ici.
    await page.goto('/tickets/5');
    await expect(page.getByRole('navigation')).toBeVisible();

    // Le refus doit etre **affiche**, pas seulement le contenu absent : une
    // page blanche satisferait une simple assertion d'absence.
    await expect(page.getByText(/introuvable ou hors de votre perimetre/i)).toBeVisible();
    await expect(page.getByText('Poste de travail lent au demarrage')).toBeHidden();
  });

  test('le ticket d un demandeur d une autre entite reste ferme', async ({ page }) => {
    await page.goto('/tickets/6');
    await expect(page.getByRole('navigation')).toBeVisible();

    await expect(page.getByText(/introuvable ou hors de votre perimetre/i)).toBeVisible();
    await expect(page.getByText('Acces au partage comptabilite refuse')).toBeHidden();
  });

  test('un ticket de sa propre portee s ouvre normalement', async ({ page }) => {
    // Le pendant indispensable : sans lui, les deux scenarios ci-dessus
    // passeraient tout aussi bien sur une application entierement cassee.
    await page.goto('/tickets/1');

    await expect(page.getByText('Imprimante du 2e etage hors service')).toBeVisible();
  });
});

test.describe('Interface simplifiee du demandeur', () => {
  test.use({ storageState: sessionDe(DEMANDEUR) });

  test('la racine mene au catalogue, pas a la liste des tickets', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/catalogue$/);
  });

  test('aucune entree d administration dans la navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation')).toBeVisible();

    const navigation = page.getByRole('navigation');
    await expect(navigation.getByRole('link', { name: 'Entités' })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'Utilisateurs' })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'Profils' })).toHaveCount(0);
  });

  test('un ecran d administration reste ferme meme par son adresse', async ({ page }) => {
    await page.goto('/settings/users');
    await expect(page.getByRole('navigation')).toBeVisible();

    // Le serveur refuse, et l'ecran le dit : ni la liste, ni un formulaire de
    // creation ne doivent apparaitre.
    await expect(page.getByRole('button', { name: 'Nouvel utilisateur' })).toHaveCount(0);
  });

  test('il ne voit que ses propres tickets', async ({ page }) => {
    await page.goto('/tickets/1');
    await expect(page.getByRole('navigation')).toBeVisible();

    // Le ticket 1 existe et appartient a une autre entite. Son droit est
    // `ticket:read:own` : meme dans sa propre entite, il ne verrait que les
    // siens.
    await expect(page.getByText(/introuvable ou hors de votre perimetre/i)).toBeVisible();
    await expect(page.getByText('Imprimante du 2e etage hors service')).toBeHidden();
  });
});

test.describe('Administrateur', () => {
  test.use({ storageState: sessionDe(ADMIN) });

  test('atteint les ecrans d administration', async ({ page }) => {
    await page.goto('/settings/entities');

    // Le pendant des refus ci-dessus : sans lui, un ecran casse pour tout le
    // monde passerait pour un cloisonnement qui fonctionne.
    await expect(page.getByRole('heading', { name: 'Entités' })).toBeVisible();
  });
});
