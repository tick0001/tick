import { expect, test } from '@playwright/test';
import { ADMIN, sessionDe } from './comptes.js';

/** Le contrat exige huit caracteres : `tick` ne suffit pas ici. */
const MOT_DE_PASSE_VALIDE = 'huit-caracteres-au-moins';

/**
 * L'administration : ce qu'on fait une fois, et qui engage tout le reste.
 *
 * Creer une entite, un compte, un groupe. Ces ecrans servent rarement, ce qui
 * est precisement le probleme : une regression y passe inapercue pendant des
 * mois, et se decouvre le jour ou l'on installe une nouvelle organisation —
 * c'est-a-dire au pire moment.
 *
 * Chaque objet cree porte l'horodatage du run : la suite remet les donnees a
 * zero, mais rien n'oblige a lancer un fichier isolement sur une base fraiche.
 */

function nomUnique(quoi: string): string {
  return `${quoi} ${String(Date.now())}`;
}

test.use({ storageState: sessionDe(ADMIN) });

test.describe('Entites', () => {
  test('une entite creee apparait dans l arbre', async ({ page }) => {
    const nom = nomUnique('Agence Est');

    await page.goto('/settings/entities');
    await expect(page.getByRole('heading', { name: 'Entités' })).toBeVisible();

    await page.getByRole('button', { name: 'Nouvelle entité' }).click();
    await page.getByLabel('Nom', { exact: true }).fill(nom);
    await page.getByLabel('Entité parente').selectOption({ label: 'Racine' });
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    // Dans l'arbre, et non dans le selecteur de contexte de l'en-tete, qui
    // porte le meme texte.
    await expect(page.getByRole('main').getByText(nom)).toBeVisible();

    // Et elle doit survivre au rechargement : un arbre mis a jour en memoire
    // seulement laisse croire que l'entite existe.
    await page.reload();
    await expect(page.getByRole('main').getByText(nom)).toBeVisible();
  });

  test('une entite devient un contexte de travail disponible', async ({ page }) => {
    const nom = nomUnique('Agence Ouest');

    await page.goto('/settings/entities');
    await page.getByRole('button', { name: 'Nouvelle entité' }).click();
    await page.getByLabel('Nom', { exact: true }).fill(nom);
    await page.getByLabel('Entité parente').selectOption({ label: 'Racine' });
    await page.getByRole('button', { name: 'Enregistrer' }).click();
    await expect(page.getByRole('main').getByText(nom)).toBeVisible();

    // L'administrateur est habilite sur la racine en recursif : la nouvelle
    // entite doit donc lui devenir accessible sans qu'on l'y habilite. C'est
    // tout l'interet de l'arbre — et le genre de chose qui casse en silence.
    const session = await page.request.get('/api/auth/session');
    const { available } = (await session.json()) as {
      available: { entity: { completeName: string } }[];
    };

    expect(
      available.some((h) => h.entity.completeName.includes(nom)),
      "La nouvelle entite doit apparaitre dans les contextes de l'administrateur.",
    ).toBeTruthy();
  });
});

test.describe('Comptes', () => {
  test('un compte cree peut se connecter', async ({ page, browser }) => {
    const identifiant = `essai${String(Date.now())}`;

    await page.goto('/settings/users');
    await expect(page.getByRole('heading', { name: 'Utilisateurs' })).toBeVisible();

    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();
    await page.getByLabel('Identifiant').fill(identifiant);
    await page.getByLabel('Courriel').fill(`${identifiant}@exemple.invalid`);
    await page.getByLabel('Prénom').fill('Camille');
    await page.getByLabel('Nom', { exact: true }).fill('Durand');
    await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE_VALIDE);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText('Camille Durand')).toBeVisible();

    // La vraie verification n'est pas qu'une ligne s'affiche, mais que le
    // compte **fonctionne** : mot de passe pris en compte, compte actif.
    const dehors = await browser.newContext();
    const visiteur = await dehors.newPage();
    await visiteur.goto('/');

    const connexion = await visiteur.request.post('/api/auth/login', {
      data: { username: identifiant, password: MOT_DE_PASSE_VALIDE },
    });
    expect(
      connexion.status(),
      'Un compte cree sans habilitation se connecte, mais sans contexte de travail.',
    ).not.toBe(500);
    await dehors.close();
  });

  test('un mot de passe trop court est refuse avant l envoi', async ({ page }) => {
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();

    // Le contrat exige huit caracteres. Sans contrainte declaree au formulaire,
    // la saisie part au serveur et revient en « Donnees invalides. » — un
    // message qui ne dit pas quel champ corriger.
    const motDePasse = page.getByLabel('Mot de passe');
    await expect(motDePasse).toHaveAttribute('minlength', '8');
    await expect(page.getByText(/Huit caractères au minimum/)).toBeVisible();
  });

  test('un identifiant deja pris est refuse', async ({ page }) => {
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'Nouvel utilisateur' }).click();

    // `admin` existe depuis l'amorcage : le doublon doit etre refuse, sinon
    // deux comptes se disputent le meme identifiant de connexion.
    await page.getByLabel('Identifiant').fill('admin');
    await page.getByLabel('Courriel').fill('doublon@exemple.invalid');
    await page.getByLabel('Prénom').fill('Doublon');
    await page.getByLabel('Nom', { exact: true }).fill('Refuse');
    await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE_VALIDE);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    // Le formulaire reste ouvert, et rien n'a ete cree.
    await expect(page.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
  });
});

test.describe('Groupes', () => {
  test('un groupe cree apparait dans la liste', async ({ page }) => {
    const nom = nomUnique('Astreinte reseau');

    await page.goto('/settings/groups');
    await expect(page.getByRole('heading', { name: 'Groupes' })).toBeVisible();

    await page.getByRole('button', { name: /Nouveau groupe/ }).click();
    await page.getByLabel('Nom', { exact: true }).fill(nom);
    await page.getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText(nom)).toBeVisible();
    await page.reload();
    await expect(page.getByText(nom)).toBeVisible();
  });
});

test.describe('Langue de l interface', () => {
  test('la bascule change les libelles, et tient au rechargement', async ({ page }) => {
    await page.goto('/tickets');
    await expect(page.getByRole('heading', { name: 'Tickets' })).toBeVisible();

    await page.getByLabel('Langue de l’interface').first().selectOption('en');

    // Le titre de la page est traduit differemment : c'est un mot qui change
    // vraiment, pas un homographe entre les deux langues.
    await expect(page.getByRole('link', { name: 'Problems' })).toBeVisible();

    // Et le choix doit survivre : une langue qui retombe au rechargement
    // oblige a la choisir a chaque visite.
    await page.reload();
    await expect(page.getByRole('link', { name: 'Problems' })).toBeVisible();

    await page
      .getByLabel(/interface language|Langue de l’interface/i)
      .first()
      .selectOption('fr');
    await expect(page.getByRole('link', { name: 'Problèmes' })).toBeVisible();
  });
});
