import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolConfig } from 'pg';
import * as schema from './schema/index.js';

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
export function createDatabase(options: ConnectionOptions): { db: Database; pool: Pool } {
  const pool = new Pool(options);
  const db = drizzle(pool, { schema, casing: 'snake_case' });

  return { db, pool };
}

export { schema };
