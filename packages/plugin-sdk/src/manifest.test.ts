import { describe, expect, it } from 'vitest';
import { pluginManifestSchema, pluginSchemaName } from './manifest.js';

const minimal = {
  id: 'exemple-bonjour',
  name: 'Exemple',
  version: '1.0.0',
  sdk: '^0.1.0',
};

describe('pluginManifestSchema', () => {
  it('accepte un manifeste minimal et applique les valeurs par defaut', () => {
    const manifeste = pluginManifestSchema.parse(minimal);

    expect(manifeste.dependencies).toEqual({});
    expect(manifeste.permissions).toEqual([]);
    expect(manifeste.migrations).toBe('./migrations');
  });

  it.each([
    ['Majuscules', 'Exemple'],
    ['espace', 'mon plugin'],
    ['point', 'mon.plugin'],
    ['chiffre en tete', '1plugin'],
    ['tiret final', 'plugin-'],
    ['barre oblique', '../evasion'],
  ])('refuse un identifiant contenant %s', (_cas, id) => {
    // L'identifiant devient un nom de schema SQL et un segment d'URL : une
    // valeur libre permettrait une evasion de chemin ou un schema invalide.
    expect(() => pluginManifestSchema.parse({ ...minimal, id })).toThrow();
  });

  it('exige une version semver', () => {
    expect(() => pluginManifestSchema.parse({ ...minimal, version: '1.0' })).toThrow();
    expect(pluginManifestSchema.parse({ ...minimal, version: '1.0.0-beta.1' }).version).toBe(
      '1.0.0-beta.1',
    );
  });

  it('refuse une permission inconnue', () => {
    expect(() =>
      pluginManifestSchema.parse({ ...minimal, permissions: ['acces:total'] }),
    ).toThrow();
  });

  it('valide la forme des droits declares', () => {
    const manifeste = pluginManifestSchema.parse({
      ...minimal,
      rights: [{ key: 'rapport_sla', label: 'Rapports SLA', actions: ['read'] }],
    });

    expect(manifeste.rights[0]?.key).toBe('rapport_sla');
    expect(() =>
      pluginManifestSchema.parse({ ...minimal, rights: [{ key: 'x', label: 'X', actions: [] }] }),
    ).toThrow();
  });
});

describe('pluginSchemaName', () => {
  it('derive un nom de schema valide depuis un identifiant a tirets', () => {
    // Les tirets sont legaux dans un identifiant mais imposeraient des
    // guillemets partout dans le SQL.
    expect(pluginSchemaName('exemple-bonjour')).toBe('plugin_exemple_bonjour');
    expect(pluginSchemaName('sla')).toBe('plugin_sla');
  });
});
