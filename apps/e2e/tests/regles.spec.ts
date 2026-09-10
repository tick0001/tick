import { expect, test } from '@playwright/test';
import { ADMIN, SUPERVISEUR, sessionDe } from './comptes.js';

/**
 * Le moteur de regles, et ce qu'il fait vraiment aux tickets.
 *
 * C'est la partie du produit ou une erreur de configuration coute le plus
 * cher : une regle s'applique a tous les tickets, sans que personne la
 * declenche, et son effet se decouvre bien plus tard. Les tests unitaires
 * couvrent l'evaluation des criteres ; ce qui ne l'est nulle part, c'est que la
 * creation d'un ticket **par l'ecran** passe reellement par le moteur.
 *
 * Le jeu de demonstration porte deux regles a la creation :
 *
 *   rang 10  sans critere            -> SLA de prise en compte 1, de resolution 2
 *   rang 20  titre ~ /urgent|bloquant|panne totale/ ET type incident
 *                                    -> urgence 5, SLA de resolution 3, groupe 1
 */

function sujetUnique(quoi: string): string {
  return `${quoi} ${String(Date.now())}`;
}

test.describe('Application a la creation', () => {
  test.use({ storageState: sessionDe(SUPERVISEUR) });

  test('un titre qui declenche la regle voit son urgence relevee', async ({ page }) => {
    // « bloquant » est dans l'expression reguliere, et le type reste incident.
    const sujet = sujetUnique('Serveur de fichiers bloquant pour tout le service');

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByLabel('Urgence').selectOption('1');
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    // L'urgence a ete saisie a 1 et doit ressortir a 5 : c'est le moteur qui
    // l'a relevee, personne d'autre.
    const ticket = await page.request.get(page.url().replace('/tickets/', '/api/tickets/'));
    expect(ticket.ok()).toBeTruthy();

    const { urgency, dateDue } = (await ticket.json()) as {
      urgency: number;
      dateDue: string | null;
    };
    expect(urgency, "La regle doit avoir releve l'urgence a 5.").toBe(5);

    // Et l'engagement affecte par la regle 10 doit avoir produit une echeance :
    // sans elle, le SLA est pose mais jamais calcule.
    expect(dateDue, 'Un engagement affecte doit produire une echeance.').not.toBeNull();
  });

  test('un titre ordinaire garde son urgence, et recoit quand meme un engagement', async ({
    page,
  }) => {
    const sujet = sujetUnique('Demande de second ecran pour le poste 14');

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByLabel('Urgence').selectOption('1');
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    const ticket = await page.request.get(page.url().replace('/tickets/', '/api/tickets/'));
    const { urgency, dateDue } = (await ticket.json()) as {
      urgency: number;
      dateDue: string | null;
    };

    // Le pendant du scenario precedent : sans lui, un moteur qui releve
    // **tous** les tickets a 5 passerait pour un moteur qui marche.
    expect(urgency, "Sans le mot declencheur, l'urgence saisie doit tenir.").toBe(1);
    expect(dateDue, 'La regle sans critere, elle, s applique a tous.').not.toBeNull();
  });
});

test.describe('Simulateur', () => {
  test.use({ storageState: sessionDe(ADMIN) });

  test('montre quelles regles s appliquent, et ce qu elles produisent', async ({ page }) => {
    await page.goto('/settings/rules');
    await expect(page.getByRole('heading', { name: 'Règles' })).toBeVisible();

    await page.getByRole('button', { name: 'Simuler' }).click();

    const resultat = page.getByText(/Tout ticket recoit les engagements standard/).last();
    await expect(resultat).toBeVisible();

    // Le simulateur doit dire **pourquoi** : le critere lu, et la valeur qu'il
    // a lue. Un simulateur qui n'affiche que le resultat final ne permet pas de
    // corriger une regle qui ne se declenche pas.
    await expect(page.getByText(/valeur lue/).first()).toBeVisible();
    await expect(page.getByText(/appliquée/).first()).toBeVisible();
  });

  test('un ticket qui ne declenche rien le montre aussi', async ({ page }) => {
    await page.goto('/settings/rules');
    await page.getByRole('button', { name: 'Simuler' }).click();
    await expect(page.getByText(/valeur lue/).first()).toBeVisible();

    // On remplace le ticket d'essai par un cas qui ne coche pas la regle 20.
    await page
      .getByLabel('Données de départ')
      .fill('{"name":"Demande de fourniture","type":"request"}');
    await page.getByRole('button', { name: 'Simuler' }).click();

    // La regle 20 doit apparaitre comme ignoree : c'est ce que l'on vient
    // verifier quand une regle ne se declenche pas comme prevu.
    await expect(page.getByText(/ignorée/).first()).toBeVisible();
  });
});
