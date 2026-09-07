import 'reflect-metadata';

/**
 * Ecrit le document OpenAPI sur la sortie standard.
 *
 * Sert a le publier hors ligne : `pnpm openapi > openapi.json` produit le
 * fichier qu'on versionne ou qu'on donne a un generateur de client, sans avoir
 * a demarrer l'API ni a l'atteindre par le reseau.
 */
import { writeFileSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { loadEnvFiles } from '../config/env.js';
import { construireOpenApi, decouvrirRoutes } from '../openapi/openapi.builder.js';

async function main(): Promise<void> {
  loadEnvFiles();
  process.env['RUN_EVENT_WORKER'] = 'false';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });

  try {
    const document = construireOpenApi(decouvrirRoutes(app), {
      titre: 'Tick&',
      version: process.env['npm_package_version'] ?? '0.0.0',
      serveur: process.env['API_URL'] ?? 'http://localhost:3000',
    });

    const json = JSON.stringify(document, null, 2);
    const destination = process.argv[2];

    if (destination) {
      writeFileSync(destination, json + '\n', 'utf8');
    } else {
      process.stdout.write(json + '\n');
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
