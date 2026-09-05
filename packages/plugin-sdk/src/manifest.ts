import { z } from 'zod';

/**
 * Identifiant de plugin.
 *
 * Contraint parce qu'il n'est pas seulement une clé : il devient un nom de
 * schéma PostgreSQL (`plugin_<id>`), un segment d'URL et un préfixe de droit.
 * Un identifiant libre casserait l'un des trois.
 */
export const pluginIdSchema = z
  .string()
  .min(2)
  .max(48)
  .regex(
    /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/,
    'minuscules, chiffres et tirets, en commençant par une lettre',
  );

/** Portée d'un droit déclaré par un plugin, alignée sur celles du cœur. */
export const pluginRightSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  actions: z.array(z.enum(['read', 'create', 'update', 'delete'])).min(1),
});

/**
 * Permissions déclarées.
 *
 * Elles ne remplacent pas une isolation — le plugin s'exécute dans le processus
 * de l'API — mais rendent ses intentions auditables **avant** installation, et
 * transforment un débordement en refus tracé plutôt qu'en accès silencieux.
 */
export const pluginPermissionSchema = z.enum([
  'schema:own',
  'hooks',
  'events',
  'routes',
  'cron',
  'notification:send',
  'http:outbound',
]);

export const pluginManifestSchema = z.object({
  id: pluginIdSchema,
  name: z.string().min(1).max(120),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'version semver attendue'),
  /**
   * Contrainte de compatibilité sur la version du **SDK**, pas sur celle de
   * l'application. Le cœur peut évoluer tant que le contrat tient.
   */
  sdk: z.string().min(1),
  description: z.string().max(500).optional(),
  author: z.string().max(200).optional(),
  license: z.string().max(60).optional(),
  homepage: z.string().url().optional(),
  /** Autres plugins requis, avec leur plage de versions acceptée. */
  dependencies: z.record(pluginIdSchema, z.string()).default({}),
  permissions: z.array(pluginPermissionSchema).default([]),
  rights: z.array(pluginRightSchema).default([]),
  /** Point d'entrée serveur, relatif au dossier du plugin. */
  server: z.string().min(1).optional(),
  /** Point d'entrée interface, module ESM chargé à l'exécution. */
  client: z.string().min(1).optional(),
  /** Dossier des migrations SQL, appliquées dans l'ordre des noms de fichiers. */
  migrations: z.string().min(1).default('./migrations'),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;
export type PluginPermission = z.infer<typeof pluginPermissionSchema>;
export type PluginRight = z.infer<typeof pluginRightSchema>;

/** Nom du schéma PostgreSQL réservé à un plugin. */
export function pluginSchemaName(id: string): string {
  return `plugin_${id.replaceAll('-', '_')}`;
}
