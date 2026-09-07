import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

/**
 * Rend un fragment SQL sous sa forme paramétrée.
 *
 * Le texte revient avec ses marqueurs `$1`, `$2`… et les valeurs à part, telles
 * que le pilote les enverra. C'est exactement ce que PostgreSQL recevra, et
 * c'est ce qui permet de vérifier deux choses qu'aucune autre lecture ne
 * montre : que l'opérateur produit est le bon, et que les valeurs sont **hors**
 * du texte plutôt que concaténées dedans.
 *
 * Cette seconde garantie est celle qui tient la sécurité du moteur de
 * recherche. Une régression y serait invisible à la relecture — le SQL
 * ressemblerait au précédent — et se lirait ici en une ligne.
 *
 * Le rendu vit dans `@tick/db` parce que `drizzle-orm` n'est la dépendance
 * que de ce paquet : l'exposer ici évite que chaque consommateur ait à
 * connaître le dialecte, et garde un seul point d'entrée vers la couche
 * données.
 */
export function rendreSql(fragment: SQL): { texte: string; parametres: unknown[] } {
  const requete = new PgDialect().sqlToQuery(fragment);

  return { texte: requete.sql, parametres: requete.params };
}
