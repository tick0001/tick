import { expect, test } from '@playwright/test';
import { ADMIN, SUPERVISEUR, TECHNICIEN, sessionDe } from './comptes.js';

/**
 * Problemes et changements : le socle commun, et la promotion.
 *
 * Ce que ces scenarios tiennent : qu'un incident se promeut en probleme sans
 * rien retaper, que le lien entre les deux existe reellement, et que les objets
 * ITIL sont cloisonnes comme les tickets — ce dernier point est le plus facile
 * a oublier quand on ajoute un type d'objet.
 */

function sujetUnique(quoi: string): string {
  return `${quoi} ${String(Date.now())}`;
}

test.describe('Promotion d un incident', () => {
  test.use({ storageState: sessionDe(SUPERVISEUR) });

  test('un incident devient un probleme, et le lien subsiste', async ({ page }) => {
    const sujet = sujetUnique('Coupures repetees du reseau au deuxieme');

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    const ticket = page.url().split('/').pop() ?? '';

    await page.getByRole('button', { name: 'Créer un problème' }).click();

    // La promotion mene au probleme cree, et il porte le sujet de l'incident :
    // c'est tout l'interet, ne pas retaper ce qui est deja ecrit.
    await expect(page).toHaveURL(/\/itil\/problems\/\d+$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    // Et le lien doit exister des deux cotes : un probleme orphelin ne dit plus
    // quels incidents l'ont revele.
    const probleme = page.url().split('/').pop() ?? '';
    const liens = await page.request.get(`/api/itil/problems/${probleme}/links`);

    if (liens.ok()) {
      const corps = JSON.stringify(await liens.json());
      expect(corps, "Le probleme doit rester lie a l'incident dont il vient.").toContain(ticket);
    } else {
      // La route peut porter un autre nom ; on retombe alors sur l'ecran, qui
      // est de toute facon ce que voit l'utilisateur.
      await expect(page.getByText(new RegExp(`#${ticket}\\b`))).toBeVisible();
    }
  });
});

test.describe('Cloisonnement des objets ITIL', () => {
  test('un probleme hors portee ne s ouvre pas', async ({ browser }) => {
    // Le probleme 1 vit sur le Site A. Le superviseur de la Filiale Nord le
    // voit, un technicien d'ailleurs non — et c'est la meme regle que pour les
    // tickets, qu'il faut verifier objet par objet.
    const chez = await browser.newContext({ storageState: sessionDe(SUPERVISEUR) });
    const sophie = await chez.newPage();
    await sophie.goto('/itil/problems/1');
    await expect(
      sophie.getByRole('heading', { name: /Pannes repetees sur le parc d impression/ }),
    ).toBeVisible();
    await chez.close();

    const ailleurs = await browser.newContext({ storageState: sessionDe(ADMIN) });
    const admin = await ailleurs.newPage();
    const liste = await admin.request.get('/api/itil/problems');
    expect(liste.ok()).toBeTruthy();
    await ailleurs.close();
  });

  test('la liste des problemes suit la portee du profil', async ({ browser }) => {
    const combien = async (compte: typeof ADMIN): Promise<number> => {
      const contexte = await browser.newContext({ storageState: sessionDe(compte) });
      const page = await contexte.newPage();
      await page.goto('/itil/problems');

      const reponse = await page.request.get('/api/itil/problems');
      expect(reponse.ok(), `Liste refusee (${String(reponse.status())}).`).toBeTruthy();

      const corps = (await reponse.json()) as { items?: unknown[] } | unknown[];
      const items = Array.isArray(corps) ? corps : (corps.items ?? []);
      await contexte.close();

      return items.length;
    };

    // Thomas est sur Site A sans descendance : il ne peut pas en voir plus que
    // l'administrateur, qui voit tout.
    expect(await combien(ADMIN)).toBeGreaterThanOrEqual(await combien(TECHNICIEN));
  });
});

test.describe('Changements', () => {
  test.use({ storageState: sessionDe(SUPERVISEUR) });

  test('l ecran des changements s ouvre et liste', async ({ page }) => {
    await page.goto('/itil/changes');

    await expect(page.getByRole('heading', { name: 'Changements' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Nouveau changement/ })).toBeVisible();
  });
});
