import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ECHECS_AVANT_BLOCAGE, ECHECS_PAR_ADRESSE } from '../../auth/limite-connexion.service.js';
import { creerHarnais, viderLimiteDesConnexions, type Harnais } from './harnais.js';

/**
 * La limite des tentatives de connexion, de bout en bout : Redis réel, relais
 * de confiance réel, en-têtes réels.
 *
 * Les adresses viennent de `X-Forwarded-For`, que l'API croit parce que la
 * requête arrive de la boucle locale — c'est ainsi qu'elle voit les clients
 * derrière nginx. Chaque cas prend la sienne, dans une plage de documentation.
 */
describe('HTTP — limite des tentatives de connexion', () => {
  let harnais: Harnais;
  let adresse = 0;

  beforeAll(async () => {
    harnais = await creerHarnais('connexion');
  }, 120_000);

  afterAll(async () => {
    await harnais.close();
  });

  beforeEach(async () => {
    await viderLimiteDesConnexions();
    adresse += 1;
  });

  const depuis = () => `203.0.113.${String(adresse)}`;

  const tenter = (username: string, password: string, ip = depuis()) =>
    harnais
      .anonyme()
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ username, password });

  it('bloque un compte après des échecs répétés, et dit quand réessayer', async () => {
    const compte = harnais.prefixe + 'inconnu';

    for (let i = 1; i < ECHECS_AVANT_BLOCAGE; i += 1) {
      expect((await tenter(compte, 'faux')).status).toBe(401);
    }

    // L'échec qui déclenche le blocage le dit tout de suite.
    const bloque = await tenter(compte, 'faux');

    expect(bloque.status).toBe(429);
    expect(bloque.headers['retry-after']).toBe('60');
    expect(bloque.body.message).toMatch(/Réessayez dans 1 minute\./);

    // Et la tentative suivante est refusée avant toute vérification.
    expect((await tenter(compte, 'faux')).status).toBe(429);
  });

  it('refuse même le bon mot de passe pendant le blocage', async () => {
    for (let i = 0; i < ECHECS_AVANT_BLOCAGE; i += 1) await tenter('sophie', 'faux');

    expect((await tenter('sophie', 'tick')).status).toBe(429);
  });

  it('bloque le compte, et non la seule adresse qui insiste', async () => {
    for (let i = 0; i < ECHECS_AVANT_BLOCAGE; i += 1) {
      await tenter('sophie', 'faux', `198.51.100.${String(i)}`);
    }

    expect((await tenter('sophie', 'tick', '192.0.2.200')).status).toBe(429);
  });

  it('efface les échecs d’un compte à la connexion réussie', async () => {
    for (let i = 1; i < ECHECS_AVANT_BLOCAGE; i += 1) await tenter('sophie', 'faux');

    expect((await tenter('sophie', 'tick')).status).toBe(200);

    for (let i = 1; i < ECHECS_AVANT_BLOCAGE; i += 1) {
      expect((await tenter('sophie', 'faux')).status).toBe(401);
    }
  });

  it('bloque une adresse qui essaie de nombreux comptes, et elle seule', async () => {
    for (let i = 0; i < ECHECS_PAR_ADRESSE; i += 1) {
      await tenter(`${harnais.prefixe}balayage-${String(i)}`, 'faux');
    }

    expect((await tenter('sophie', 'tick')).status).toBe(429);
    expect((await tenter('sophie', 'tick', '192.0.2.201')).status).toBe(200);
  });

  it('ne compte pas un refus de format comme une tentative', async () => {
    for (let i = 0; i < ECHECS_AVANT_BLOCAGE + 1; i += 1) {
      const reponse = await harnais
        .anonyme()
        .post('/api/auth/login')
        .set('X-Forwarded-For', depuis())
        .send({ username: 'sophie' });

      expect(reponse.status).toBe(400);
    }

    expect((await tenter('sophie', 'tick')).status).toBe(200);
  });
});
