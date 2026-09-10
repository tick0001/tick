import { expect, test } from '@playwright/test';
import { SUPERVISEUR, sessionDe } from './comptes.js';

/**
 * La corbeille : supprimer sans perdre.
 *
 * Le produit fait le choix d'une mise a la corbeille plutot que d'un effacement,
 * et ce choix ne vaut que s'il tient de bout en bout. Deux defauts opposes se
 * paient aussi cher l'un que l'autre : un ticket « supprime » qui reste dans la
 * liste, et un ticket supprime qu'on ne retrouve plus nulle part.
 */

test.use({ storageState: sessionDe(SUPERVISEUR) });

test.describe('Mise a la corbeille', () => {
  test('un ticket supprime quitte la liste, se retrouve, et revient', async ({ page }) => {
    const sujet = `Ecran de veille bloque ${String(Date.now())}`;

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    const id = page.url().split('/').pop() ?? '';

    await page.goto('/tickets');
    await expect(page.getByText(sujet)).toBeVisible();

    // --- A la corbeille ----------------------------------------------------
    const suppression = await page.request.delete(`/api/tickets/${id}`);
    expect(suppression.ok(), `Suppression refusee (${String(suppression.status())}).`).toBeTruthy();

    await page.reload();
    await expect(
      page.getByText(sujet),
      'Un ticket mis a la corbeille ne doit plus encombrer la liste courante.',
    ).toHaveCount(0);

    // --- Mais retrouvable ---------------------------------------------------
    await page.getByRole('tab', { name: 'Corbeille' }).click();
    await expect(
      page.getByText(sujet),
      "Et il doit se retrouver dans la corbeille : c'est tout ce qui distingue une mise a la corbeille d'un effacement.",
    ).toBeVisible();

    // --- Et restaurable -----------------------------------------------------
    const retour = await page.request.post(`/api/tickets/${id}/restore`);
    expect(retour.ok(), `Restauration refusee (${String(retour.status())}).`).toBeTruthy();

    await page.goto('/tickets');
    await expect(page.getByText(sujet)).toBeVisible();
  });

  test('un ticket a la corbeille reste hors des resultats de recherche', async ({ page }) => {
    const sujet = `Imprimante hors service ${String(Date.now())}`;

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    const id = page.url().split('/').pop() ?? '';
    const critere = {
      criteria: { kind: 'criterion', field: 'ticket.name', operator: 'contains', value: sujet },
    };

    const avant = await page.request.post('/api/search/tickets', { data: critere });
    expect(((await avant.json()) as { items: unknown[] }).items).toHaveLength(1);

    await page.request.delete(`/api/tickets/${id}`);

    // La recherche est un second chemin vers les memes donnees : un ticket
    // ecarte de la liste mais toujours trouvable par la recherche serait
    // supprime a moitie.
    const apres = await page.request.post('/api/search/tickets', { data: critere });
    expect(
      ((await apres.json()) as { items: unknown[] }).items,
      'La recherche ne doit pas ramener un ticket mis a la corbeille.',
    ).toHaveLength(0);
  });
});
