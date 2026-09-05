import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

/**
 * Applique les migrations en attente.
 *
 * Utilise volontairement `DATABASE_URL`, le role proprietaire : il possede les
 * tables et n'est donc pas soumis aux politiques de Row-Level Security. Le role
 * applicatif ne doit jamais servir ici, sous peine de voir une migration
 * echouer ou, pire, ne modifier qu'une partie des lignes.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL est absent. Voir .env.example.');
  }

  const { db, close } = createDatabase({ connectionString });
  const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

  try {
    await migrate(db, { migrationsFolder });
    console.log('Migrations appliquees.');
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
