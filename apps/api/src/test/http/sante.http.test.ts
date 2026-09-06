import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { creerHarnais, type Harnais } from './harnais.js';

describe('HTTP — santé et session', () => {
  let harnais: Harnais;

  beforeAll(async () => {
    harnais = await creerHarnais();
  }, 120_000);

  afterAll(async () => {
    await harnais.close();
  });

  it('répond à la sonde de santé sans session', async () => {
    const reponse = await harnais.anonyme().get('/api/health');

    expect(reponse.status).toBe(200);
    expect(reponse.body).toMatchObject({ status: 'ok' });
  });

  it('décrit la session courante', async () => {
    const reponse = await harnais.admin().get('/api/auth/session');

    expect(reponse.status).toBe(200);
    expect(reponse.body).toHaveProperty('user');
  });

  it('refuse la session à un visiteur', async () => {
    expect((await harnais.anonyme().get('/api/auth/session')).status).toBe(401);
  });
});
