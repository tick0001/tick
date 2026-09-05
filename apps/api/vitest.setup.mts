import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Charge le `.env` de la racine pour les tests locaux.
 *
 * Les variables deja presentes dans l'environnement ont la priorite : en
 * integration continue elles sont fournies par le workflow, et le fichier
 * n'existe pas.
 */
const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    if (process.env[key] !== undefined) continue;

    process.env[key] = trimmed.slice(separator + 1).trim();
  }
} catch {
  // Absent en integration continue : les variables viennent du workflow.
}
