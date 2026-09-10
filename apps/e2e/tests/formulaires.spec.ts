import { expect, test } from '@playwright/test';
import { ADMIN, DEMANDEUR, sessionDe } from './comptes.js';

/**
 * Le constructeur de formulaires, et la traduction des libelles.
 *
 * La chaine est longue : un administrateur saisit une traduction dans
 * l'editeur, elle est stockee dans une table polymorphe, et elle ressort au
 * rendu **selon la langue du lecteur** — laquelle vient de l'en-tete
 * `Accept-Language` du navigateur. Chaque maillon est teste ailleurs ; aucun
 * test ne prend la chaine entiere, et c'est precisement la ou une traduction
 * saisie disparait sans que personne s'en apercoive.
 */

test.describe('Traduction des libelles', () => {
  test('une traduction saisie ressort dans la langue du lecteur', async ({ browser }) => {
    const traduction = `Equipment request ${String(Date.now())}`;

    // --- L'administrateur traduit le nom du formulaire ---------------------
    const bureau = await browser.newContext({ storageState: sessionDe(ADMIN) });
    const admin = await bureau.newPage();
    await admin.goto('/settings/forms');
    await expect(admin.getByRole('heading', { name: 'Formulaires' })).toBeVisible();

    await admin.getByRole('button', { name: 'Modifier' }).first().click();
    await admin.getByLabel('Afficher les traductions').check();

    // La bascule propose la langue **autre** que celle du lecteur : le lecteur
    // est ici en francais, donc l'anglais.
    const champ = admin.getByPlaceholder('Traduction (English)').first();
    await expect(champ).toBeVisible();
    await champ.fill(traduction);
    await admin.getByRole('button', { name: 'Enregistrer' }).click();

    // La traduction doit avoir ete enregistree, pas seulement affichee.
    await expect(admin.getByRole('button', { name: 'Modifier' }).first()).toBeVisible();
    await bureau.close();

    // --- Un demandeur anglophone lit le catalogue --------------------------
    const anglais = await browser.newContext({
      storageState: sessionDe(DEMANDEUR),
      locale: 'en-GB',
    });
    const lecteur = await anglais.newPage();
    await lecteur.goto('/catalogue');

    await expect(
      lecteur.getByText(traduction),
      'Le catalogue doit servir la traduction au lecteur anglophone.',
    ).toBeVisible({ timeout: 15_000 });
    await anglais.close();

    // --- Et un francophone garde la saisie d'origine -----------------------
    const francais = await browser.newContext({
      storageState: sessionDe(DEMANDEUR),
      locale: 'fr-FR',
    });
    const original = await francais.newPage();
    await original.goto('/catalogue');

    // Sans ce pendant, une traduction qui **remplace** l'original partout
    // passerait pour une traduction qui fonctionne.
    await expect(original.getByText(/Demande de materiel/)).toBeVisible();
    await expect(original.getByText(traduction)).toHaveCount(0);
    await francais.close();
  });
});

test.describe('Editeur', () => {
  test.use({ storageState: sessionDe(ADMIN) });

  test('les traductions restent masquees tant qu on ne les demande pas', async ({ page }) => {
    await page.goto('/settings/forms');
    await page.getByRole('button', { name: 'Modifier' }).first().click();

    // La plupart des formulaires n'existent que dans une langue : doubler
    // chaque champ de saisie encombrerait l'editeur pour tout le monde.
    await expect(page.getByPlaceholder('Traduction (English)')).toHaveCount(0);
    await expect(page.getByLabel('Afficher les traductions')).toBeVisible();
  });

  test('un formulaire cree apparait au catalogue', async ({ page, browser }) => {
    const nom = `Demande d acces ${String(Date.now())}`;

    await page.goto('/settings/forms');
    await page.getByRole('button', { name: /Nouveau formulaire/ }).click();
    await page.getByLabel('Nom', { exact: true }).first().fill(nom);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText(nom).first()).toBeVisible();

    // Un formulaire enregistre mais absent du catalogue n'existe pas pour ceux
    // a qui il est destine.
    const cote = await browser.newContext({ storageState: sessionDe(ADMIN) });
    const catalogue = await cote.newPage();
    await catalogue.goto('/catalogue');
    await expect(catalogue.getByText(nom)).toBeVisible({ timeout: 15_000 });
    await cote.close();
  });
});
