import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerHarnais, type Harnais } from './harnais.js';

/**
 * Les écritures venues d'un autre site.
 *
 * Le cookie `SameSite=Lax` en arrête déjà l'essentiel ; ce contrôle en est la
 * seconde ligne. Il ne touche ni aux lectures, ni aux clients hors navigateur,
 * qui n'envoient pas d'`Origin`.
 */
describe('HTTP — origine des écritures', () => {
  let harnais: Harnais;

  beforeAll(async () => {
    harnais = await creerHarnais('origine');
  }, 120_000);

  afterAll(async () => {
    await harnais.close();
  });

  /** Un changement de contexte : une écriture authentifiée, refusée ensuite pour son corps vide. */
  const ecriture = (origine?: string) => {
    const requete = harnais.admin().post('/api/auth/context');

    return origine === undefined ? requete : requete.set('Origin', origine);
  };

  it('refuse une écriture venue d’un autre site, même avec une session', async () => {
    const reponse = await ecriture('https://piege.exemple').send({});

    expect(reponse.status).toBe(403);
    expect(reponse.body.message).toMatch(/autre site/);
  });

  it.each(['null', 'file://', 'pas une origine'])('refuse l’origine opaque %s', async (origine) => {
    expect((await ecriture(origine).send({})).status).toBe(403);
  });

  it('laisse passer l’origine de l’interface déclarée', async () => {
    // Refusée pour son corps vide, pas pour son origine.
    const reponse = await ecriture(process.env['WEB_URL'] ?? 'http://localhost:5173').send({});

    expect(reponse.status).toBe(400);
  });

  it('laisse passer l’hôte même de la requête', async () => {
    const reponse = await harnais
      .anonyme()
      .post('/api/auth/login')
      .set('Host', 'assistance.exemple.fr')
      .set('Origin', 'https://assistance.exemple.fr')
      .send({ username: 'personne', password: 'faux' });

    expect(reponse.status).toBe(401);
  });

  it('refuse un hôte qui ne fait que ressembler à celui de la requête', async () => {
    const autre = await harnais
      .anonyme()
      .post('/api/auth/login')
      .set('Host', 'assistance.exemple.fr')
      .set('Origin', 'https://assistance.exemple.fr.piege.exemple')
      .send({ username: 'personne', password: 'faux' });

    expect(autre.status).toBe(403);
  });

  it('laisse passer une écriture sans origine, celle d’un client hors navigateur', async () => {
    expect((await ecriture().send({})).status).toBe(400);
  });

  it('ne touche pas aux lectures', async () => {
    const reponse = await harnais
      .admin()
      .get('/api/auth/session')
      .set('Origin', 'https://piege.exemple');

    expect(reponse.status).toBe(200);
  });
});
