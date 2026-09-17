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

  describe('encodage du corps', () => {
    // « café » en Windows-1252 : l'octet 0xE9 seul n'est pas de l'UTF-8.
    const latin1 = Buffer.concat([
      Buffer.from('{"username":"inconnu","password":"caf', 'utf8'),
      Buffer.from([0xe9]),
      Buffer.from('"}', 'utf8'),
    ]);

    // Sans serialiseur neutre, supertest transforme un tampon en JSON
    // (`{"type":"Buffer",…}`) : les octets a eprouver ne partiraient jamais.
    const brut = (corps: unknown) => corps as string;

    it('refuse un corps annoncé en UTF-8 qui n en est pas', async () => {
      const reponse = await harnais
        .anonyme()
        .post('/api/auth/login')
        .set('content-type', 'application/json')
        .serialize(brut)
        .send(latin1);

      expect(reponse.status).toBe(400);
      expect(reponse.body).toMatchObject({ message: expect.stringMatching(/UTF-8/) });
    });

    it('laisse passer un accent correctement encodé', async () => {
      const reponse = await harnais
        .anonyme()
        .post('/api/auth/login')
        .set('content-type', 'application/json')
        .serialize(brut)
        .send(Buffer.from('{"username":"inconnu","password":"café"}', 'utf8'));

      // Refusée pour de mauvais identifiants, pas pour son encodage.
      expect(reponse.status).toBe(401);
    });

    it('lit toujours un corps JSON ordinaire', async () => {
      const reponse = await harnais
        .anonyme()
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'tick' });

      expect(reponse.status).toBe(200);
    });
  });
});
