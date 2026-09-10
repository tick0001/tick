import { expect, test } from '@playwright/test';
import { MOT_DE_PASSE, SUPERVISEUR } from './comptes.js';

/**
 * L'entree dans l'application.
 *
 * Ces scenarios partent d'un navigateur vierge : ils n'utilisent aucune session
 * deposee, puisque c'est justement l'ouverture de session qu'ils verifient.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Connexion', () => {
  test('un visiteur sans session tombe sur l ecran de connexion', async ({ page }) => {
    // Une route interne, pas la racine : c'est la redirection qu'on verifie, et
    // servir l'application a un inconnu serait le defaut le plus grave possible.
    await page.goto('/tickets');

    await expect(page.getByLabel('Identifiant')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Se connecter' })).toBeVisible();
  });

  test('un mot de passe faux est refuse, et le dit', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Identifiant').fill(SUPERVISEUR.nom);
    await page.getByLabel('Mot de passe').fill('ce-n-est-pas-le-bon');
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page.getByRole('alert')).toContainText('Identifiant ou mot de passe incorrect');

    // Et l'echec ne laisse pas entrer : verifier le message sans verifier la
    // porte laisserait passer une application qui affiche l'erreur puis ouvre.
    await expect(page.getByLabel('Mot de passe')).toBeVisible();
  });

  test('un identifiant inconnu donne le meme message qu un mot de passe faux', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Identifiant').fill('personne-de-ce-nom');
    await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: 'Se connecter' }).click();

    // Distinguer les deux cas dirait a un inconnu quels comptes existent.
    await expect(page.getByRole('alert')).toContainText('Identifiant ou mot de passe incorrect');
  });

  test('une connexion valide ouvre l application', async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Identifiant').fill(SUPERVISEUR.nom);
    await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: 'Se connecter' }).click();

    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeHidden();
  });

  test('la session survit a un rechargement', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Identifiant').fill(SUPERVISEUR.nom);
    await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE);
    await page.getByRole('button', { name: 'Se connecter' }).click();
    await expect(page.getByRole('navigation')).toBeVisible();

    await page.reload();

    // Un cookie de session qui ne survit pas au rechargement obligerait a se
    // reconnecter a chaque F5, sans qu'aucun test unitaire ne le voie.
    await expect(page.getByRole('navigation')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeHidden();
  });
});
