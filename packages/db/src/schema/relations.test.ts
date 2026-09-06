import {
  createTableRelationsHelpers,
  getTableName,
  is,
  Many,
  One,
  Relations,
  Table,
} from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

/**
 * Les relations déclarées pour le constructeur de requêtes relationnel.
 *
 * Drizzle n'évalue le rappel `({ one, many }) => ({ ... })` qu'au montage du
 * client : une relation pointant sur une mauvaise colonne se compile, migre, et
 * ne se manifeste qu'à la première requête `with: { ... }` qui l'emprunte. Les
 * forcer ici les remet dans le champ de la compilation.
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

const tables = new Set(
  Object.values(exportes)
    .filter((valeur): valeur is Table => is(valeur, Table))
    .map((table) => getTableName(table)),
);

const relations = Object.entries(exportes)
  .filter((entree): entree is [string, Relations] => is(entree[1], Relations))
  .sort(([a], [b]) => a.localeCompare(b));

describe('Relations', () => {
  it('en déclare au moins trente', () => {
    // Garde-fou : sans lui, un filtre casse rendrait tout ce fichier muet.
    expect(relations.length).toBeGreaterThan(30);
  });

  it.each(relations)('%s pointe sur des tables du schéma', (nom, relation) => {
    const config = relation.config(createTableRelationsHelpers(relation.table));

    expect(Object.keys(config).length).toBeGreaterThan(0);

    for (const [champ, declaration] of Object.entries(config)) {
      expect(is(declaration, One) || is(declaration, Many), `${nom}.${champ}`).toBe(true);
      expect(tables, `${nom}.${champ}`).toContain(getTableName(declaration.referencedTable));
    }
  });

  /**
   * Une relation `one` joint autant de colonnes qu'elle en référence.
   *
   * Un déséquilibre produit une jointure partielle : la requête aboutit, et
   * ramène la mauvaise ligne. C'est le genre de défaut qu'on impute d'abord aux
   * données.
   */
  it.each(relations)('%s équilibre ses jointures', (nom, relation) => {
    const config = relation.config(createTableRelationsHelpers(relation.table));

    for (const [champ, declaration] of Object.entries(config)) {
      if (!is(declaration, One)) continue;

      const { fields, references } = declaration.config ?? {};

      if (!fields || !references) continue;

      expect(fields.length, `${nom}.${champ}`).toBe(references.length);
      expect(fields.length).toBeGreaterThan(0);

      for (const colonne of references) {
        expect(getTableName(colonne.table)).toBe(getTableName(declaration.referencedTable));
      }
    }
  });
});
