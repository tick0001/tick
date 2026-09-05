import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, types, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

/**
 * Les entiers 64 bits reviennent en chaines par defaut.
 *
 * node-postgres serialise `bigint` en `string` pour ne pas perdre de precision
 * au-dela de 2^53. Le comportement est correct mais traitre : une requete
 * typee par Drizzle renvoie un nombre, la meme requete en SQL brut renvoie une
 * chaine, et une comparaison stricte entre les deux echoue sans erreur.
 *
 * L'analyseur est donc uniformise ici, avec un refus explicite plutot qu'une
 * perte de precision silencieuse si une valeur sortait un jour de la plage
 * sure. Les identites demarrent a 1 : il faudrait 9 x 10^15 lignes pour y
 * arriver.
 */
types.setTypeParser(types.builtins.INT8, (value: string): number => {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Entier 64 bits hors de la plage representable : ${value}`);
  }

  return parsed;
});

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface ConnectionOptions extends Omit<PoolConfig, 'connectionString'> {
  connectionString: string;
}

/**
 * Ouvre une connexion.
 *
 * Deux roles cohabitent volontairement :
 *
 *  - le role proprietaire (`DATABASE_URL`) possede les tables et n'est donc pas
 *    soumis au Row-Level Security. Il ne sert qu'aux migrations et a l'amorcage ;
 *  - le role applicatif (`DATABASE_APP_URL`) porte tout le trafic normal et
 *    reste soumis aux politiques.
 *
 * Confondre les deux annulerait silencieusement l'isolation entre entites.
 */
export interface Connection {
  db: Database;
  /** Ferme le pool. Le pool lui-meme n'est pas expose : les consommateurs
   *  n'ont pas a dependre des types de `pg`. */
  close: () => Promise<void>;
}

export function createDatabase(options: ConnectionOptions): Connection {
  const pool = new Pool(options);
  const db = drizzle(pool, { schema, casing: 'snake_case' });

  return { db, close: () => pool.end() };
}

export { schema };
