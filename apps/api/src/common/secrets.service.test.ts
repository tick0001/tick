import { beforeAll, describe, expect, it } from 'vitest';
import { SecretsService } from './secrets.service.js';

describe('SecretsService', () => {
  let secrets: SecretsService;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY ??= '0'.repeat(64);
    secrets = new SecretsService();
  });

  it('restitue la valeur chiffree', () => {
    expect(secrets.decrypt(secrets.encrypt('mot-de-passe-annuaire'))).toBe('mot-de-passe-annuaire');
  });

  it('produit un chiffre different a chaque appel', () => {
    // Vecteur d'initialisation aleatoire : deux secrets identiques ne doivent
    // pas se reconnaitre a leur seul chiffre en base.
    expect(secrets.encrypt('identique')).not.toBe(secrets.encrypt('identique'));
  });

  it("refuse un chiffre altere plutot que de le dechiffrer en n'importe quoi", () => {
    const chiffre = secrets.encrypt('valeur');
    const [iv, tag, data] = chiffre.split(':');
    const altere = [iv, tag, `${(data ?? '').slice(0, -2)}AA`].join(':');

    expect(() => secrets.decrypt(altere)).toThrow();
  });

  it('refuse un format inattendu', () => {
    expect(() => secrets.decrypt('pas-un-secret')).toThrowError(/format inattendu/);
  });
});
