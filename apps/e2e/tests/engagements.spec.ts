import { expect, test } from '@playwright/test';
import { ADMIN, SUPERVISEUR, TECHNICIEN, sessionDe } from './comptes.js';

/**
 * Engagements de service, calendriers, et statistiques.
 *
 * Deux promesses tres visibles pour l'exploitant, et tres faciles a casser
 * sans s'en rendre compte : une echeance calculee sur les heures ouvrees, et
 * des indicateurs qui ne comptent que le perimetre visible. Une statistique qui
 * franchit les portees est une fuite comme une autre, en moins evident.
 */

test.describe('Calendriers et engagements', () => {
  test.use({ storageState: sessionDe(ADMIN) });

  test('l ecran presente les calendriers et les engagements', async ({ page }) => {
    await page.goto('/settings/service-levels');

    await expect(page.getByRole('heading', { name: 'Calendriers' })).toBeVisible();
    await expect(page.getByText('Engagements de service').first()).toBeVisible();

    // Ceux du jeu de demonstration, avec leur nature et leur duree : un
    // engagement qui perd son calendrier calcule en temps calendaire, et les
    // echeances tombent la nuit et le week-end.
    await expect(page.getByText(/Prise en compte sous 2 h/)).toBeVisible();
    await expect(page.getByText(/Heures ouvrees/).first()).toBeVisible();
  });

  test('un engagement cree apparait et survit au rechargement', async ({ page }) => {
    const nom = `Resolution sous 8 h ${String(Date.now())}`;

    await page.goto('/settings/service-levels');
    await page.getByRole('button', { name: 'Nouvel engagement' }).click();
    await page.getByLabel('Nom', { exact: true }).fill(nom);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText(nom)).toBeVisible();
    await page.reload();
    await expect(page.getByText(nom)).toBeVisible();
  });
});

test.describe('Echeance', () => {
  test.use({ storageState: sessionDe(SUPERVISEUR) });

  test('un ticket recoit une echeance posterieure a son ouverture', async ({ page }) => {
    const sujet = `Onduleur en defaut ${String(Date.now())}`;

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    const reponse = await page.request.get(page.url().replace('/tickets/', '/api/tickets/'));
    const { dateOpened, dateDue } = (await reponse.json()) as {
      dateOpened: string;
      dateDue: string | null;
    };

    expect(dateDue, "L'engagement affecte par la regle doit produire une echeance.").not.toBeNull();
    expect(
      new Date(dateDue ?? 0).getTime(),
      'Une echeance anterieure a l ouverture serait deja depassee a la creation.',
    ).toBeGreaterThan(new Date(dateOpened).getTime());
  });
});

test.describe('Statistiques', () => {
  test('les indicateurs ne comptent que le perimetre visible', async ({ browser }) => {
    const ouverts = async (compte: typeof ADMIN): Promise<number> => {
      const contexte = await browser.newContext({ storageState: sessionDe(compte) });
      const page = await contexte.newPage();
      await page.goto('/stats');
      await expect(page.getByRole('heading', { name: 'Statistiques' })).toBeVisible();

      const reponse = await page.request.get('/api/stats');
      expect(reponse.ok(), `Statistiques refusees (${String(reponse.status())}).`).toBeTruthy();

      const { summary } = (await reponse.json()) as { summary: { opened: number } };
      await contexte.close();

      return summary.opened;
    };

    // Un indicateur qui franchit les portees est une fuite comme une autre :
    // le nombre de tickets d'une autre organisation est deja une information.
    expect(await ouverts(ADMIN)).toBeGreaterThan(await ouverts(TECHNICIEN));
  });

  test('l ecran s ouvre et affiche ses indicateurs', async ({ browser }) => {
    const contexte = await browser.newContext({ storageState: sessionDe(SUPERVISEUR) });
    const page = await contexte.newPage();
    await page.goto('/stats');

    await expect(page.getByText(/OUVERTS/i).first()).toBeVisible();
    await expect(page.getByText(/RÉSOLUS/i).first()).toBeVisible();
    await contexte.close();
  });
});
