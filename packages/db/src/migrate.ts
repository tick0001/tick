import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from './client.js';

/**
 * Charge le `.env` de la racine du dépôt.
 *
 * La commande se lance depuis n'importe quel répertoire — `pnpm db:migrate` à
 * la racine la déclenche dans `packages/db` — alors que le fichier de
 * configuration, lui, est unique et vit à la racine. Le chercher en remontant
 * évite de dépendre du répertoire courant.
 */
function loadEnvFile(): void {
  let dossier = dirname(fileURLToPath(import.meta.url));

  for (;;) {
    const candidat = join(dossier, '.env');

    if (existsSync(candidat)) {
      process.loadEnvFile(candidat);
      return;
    }

    const parent = dirname(dossier);

    if (parent === dossier) {
      return;
    }

    dossier = parent;
  }
}

/**
 * Applique les migrations en attente.
 *
 * Utilise volontairement `DATABASE_URL`, le role proprietaire : il possede les
 * tables et n'est donc pas soumis aux politiques de Row-Level Security. Le role
 * applicatif ne doit jamais servir ici, sous peine de voir une migration
 * echouer ou, pire, ne modifier qu'une partie des lignes.
 */
async function main(): Promise<void> {
  loadEnvFile();

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
