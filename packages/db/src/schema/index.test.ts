import { getTableColumns, getTableName, is, Table } from 'drizzle-orm';
import { PgEnumColumn, type PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import * as schema from './index.js';

/**
 * Invariants du schéma, vérifiés sur ce que le paquet exporte réellement.
 *
 * Un test par table les ferait diverger : celle qu'on ajoute demain n'aurait
 * pas le sien. On part donc des exports, si bien qu'une table nouvelle est
 * soumise aux mêmes règles sans que personne y pense.
 *
 * Ces règles ne sont pas décoratives. `entity_path` dénormalisé est ce sur quoi
 * reposent toutes les politiques de sécurité au niveau des lignes : une table
 * ajoutée sans lui compile, migre, et laisse fuir ses lignes entre entités.
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

/** Tables portant une entité, donc soumises au Row-Level Security. */
const AVEC_ENTITE = new Set([
  'groups',
  'itil_categories',
  'request_sources',
  'task_categories',
  'solution_types',
  'locations',
  'suppliers',
  'ticket_templates',
  'tickets',
  'problems',
  'changes',
  'itil_followups',
  'itil_tasks',
  'itil_solutions',
  'itil_validations',
  'itil_costs',
  'logs',
  'saved_searches',
  'notification_templates',
  'notification_queue',
  'documents',
  'calendars',
  'agreements',
  'rules',
  'mail_collectors',
  'mail_collector_logs',
  'satisfaction_configs',
  'satisfactions',
  'kb_categories',
  'kb_articles',
  'forms',
  'form_submissions',
  'recurring_tickets',
  'unavailabilities',
  'dashboards',
  'entities',
]);

/**
 * `authorizations` n'a volontairement pas de chemin dénormalisé.
 *
 * Sa politique joint `entities` : la table est petite, lue une fois par
 * connexion, et son `entity_id` est déjà la clé de jointure. La dénormalisation
 * n'y gagnerait rien et ajouterait un déclencheur à maintenir. L'exception est
 * nommée ici pour qu'elle reste une décision, et non un oubli.
 */
const SANS_CHEMIN = new Set(['authorizations']);

describe('Schéma', () => {
  it('déclare au moins quarante tables', () => {
    // Garde-fou : si l'index cessait de réexporter un module, ce fichier
    // continuerait de passer en ne vérifiant plus rien.
    expect(tables.length).toBeGreaterThan(40);
  });

  it.each(tables)('%s porte un nom et des colonnes', (_nom, table) => {
    expect(getTableName(table)).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(Object.keys(getTableColumns(table)).length).toBeGreaterThan(0);
  });

  /**
   * Les noms de colonnes restent en `snake_case`.
   *
   * Le SQL brut est écrit à la main dans plusieurs services : une colonne en
   * `camelCase` y demanderait des guillemets que personne ne mettra, et
   * l'erreur ne sortirait qu'à l'exécution de cette requête-là.
   */
  it.each(tables)('%s nomme ses colonnes en snake_case', (nom, table) => {
    for (const colonne of Object.values(getTableColumns(table))) {
      expect(colonne.name, `${nom}.${colonne.name}`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it.each(tables)('%s dénormalise entity_path si elle porte une entité', (_nom, table) => {
    const table_ = getTableName(table);

    if (!AVEC_ENTITE.has(table_) || SANS_CHEMIN.has(table_)) return;

    const colonnes = Object.values(getTableColumns(table)).map((colonne) => colonne.name);

    // `entities` porte `path`, les autres portent `entity_path` : dans les deux
    // cas, la politique de securite compare un chemin materialise.
    expect(colonnes).toContain(table_ === 'entities' ? 'path' : 'entity_path');
  });

  it('rattache chaque entity_path à un entity_id', () => {
    // Le declencheur recalcule le chemin depuis l'identifiant : sans les deux,
    // il n'a rien a recopier, et le chemin reste a « temporaire ».
    for (const [nom, table] of tables) {
      const colonnes = Object.values(getTableColumns(table)).map((colonne) => colonne.name);

      if (colonnes.includes('entity_path') && getTableName(table) !== 'entities') {
        expect(colonnes, nom).toContain('entity_id');
      }
    }
  });
});

describe('Énumérations', () => {
  // Une enumeration Drizzle est une **fonction** porteuse de proprietes : elle
  // s'appelle pour declarer une colonne. Un filtre sur `typeof === 'object'` la
  // manquerait entierement, et ce bloc passerait en ne testant rien.
  const enums = Object.entries(exportes).filter(
    (entree): entree is [string, { enumName: string; enumValues: readonly string[] }] =>
      entree[1] !== null &&
      (typeof entree[1] === 'object' || typeof entree[1] === 'function') &&
      'enumName' in entree[1] &&
      'enumValues' in entree[1],
  );

  it('déclare au moins quinze énumérations', () => {
    expect(enums.length).toBeGreaterThan(15);
  });

  it.each(enums)('%s a un nom et des valeurs non vides', (_nom, enumeration) => {
    expect(enumeration.enumName).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(enumeration.enumValues.length).toBeGreaterThan(0);

    for (const valeur of enumeration.enumValues) {
      expect(valeur.length).toBeGreaterThan(0);
    }
  });

  it.each(enums)('%s n’a pas de valeur en double', (_nom, enumeration) => {
    expect(new Set(enumeration.enumValues).size).toBe(enumeration.enumValues.length);
  });

  it('n’expose aucune colonne énumérée dont le type serait absent du schéma', () => {
    const connus = new Set(enums.map(([, enumeration]) => enumeration.enumName));

    for (const [nom, table] of tables) {
      for (const colonne of Object.values(getTableColumns(table))) {
        if (!is(colonne, PgEnumColumn)) continue;

        // Une colonne pointant sur une enumeration non exportee migrerait vers
        // un type que le schema TypeScript ne connait pas : la valeur serait
        // acceptee en base et refusee a la lecture.
        expect(connus, `${nom}.${colonne.name}`).toContain(colonne.enum.enumName);
      }
    }
  });
});

describe('Types personnalisés', () => {
  it('déclare ltree et citext avec leur type PostgreSQL', () => {
    // Ce sont deux extensions : le type doit sortir tel quel dans le DDL, sans
    // quoi la migration creerait un `text` et l'operateur `<@` disparaitrait.
    expect(schema).toBeDefined();
    expect(getTableName(schema.entities)).toBe('entities');

    const chemin = getTableColumns(schema.entities)['path'];

    expect(chemin?.getSQLType()).toBe('ltree');

    const identifiant = getTableColumns(schema.users)['username'];

    expect(identifiant?.getSQLType()).toBe('citext');
  });
});
