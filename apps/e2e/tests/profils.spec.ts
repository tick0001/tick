import { expect, test, type Page } from '@playwright/test';
import { DEUX_PROFILS, sessionDe } from './comptes.js';

/**
 * Les droits suivent le profil actif, jamais l'union des profils.
 *
 * C'est le parti pris qui justifie le quadruplet objet x action x portee, et le
 * defaut correspondant serait invisible a l'usage courant : il faut un compte a
 * deux casquettes pour l'exposer. Lea est technicienne sur Site B et simple
 * demandeuse au Siege — si l'application cumulait, elle serait technicienne
 * partout.
 *
 * Ce que ces scenarios tiennent et qu'aucun autre ne peut tenir : la bascule
 * change reellement ce que le **serveur** accorde, et pas seulement ce que le
 * menu affiche.
 */

const TECHNICIENNE = 'Racine > Filiale Nord > Site B — Technicien';
const DEMANDEUSE = 'Racine > Siege — Self-service';

test.use({ storageState: sessionDe(DEUX_PROFILS) });

/** Bascule vers une habilitation et attend que la session ait suivi. */
async function basculer(page: Page, libelle: string): Promise<void> {
  const selecteur = page.getByLabel("Changer d'entité ou de profil");
  await expect(selecteur).toBeVisible();
  await selecteur.selectOption({ label: libelle });

  await expect(selecteur).toHaveValue(
    await selecteur
      .locator('option', { hasText: libelle })
      .getAttribute('value')
      .then((v) => v ?? ''),
  );
}

test.describe('Deux casquettes', () => {
  test('les quatre habilitations sont proposees', async ({ page }) => {
    await page.goto('/tickets');

    const selecteur = page.getByLabel("Changer d'entité ou de profil");
    await expect(selecteur).toBeVisible();
    await expect(selecteur.locator('option')).toHaveCount(4);
  });

  test('technicienne sur Site B : elle atteint la liste des tickets', async ({ page }) => {
    await page.goto('/tickets');

    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();
  });

  test('passee en Self-service, elle perd les ecrans de technicienne', async ({ page }) => {
    await page.goto('/tickets');
    const navigation = page.getByRole('navigation');
    await expect(navigation.getByRole('link', { name: 'Problèmes' })).toBeVisible();

    await basculer(page, DEMANDEUSE);

    // `/tickets` reste atteignable : c'est aussi l'ecran « Mes demandes » du
    // demandeur, filtre par le serveur. Ce qui disparait, ce sont les ecrans
    // que le profil Self-service ne porte pas.
    await expect(navigation.getByRole('link', { name: 'Problèmes' })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'Changements' })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'Statistiques' })).toHaveCount(0);
    await expect(navigation.getByRole('link', { name: 'Catalogue de services' })).toBeVisible();
  });

  test('la racine suit le profil actif, pas le compte', async ({ page }) => {
    await page.goto('/tickets');
    await basculer(page, DEMANDEUSE);

    await page.goto('/');

    // Le meme compte, deux destinations : c'est le profil actif qui decide.
    await expect(page).toHaveURL(/\/catalogue$/);
  });

  test('le retour en Technicien rend les ecrans', async ({ page }) => {
    await page.goto('/tickets');
    await basculer(page, DEMANDEUSE);

    const navigation = page.getByRole('navigation');
    await expect(navigation.getByRole('link', { name: 'Problèmes' })).toHaveCount(0);

    await basculer(page, TECHNICIENNE);

    // Sans ce retour, le scenario precedent passerait aussi sur une bascule
    // qui casse la session au lieu de la changer.
    await expect(navigation.getByRole('link', { name: 'Problèmes' })).toBeVisible();
  });
});
