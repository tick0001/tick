import { afterEach, describe, expect, it } from 'vitest';
import { adresseInterne, verifierHoteSortant } from './reseau.js';

const originale = process.env['ALLOW_PRIVATE_OUTBOUND'];

afterEach(() => {
  if (originale === undefined) delete process.env['ALLOW_PRIVATE_OUTBOUND'];
  else process.env['ALLOW_PRIVATE_OUTBOUND'] = originale;
});

describe('adresseInterne', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254', // adresse de metadonnees des hebergeurs
    '100.64.0.1',
    '::1',
    'fd00::1',
    'fe80::1',
  ])('refuse %s', (adresse) => {
    expect(adresseInterne(adresse)).toBe(true);
  });

  it.each(['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])('accepte %s', (adresse) => {
    expect(adresseInterne(adresse)).toBe(false);
  });

  it("n'affirme rien d'un nom d'hote", () => {
    expect(adresseInterne('exemple.fr')).toBe(false);
  });
});

describe('verifierHoteSortant', () => {
  it('laisse tout passer quand le controle est desactive', async () => {
    process.env['ALLOW_PRIVATE_OUTBOUND'] = 'true';
    await expect(verifierHoteSortant('127.0.0.1')).resolves.toBeUndefined();
  });

  it('refuse une adresse interne litterale', async () => {
    process.env['ALLOW_PRIVATE_OUTBOUND'] = 'false';
    await expect(verifierHoteSortant('169.254.169.254')).rejects.toThrow(/reseau interne/);
  });

  it('accepte une adresse publique litterale', async () => {
    process.env['ALLOW_PRIVATE_OUTBOUND'] = 'false';
    await expect(verifierHoteSortant('1.1.1.1')).resolves.toBeUndefined();
  });

  it('refuse localhost, qui resout vers la boucle locale', async () => {
    process.env['ALLOW_PRIVATE_OUTBOUND'] = 'false';
    await expect(verifierHoteSortant('localhost')).rejects.toThrow(/reseau interne/);
  });

  it('accepte un nom qui ne resout pas, pour ne pas masquer la vraie erreur', async () => {
    process.env['ALLOW_PRIVATE_OUTBOUND'] = 'false';
    await expect(verifierHoteSortant('nom-qui-nexiste-pas.invalid')).resolves.toBeUndefined();
  });

  it('accepte une adresse IPv6 entre crochets', async () => {
    process.env['ALLOW_PRIVATE_OUTBOUND'] = 'false';
    await expect(verifierHoteSortant('[2606:4700:4700::1111]')).resolves.toBeUndefined();
  });
});
