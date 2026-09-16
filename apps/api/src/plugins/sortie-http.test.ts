import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { requeteSortante } from './sortie-http.js';

/**
 * Le client HTTP des plugins, contre un serveur local.
 *
 * Ce qui compte n'est pas qu'il sache envoyer une requete — `node:http` le sait
 * — mais qu'il refuse ce que la politique de l'instance refuse, et qu'il ne
 * suive pas une redirection qui menerait ailleurs.
 */
describe('requeteSortante', () => {
  let serveur: Server;
  let base = '';
  let ciblesAtteintes = 0;
  const originale = process.env['ALLOW_PRIVATE_OUTBOUND'];

  beforeAll(async () => {
    serveur = createServer((requete, reponse) => {
      const morceaux: Buffer[] = [];

      requete.on('data', (morceau: Buffer) => morceaux.push(morceau));
      requete.on('end', () => {
        switch (requete.url) {
          case '/echo':
            reponse.writeHead(201, { 'content-type': 'application/json', 'x-essai': 'oui' });
            reponse.end(
              JSON.stringify({
                methode: requete.method,
                corps: Buffer.concat(morceaux).toString('utf8'),
                jeton: requete.headers['authorization'] ?? null,
                agent: requete.headers['user-agent'] ?? null,
              }),
            );
            break;
          case '/redirection':
            reponse.writeHead(302, { location: '/cible' });
            reponse.end();
            break;
          case '/cible':
            ciblesAtteintes += 1;
            reponse.end('atteinte');
            break;
          case '/gros':
            reponse.end(Buffer.alloc(2 * 1024 * 1024, 'a'));
            break;
          case '/lent':
            // Ne repond jamais : c'est le delai qui doit conclure.
            break;
          default:
            reponse.writeHead(404);
            reponse.end();
        }
      });
    });

    await new Promise<void>((resoudre) => {
      serveur.listen(0, '127.0.0.1', resoudre);
    });
    base = `http://127.0.0.1:${String((serveur.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    serveur.closeAllConnections();
    await new Promise<void>((resoudre) => {
      serveur.close(() => resoudre());
    });
  });

  afterEach(() => {
    if (originale === undefined) delete process.env['ALLOW_PRIVATE_OUTBOUND'];
    else process.env['ALLOW_PRIVATE_OUTBOUND'] = originale;
  });

  const autoriserLocal = () => {
    process.env['ALLOW_PRIVATE_OUTBOUND'] = 'true';
  };

  it('envoie la methode, les en-tetes et le corps, et rend la reponse', async () => {
    autoriserLocal();

    const reponse = await requeteSortante(`${base}/echo`, {
      method: 'POST',
      headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
      body: '{"text":"bonjour"}',
    });

    expect(reponse.status).toBe(201);
    expect(reponse.headers['x-essai']).toBe('oui');
    expect(JSON.parse(reponse.body)).toEqual({
      methode: 'POST',
      corps: '{"text":"bonjour"}',
      jeton: 'Bearer secret',
      agent: 'Tick&',
    });
  });

  it('suit le nom localhost jusqu a l adresse resolue', async () => {
    autoriserLocal();

    const port = (serveur.address() as AddressInfo).port;
    const reponse = await requeteSortante(`http://localhost:${String(port)}/cible`);

    expect(reponse.body).toBe('atteinte');
  });

  it.each(['ftp://exemple.fr/', 'file:///etc/passwd', 'gopher://exemple.fr/'])(
    'refuse le schema de %s',
    async (url) => {
      await expect(requeteSortante(url)).rejects.toThrow(/Schema refuse/);
    },
  );

  it('refuse des identifiants dans l adresse', async () => {
    await expect(requeteSortante('https://moi:secret@exemple.fr/')).rejects.toThrow(
      /Identifiants refuses/,
    );
  });

  it('ne suit pas une redirection', async () => {
    autoriserLocal();
    const avant = ciblesAtteintes;

    const reponse = await requeteSortante(`${base}/redirection`);

    expect(reponse.status).toBe(302);
    expect(reponse.headers['location']).toBe('/cible');
    expect(ciblesAtteintes).toBe(avant);
  });

  it('abandonne passe le delai', async () => {
    autoriserLocal();

    await expect(requeteSortante(`${base}/lent`, { timeoutMs: 200 })).rejects.toThrow(
      /Pas de reponse/,
    );
  });

  it('tronque une reponse au-dela d un megaoctet', async () => {
    autoriserLocal();

    const reponse = await requeteSortante(`${base}/gros`);

    expect(reponse.body.length).toBe(1024 * 1024);
  });

  describe('quand l instance refuse les reseaux internes', () => {
    it.each(['http://127.0.0.1/', 'http://localhost/', 'http://[::1]/', 'http://169.254.169.254/'])(
      'refuse %s avant toute connexion',
      async (url) => {
        process.env['ALLOW_PRIVATE_OUTBOUND'] = 'false';

        await expect(requeteSortante(url)).rejects.toThrow(/reseau interne/);
      },
    );

    it('refuse aussi le serveur local qui, lui, repond', async () => {
      process.env['ALLOW_PRIVATE_OUTBOUND'] = 'false';
      const avant = ciblesAtteintes;

      await expect(requeteSortante(`${base}/cible`)).rejects.toThrow(/reseau interne/);
      expect(ciblesAtteintes).toBe(avant);
    });
  });
});
