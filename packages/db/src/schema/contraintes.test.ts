import { getTableName, is, Table } from 'drizzle-orm';
import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

/**
 * Index et clés étrangères, vérifiés sur ce que le schéma déclare vraiment.
 *
 * Drizzle n'évalue les rappels `(t) => [...]` qu'à la demande : tant que
 * personne ne lit la configuration d'une table, une déclaration d'index fausse
 * ne se voit ni à la compilation ni à l'exécution. `getTableConfig` les force,
 * ce qui donne ici un double rôle — vérifier les invariants, et faire tomber
 * une déclaration cassée avant la migration.
 */

/**
 * Les exports sont élargis avant d'être filtrés.
 *
 * `Object.entries(schema)` produit l'union de tous les types exportés — tables,
 * énumérations, relations. Un prédicat de type doit être assignable à ce qu'il
 * filtre, ce qu'une union de cent quarante membres n'admet pas. Passer par
 * `unknown` rend le filtre écrivable sans rien affaiblir : ce qui en sort est
 * vérifié à l'exécution par `is`.
 */
const exportes = schema as Record<string, unknown>;

const tables = Object.entries(exportes)
  .filter((entree): entree is [string, PgTable] => is(entree[1], Table))
  .sort(([a], [b]) => a.localeCompare(b));

/**
 * `mail_collector_logs` porte un `entity_path` que sa politique ne lit pas.
 *
 * Elle passe par une jointure sur `mail_collectors` et compare le chemin *du
 * collecteur*. La colonne locale ne sert qu'aux exports, et n'a donc pas besoin
 * de l'index qui suit. L'exception est nommée pour qu'elle reste une décision.
 */
const SANS_GIST = new Set(['mail_collector_logs']);

describe('Index', () => {
  it('porte au moins un index par table, en moyenne', () => {
    // Garde-fou : si `getTableConfig` cessait de resoudre les rappels, tous les
    // tests de ce fichier passeraient en ne voyant plus aucun index.
    const total = tables.reduce((somme, [, table]) => somme + getTableConfig(table).indexes.length, 0);

    expect(total).toBeGreaterThan(tables.length);
  });

  it('trouve bien des tables portant un chemin d’entité', () => {
    // Le test suivant sort en silence pour une table sans `entity_path` : si la
    // lecture des colonnes cassait, il passerait en n'examinant plus rien.
    const portantes = tables.filter(([, table]) =>
      getTableConfig(table).columns.some((colonne) => colonne.name === 'entity_path'),
    );

    expect(portantes.length).toBeGreaterThan(30);
  });

  /**
   * Tout `entity_path` lu par une politique doit être indexé en GiST.
   *
   * `tick_in_scope` est une fonction SQL STABLE d'une seule instruction : le
   * planificateur l'inline et voit `entity_path <@ tick_scope_paths()`, qu'un
   * index GiST sert. Sans lui, chaque lecture balaie la table entière avant
   * d'en écarter la majeure partie — un défaut qui ne se voit pas en
   * développement, où les tables tiennent en quelques lignes.
   */
  it.each(tables)('%s indexe son chemin d’entité en GiST', (_nom, table) => {
    const config = getTableConfig(table);
    const nom = getTableName(table);

    if (SANS_GIST.has(nom)) return;
    if (!config.columns.some((colonne) => colonne.name === 'entity_path')) return;

    const gist = config.indexes.some(
      (index) =>
        index.config.method === 'gist' &&
        index.config.columns.some((colonne) => 'name' in colonne && colonne.name === 'entity_path'),
    );

    expect(gist, `${nom} lit entity_path sans index GiST`).toBe(true);
  });

  it('ne nomme jamais deux index pareil', () => {
    // Les noms d'index sont uniques par schema PostgreSQL, pas par table : un
    // doublon ne se voit qu'a la migration, une fois la moitie appliquee.
    const noms = tables.flatMap(([, table]) =>
      getTableConfig(table)
        .indexes.map((index) => index.config.name)
        .filter((nom): nom is string => typeof nom === 'string'),
    );

    expect(new Set(noms).size).toBe(noms.length);
  });

  it.each(tables)('%s nomme ses index en snake_case', (_nom, table) => {
    for (const index of getTableConfig(table).indexes) {
      expect(index.config.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});

describe('Clés étrangères', () => {
  it.each(tables)('%s référence des tables du schéma', (nom, table) => {
    const connues = new Set(tables.map(([, autre]) => getTableName(autre)));

    for (const cle of getTableConfig(table).foreignKeys) {
      // `reference()` execute le rappel differe de `references(() => ...)` :
      // une cible mal importee ne se manifesterait autrement qu'a la migration.
      const reference = cle.reference();

      expect(reference.columns.length).toBeGreaterThan(0);
      expect(reference.columns.length).toBe(reference.foreignColumns.length);
      expect(connues, `${nom} référence une table absente du schéma`).toContain(
        getTableName(reference.foreignTable),
      );
    }
  });

  it('déclare au moins une contrainte de contrôle ou une clé primaire par table', () => {
    for (const [nom, table] of tables) {
      const config = getTableConfig(table);
      const primaire =
        config.primaryKeys.length > 0 || config.columns.some((colonne) => colonne.primary);

      expect(primaire, `${nom} n'a pas de clé primaire`).toBe(true);
    }
  });
});
