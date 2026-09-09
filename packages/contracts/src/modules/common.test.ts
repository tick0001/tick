import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  healthSchema,
  localeSchema,
  profileInterfaceSchema,
  queryBoolean,
  rightScopeSchema,
} from './common.js';

describe('healthSchema', () => {
  const checks = { database: true, queues: true };

  it('accepte une reponse valide', () => {
    const valeur = { status: 'ok', version: '1.2.3', uptimeSeconds: 42, checks };

    expect(healthSchema.parse(valeur)).toEqual(valeur);
  });

  it('refuse un temps de fonctionnement negatif', () => {
    expect(() =>
      healthSchema.parse({ status: 'ok', version: '1.0.0', uptimeSeconds: -1, checks }),
    ).toThrow();
  });

  it('n’accepte que les deux etats prevus', () => {
    expect(
      healthSchema.parse({ status: 'degraded', version: '1', uptimeSeconds: 0, checks }).status,
    ).toBe('degraded');
    expect(() =>
      healthSchema.parse({ status: 'ko', version: '1', uptimeSeconds: 0, checks }),
    ).toThrow();
  });

  it('exige le detail des dependances', () => {
    // Un « degraded » sans detail oblige a ouvrir les journaux du conteneur
    // pour savoir laquelle des deux manque : le champ est obligatoire.
    expect(() => healthSchema.parse({ status: 'ok', version: '1', uptimeSeconds: 0 })).toThrow();
  });

  it('nomme la dependance en cause', () => {
    const valeur = healthSchema.parse({
      status: 'degraded',
      version: '1',
      uptimeSeconds: 0,
      checks: { database: false, queues: true },
    });

    expect(valeur.checks).toEqual({ database: false, queues: true });
  });
});

describe('localeSchema', () => {
  it('couvre la langue par defaut', () => {
    expect(localeSchema.parse(DEFAULT_LOCALE)).toBe('fr');
  });

  it('refuse une langue non traduite', () => {
    expect(localeSchema.safeParse('de').success).toBe(false);
  });
});

describe('rightScopeSchema', () => {
  it('couvre les cinq portees, et rien de plus', () => {
    for (const portee of ['own', 'group', 'entity', 'recursive', 'all']) {
      expect(rightScopeSchema.parse(portee)).toBe(portee);
    }

    expect(rightScopeSchema.safeParse('none').success).toBe(false);
  });
});

describe('profileInterfaceSchema', () => {
  it('distingue l’interface complete de la simplifiee', () => {
    expect(profileInterfaceSchema.parse('standard')).toBe('standard');
    expect(profileInterfaceSchema.parse('self_service')).toBe('self_service');
    expect(profileInterfaceSchema.safeParse('admin').success).toBe(false);
  });
});

/**
 * Le piège que `queryBoolean` existe pour éviter.
 *
 * `z.coerce.boolean()` applique la véracité JavaScript, où la chaîne `"false"`
 * vaut vrai : un filtre s'activerait alors quand on le désactive. C'est
 * exactement le genre de bug qu'on met longtemps à croire, d'où ces cas
 * nommés un par un.
 */
describe('queryBoolean', () => {
  it('lit « false » comme faux, et non comme une chaine non vide', () => {
    expect(queryBoolean.parse('false')).toBe(false);
    expect(queryBoolean.parse('0')).toBe(false);
  });

  it('lit « true » et « 1 » comme vrai', () => {
    expect(queryBoolean.parse('true')).toBe(true);
    expect(queryBoolean.parse('1')).toBe(true);
  });

  it('laisse passer un booleen deja type', () => {
    expect(queryBoolean.parse(true)).toBe(true);
    expect(queryBoolean.parse(false)).toBe(false);
  });

  it('refuse tout ce qui n’est ni l’un ni l’autre', () => {
    for (const valeur of ['oui', 'yes', '2', '', 0, 1, null, undefined]) {
      expect(queryBoolean.safeParse(valeur).success).toBe(false);
    }
  });
});
