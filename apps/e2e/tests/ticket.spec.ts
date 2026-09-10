import { expect, test } from '@playwright/test';
import { ADMIN, DEMANDEUR, SUPERVISEUR, sessionDe } from './comptes.js';

/**
 * Le cycle de vie d'un ticket : ce qu'un technicien fait cinquante fois par jour.
 *
 * Chaque scenario fabrique ses propres donnees et les nomme avec l'horodatage
 * du run : la base est partagee, et deux executions ne doivent jamais se
 * marcher dessus ni dependre l'une de l'autre.
 */

/** Un sujet que ce run est seul a porter. */
function sujetUnique(quoi: string): string {
  return `${quoi} ${String(Date.now())}`;
}

test.describe('Creation et suivi', () => {
  test.use({ storageState: sessionDe(SUPERVISEUR) });

  test('un ticket cree apparait dans la liste et s ouvre', async ({ page }) => {
    const sujet = sujetUnique('Ecran noir au demarrage');

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByLabel('Description').fill('Constate ce matin sur deux postes du deuxieme.');
    await page.getByRole('button', { name: 'Créer le ticket' }).click();

    // La creation mene au ticket : rester sur le formulaire obligerait a le
    // retrouver a la main, et c'est le genre de regression qu'aucun test
    // unitaire ne voit.
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    await page.goto('/tickets');
    await expect(page.getByText(sujet)).toBeVisible();
  });

  test('un sujet vide est refuse', async ({ page }) => {
    await page.goto('/tickets/new');
    await page.getByLabel('Description').fill('Une description sans sujet.');
    await page.getByRole('button', { name: 'Créer le ticket' }).click();

    // Toujours sur le formulaire : le champ est requis, et rien ne doit avoir
    // ete cree. C'est l'URL qui tranche — « Sujet » est aussi une colonne du
    // tableau, et le chercher a l'ecran ne dirait pas ou l'on se trouve.
    await expect(page).toHaveURL(/\/tickets\/new$/);
    await expect(page.getByRole('button', { name: 'Créer le ticket' })).toBeVisible();
  });

  test('un suivi publie apparait dans la chronologie', async ({ page }) => {
    const sujet = sujetUnique('Sauvegarde interrompue');
    const suivi = sujetUnique('Verification faite, relance planifiee');

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    await page.getByPlaceholder('Décrire ce qui a été fait ou constaté').fill(suivi);
    await page.getByRole('button', { name: 'Publier' }).click();

    await expect(page.getByText(suivi)).toBeVisible();
  });

  test('le changement de statut tient apres rechargement', async ({ page }) => {
    const sujet = sujetUnique('Badge d acces inactif');

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    await page.getByLabel('Changer le statut').selectOption({ label: 'En attente' });

    // Recharger, et non se fier a l'ecran : un statut change en apparence mais
    // jamais enregistre est exactement le defaut qu'on cherche ici.
    await page.reload();
    await expect(page.getByLabel('Changer le statut')).toHaveValue('waiting');
  });
});

test.describe('Suivi prive', () => {
  test('un suivi prive n atteint jamais le demandeur', async ({ browser }) => {
    const secret = sujetUnique('Note interne, ne pas diffuser');

    // Le ticket 6 appartient au demandeur ; seul un profil large l'atteint.
    const cote = await browser.newContext({ storageState: sessionDe(ADMIN) });
    const technicien = await cote.newPage();
    await technicien.goto('/tickets/6');
    await expect(
      technicien.getByRole('heading', { name: 'Acces au partage comptabilite refuse' }),
    ).toBeVisible();

    await technicien.getByPlaceholder('Décrire ce qui a été fait ou constaté').fill(secret);
    await technicien.getByLabel('Privé (invisible du demandeur)').check();
    await technicien.getByRole('button', { name: 'Publier' }).click();
    await expect(technicien.getByText(secret)).toBeVisible();
    await cote.close();

    // Le demandeur lit sa demande comme une conversation. La note ne doit y
    // figurer sous aucune forme — c'est une promesse faite a l'exploitant, et
    // la rompre serait une fuite vers l'exterieur du service.
    const chez = await browser.newContext({ storageState: sessionDe(DEMANDEUR) });
    const demandeur = await chez.newPage();
    await demandeur.goto('/tickets/6');
    await expect(demandeur.getByText('Acces au partage comptabilite refuse')).toBeVisible();

    await expect(demandeur.getByText(secret)).toHaveCount(0);
    await chez.close();
  });
});
