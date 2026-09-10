import { expect, test as setup } from '@playwright/test';
import { COMPTES, MOT_DE_PASSE, sessionDe } from './comptes.js';

/**
 * Ouvre une session par compte et la depose sur le disque.
 *
 * La connexion passe par le navigateur et non par l'API directement : le
 * cookie doit appartenir a l'origine de l'interface, comme en production ou
 * nginx sert les deux sous le meme domaine. Ouvrir la session sur `:3000`
 * produirait un cookie que `:5173` n'enverrait jamais, et tous les scenarios
 * echoueraient sur une redirection vers l'ecran de connexion.
 */
for (const compte of COMPTES) {
  setup(`session de ${compte.nom} — ${compte.role}`, async ({ page }) => {
    const reponse = await page.request.post('/api/auth/login', {
      data: { username: compte.nom, password: MOT_DE_PASSE },
    });

    expect(
      reponse.ok(),
      `Connexion de ${compte.nom} refusee (${String(reponse.status())}). La base est-elle amorcee ? « pnpm db:reset » a la racine.`,
    ).toBeTruthy();

    // Le contexte doit etre exploitable : un cookie pose sur une session que
    // l'API ne sait pas decrire ferait echouer chaque scenario plus loin, sur
    // un symptome sans rapport.
    const contexte = (await reponse.json()) as { user?: { username?: string } };
    expect(contexte.user?.username).toBe(compte.nom);

    await page.request.storageState({ path: sessionDe(compte) });
  });
}
