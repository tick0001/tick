import { resolve } from 'node:path';
import { z } from 'zod';

/**
 * Charge les fichiers `.env` avant toute lecture de configuration.
 *
 * Appele explicitement plutot que laisse a l'environnement du shell : `node
 * dist/main.js` doit se comporter comme `pnpm dev`, sur un poste comme dans un
 * conteneur. Les variables deja definies dans l'environnement ont la priorite,
 * ce que garantit `process.loadEnvFile`.
 *
 * `__dirname` vaut `<racine>/apps/api/{src,dist}/config` : la racine du depot
 * est a quatre niveaux au-dessus, que le code soit compile ou non.
 */
export function appRoot(): string {
  return resolve(__dirname, '../../../..');
}

export function loadEnvFiles(): void {
  const candidates = [resolve(process.cwd(), '.env'), resolve(__dirname, '../../../..', '.env')];

  for (const candidate of candidates) {
    try {
      process.loadEnvFile(candidate);
      return;
    } catch {
      // Fichier absent : on essaie le suivant, puis on s'en remet a l'environnement.
    }
  }
}

/**
 * Configuration d'execution, validee au demarrage.
 *
 * Le processus refuse de demarrer si une variable est absente ou mal formee :
 * une API qui demarre avec une configuration incomplete echoue plus tard, ailleurs,
 * et pour une raison illisible.
 */
/**
 * Booleen venant d'une variable d'environnement.
 *
 * `z.coerce.boolean()` ne convient pas : il applique la veracite JavaScript, ou
 * la chaine « false » vaut vrai. Un `SMTP_SECURE=false` activait ainsi le TLS
 * implicite, et l'echec ne se voyait qu'au premier envoi.
 */
const envBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((valeur) => valeur === true || valeur === 'true' || valeur === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(3000),
  API_URL: z.string().url().default('http://localhost:3000'),
  WEB_URL: z.string().url().default('http://localhost:5173'),

  // Role proprietaire : migrations uniquement, exempte de Row-Level Security.
  DATABASE_URL: z.string().url(),
  // Role applicatif : tout le trafic normal, soumis au Row-Level Security.
  DATABASE_APP_URL: z.string().url(),

  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  /**
   * Cle de chiffrement des secrets stockes en base (mots de passe de comptes de
   * service d'annuaire, jetons d'integration). 32 octets en hexadecimal.
   * Distincte de SESSION_SECRET : la perdre invalide des secrets reutilisables,
   * pas seulement des sessions.
   */
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'doit faire 32 octets en hexadecimal (64 caracteres)'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: envBoolean.default(false),
  SMTP_FROM: z.string().default('tick@localhost'),

  DEFAULT_LOCALE: z.enum(['fr', 'en']).default('fr'),
  STORAGE_PATH: z.string().default('./storage'),
  /**
   * Racine ou sont cherches les plugins. Relative au repertoire de travail.
   * Les plugins de premier rang vivent dans le depot ; une installation reelle
   * pointera vers un dossier de donnees.
   */
  PLUGINS_PATH: z.string().default('./plugins'),
  /**
   * Verbosite du journal. Chaque niveau inclut les precedents.
   * `debug` trace notamment la distribution des evenements aux plugins.
   */
  LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
  /**
   * Ce processus consomme-t-il la file d'evenements ?
   *
   * Faux pour tout outil en ligne de commande : un script qui demarre le
   * conteneur applicatif demarrerait sinon un consommateur, qui prendrait des
   * evenements destines a l'API et les acquitterait sans les traiter — sans
   * aucune trace, puisque le travail est bien depile.
   */
  RUN_EVENT_WORKER: envBoolean.default(true),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')} : ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration invalide.\n${details}\n\nVoir .env.example.`);
  }

  return result.data;
}
