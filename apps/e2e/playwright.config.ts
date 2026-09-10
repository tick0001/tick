import { defineConfig, devices } from '@playwright/test';

/**
 * Tests de bout en bout : un vrai navigateur, la vraie API, la vraie base.
 *
 * Ce que cette suite couvre et qu'aucune autre ne peut couvrir. Les tests de
 * l'interface bouchonnent `api` — ils verifient le rendu, jamais que l'appel
 * existe cote serveur. Les tests de l'API passent par supertest — ils
 * verifient les reponses, jamais qu'un ecran sait les demander. Entre les deux
 * vivent les defauts d'assemblage : un cookie de session mal pose, un droit
 * verifie a l'ecran mais pas au serveur, une route qui a change de nom d'un
 * cote seulement.
 *
 * La base est remise a zero avant chaque execution : voir `globalSetup`.
 * Les scenarios s'appuient sur les cinq comptes du jeu de demonstration, dont
 * les portees sont volontairement differentes — c'est ce qui permet de tester
 * le cloisonnement pour de vrai.
 */
export default defineConfig({
  testDir: './tests',
  // Un scenario de bout en bout traverse le reseau, la base et le rendu : les
  // delais par defaut de Playwright, tailles pour une page statique, produisent
  // des echecs qui ne disent rien.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Serie par defaut. Les scenarios ecrivent dans une base partagee : les
  // paralleliser ferait dependre le resultat de l'ordonnancement, et un test
  // qui echoue une fois sur trois ne protege de rien.
  fullyParallel: false,
  workers: 1,

  // Un test qui ne passe qu'au deuxieme essai cache un defaut. On ne rejoue
  // pas : mieux vaut un echec franc qu'un vert obtenu par insistance.
  retries: 0,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],

  // Remise a zero avant toute la suite. **Elle efface la base de
  // developpement**, et c'est le prix d'une suite repetable : les scenarios
  // creent des tickets et envoient des demandes, si bien que la deuxieme
  // execution ne part pas du meme etat que la premiere. Le defaut a ete
  // constate — voir le commentaire de `base.setup.ts`.
  globalSetup: './tests/base.setup.ts',

  use: {
    baseURL: 'http://localhost:5173',
    // Toujours conserver la trace du premier echec : reproduire un scenario de
    // bout en bout coute cher, et la trace evite de le rejouer a l'aveugle.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
  },

  projects: [
    // Ouvre les sessions une fois pour toutes et les depose sur le disque.
    // Sans cela, chaque scenario repasserait par l'ecran de connexion : quinze
    // secondes perdues par test, et un ecran de connexion casse ferait echouer
    // toute la suite au lieu de son seul test.
    { name: 'sessions', testMatch: /sessions\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['sessions'],
    },
  ],

  webServer: [
    {
      command: 'pnpm --filter @tick/api dev',
      cwd: '../..',
      // La sonde, et non le port : l'API ecoute avant d'etre prete, et un
      // scenario lance trop tot echoue sur une base injoignable.
      url: 'http://localhost:3000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @tick/web dev',
      cwd: '../..',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
