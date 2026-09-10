import { expect, test } from '@playwright/test';
import { SUPERVISEUR, sessionDe } from './comptes.js';

/**
 * Les notifications, jusqu'a la boite aux lettres.
 *
 * C'est la promesse la plus facile a rompre sans que rien ne le signale :
 * l'application continue de fonctionner, les tickets s'ouvrent, et personne
 * n'est prevenu. Ni les tests unitaires du gabarit ni ceux de la file ne
 * peuvent le voir — il faut aller lire ce qui est reellement arrive au serveur
 * de courriel.
 *
 * Mailpit sert de destinataire : il expose sa boite par HTTP, et le compose de
 * developpement comme l'integration continue le fournissent.
 */

/** L'API de Mailpit, hors du domaine de l'application. */
const MAILPIT = 'http://localhost:8025';

interface Message {
  readonly Subject: string;
}

test.describe('Courriel a l ouverture', () => {
  test.use({ storageState: sessionDe(SUPERVISEUR) });

  test('un ticket cree part en notification', async ({ page, request }) => {
    const sujet = `Sauvegarde nocturne en echec ${String(Date.now())}`;

    await page.goto('/tickets/new');
    await page.getByLabel('Sujet').fill(sujet);
    await page.getByRole('button', { name: 'Créer le ticket' }).click();
    await expect(page.getByRole('heading', { name: sujet })).toBeVisible();

    // Les notifications passent par une file : elles ne partent pas dans la
    // meme transaction que la creation, et attendre est donc normal. Interroger
    // une seule fois donnerait un echec qui n'en est pas un.
    await expect
      .poll(
        async () => {
          const boite = await request.get(
            `${MAILPIT}/api/v1/search?query=${encodeURIComponent(sujet)}`,
          );
          if (!boite.ok()) return 0;

          const { messages } = (await boite.json()) as { messages: Message[] };

          return messages.length;
        },
        {
          timeout: 30_000,
          message:
            "Aucun courriel d'ouverture n'est arrive. La file tourne-t-elle (RUN_EVENT_WORKER) ?",
        },
      )
      .toBeGreaterThan(0);

    const boite = await request.get(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(sujet)}`);
    const { messages } = (await boite.json()) as { messages: Message[] };

    // Le numero du ticket doit figurer dans l'objet : c'est ce qui permet a une
    // reponse par courriel de retrouver son fil, et au lecteur de savoir de
    // quel ticket on lui parle.
    expect(messages[0]?.Subject, "L'objet doit porter le numero du ticket et son sujet.").toMatch(
      /^\[#\d+\]/,
    );
    expect(messages[0]?.Subject).toContain(sujet);
  });
});
