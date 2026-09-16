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

describe('reglages declares', () => {
  const avec = (settings: unknown[]) => pluginManifestSchema.parse({ ...minimal, settings });

  it('accepte chaque type, et place les reglages a l instance par defaut', () => {
    const manifeste = avec([
      { key: 'titre', label: 'Titre', type: 'text', default: 'Tick&' },
      { key: 'jeton', label: 'Jeton', type: 'secret', scope: 'entity' },
      { key: 'actif', label: 'Actif', type: 'boolean', default: true },
      { key: 'seuil', label: 'Seuil', type: 'number', min: 1, max: 5, default: 3 },
      { key: 'format', label: 'Format', type: 'enum', options: ['a', 'b'], default: 'b' },
    ]);

    expect(manifeste.settings.map((r) => r.type)).toEqual([
      'text',
      'secret',
      'boolean',
      'number',
      'enum',
    ]);
    expect(manifeste.settings[0]?.scope).toBe('instance');
    expect(manifeste.settings[1]?.scope).toBe('entity');
  });

  it('refuse une valeur par defaut pour un secret', () => {
    // Un secret ecrit dans un manifeste public n'en est pas un. Le schema
    // strict le rejette plutot que de l'ignorer en silence.
    expect(() =>
      avec([{ key: 'jeton', label: 'Jeton', type: 'secret', default: 'abc' }]),
    ).toThrow();
  });

  it('refuse une cle mal orthographiee', () => {
    expect(() => avec([{ key: 'actif', label: 'Actif', type: 'boolean', defaut: true }])).toThrow();
  });

  it('refuse une valeur par defaut absente des options', () => {
    expect(() =>
      avec([{ key: 'format', label: 'Format', type: 'enum', options: ['a'], default: 'z' }]),
    ).toThrow();
  });

  it('refuse deux reglages de meme cle', () => {
    expect(() =>
      avec([
        { key: 'jeton', label: 'Jeton', type: 'secret' },
        { key: 'jeton', label: 'Autre', type: 'text' },
      ]),
    ).toThrow(/même clé/);
  });

  it('refuse une cle qui ne ferait pas un nom de champ', () => {
    expect(() => avec([{ key: 'Mon Jeton', label: 'Jeton', type: 'secret' }])).toThrow();
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
