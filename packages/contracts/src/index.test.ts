import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, healthSchema, localeSchema } from './index.js';

describe('healthSchema', () => {
  it('accepte une reponse valide', () => {
    const valeur = { status: 'ok', version: '1.2.3', uptimeSeconds: 42 };

    expect(healthSchema.parse(valeur)).toEqual(valeur);
  });

  it('refuse un temps de fonctionnement negatif', () => {
    expect(() =>
      healthSchema.parse({ status: 'ok', version: '1.0.0', uptimeSeconds: -1 }),
    ).toThrow();
  });
});

describe('localeSchema', () => {
  it('couvre la langue par defaut', () => {
    expect(localeSchema.parse(DEFAULT_LOCALE)).toBe('fr');
  });
});
