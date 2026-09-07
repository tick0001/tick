import { sql, type SQL } from '@tick/db';

/**
 * Ce que toute requête en SQL brut a besoin de savoir.
 *
 * `tx.execute` court-circuite le typage de Drizzle : ce qui revient est une
 * ligne non typée, dont les colonnes n'ont pas la forme qu'un modèle promet.
 * Les convertisseurs ci-dessous font le pont, et ils n'appartiennent à aucun
 * domaine — un annuaire, un tableau de bord et un ticket lisent tous des dates
 * de la même façon.
 *
 * Ils vivaient auparavant dans `tickets/ticket-sql.ts`, que onze modules
 * étrangers au ticket importaient pour cette seule raison — jusqu'à `admin` et
 * `stats`. Une notion partagée logée dans un module métier finit par attirer
 * tout le monde chez lui.
 */

/**
 * Texte d'une valeur venant de SQL brut.
 *
 * Un objet ne doit jamais devenir « [object Object] » : il est serialise en
 * JSON, ce qui reste lisible et diagnosticable. Les autres types passent par
 * leur representation naturelle.
 */
export function toText(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return '';
  if (typeof valeur === 'string') return valeur;
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur);
  if (valeur instanceof Date) return valeur.toISOString();

  return JSON.stringify(valeur) ?? '';
}

/**
 * Convertit en date ISO une valeur venant de SQL brut.
 *
 * Selon la requete, une colonne temporelle revient en `Date` ou en chaine.
 * Supposer l'un des deux produit une panne a l'execution, loin de la requete
 * fautive.
 */
export function toIso(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) return valeur.toISOString();

  const date = new Date(toText(valeur));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Variante non nulle, pour les colonnes obligatoires. */
export function toIsoRequired(valeur: unknown): string {
  return toIso(valeur) ?? new Date(0).toISOString();
}

/**
 * Nom affiché d'un compte : prénom et nom si connus, identifiant sinon.
 *
 * Le fragment était retapé à l'identique dans onze requêtes. C'est une **règle
 * de présentation**, pas une expression SQL quelconque : le jour où elle change
 * — une particule à conserver, une colonne `display_name` à préférer — elle
 * doit changer partout, et onze copies ne changent jamais toutes.
 *
 * L'alias de la table est un paramètre parce que les requêtes ne nomment pas
 * `users` de la même façon : `u` le plus souvent, autre chose dès qu'une
 * seconde jointure sur les comptes entre en jeu. `null` pour une requête qui
 * n'interroge que `users` et n'a donc rien à qualifier.
 */
export function nomAffiche(alias: string | null = 'u'): SQL {
  const q = sql.raw(alias ? `${alias}.` : '');

  return sql`coalesce(
    nullif(trim(coalesce(${q}first_name, '') || ' ' || coalesce(${q}last_name, '')), ''),
    ${q}username::text
  )`;
}
