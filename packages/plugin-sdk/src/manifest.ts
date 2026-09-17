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
 *
 * `routes`, `cron` et `notification:send` sont **réservées** : aucun point
 * d'extension ne leur correspond encore, et les déclarer n'ouvre rien. Elles
 * restent admises pour qu'un manifeste qui les nomme ne devienne pas invalide
 * le jour où elles serviront.
 */
export const pluginPermissionSchema = z.enum([
  'schema:own',
  'hooks',
  'events',
  'routes',
  'cron',
  'notification:send',
  'http:outbound',
  'search',
  'dashboards',
]);

/** Clé d'un réglage : elle nomme une ligne en base et un champ de formulaire. */
const cleReglage = z.string().regex(/^[a-z][a-z0-9_]*$/, 'minuscules, chiffres et soulignés');

const reglageCommun = {
  key: cleReglage,
  label: z.string().min(1).max(120),
  /** Aide affichée sous le champ. */
  description: z.string().max(500).optional(),
  /**
   * `instance` : une seule valeur pour toute l'installation.
   * `entity` : une valeur par entité, héritée de l'ancêtre le plus proche qui
   * en porte une. C'est ce qui permet à la racine de fixer un défaut, et à une
   * filiale de le remplacer pour elle et sa descendance.
   */
  scope: z.enum(['instance', 'entity']).default('instance'),
};

/**
 * Réglage déclaré par un plugin.
 *
 * **Déclaré, et non construit par le plugin** : le cœur affiche le formulaire,
 * valide la saisie, stocke la valeur et en résout l'héritage. Le plugin n'a
 * qu'à la lire. Aucune route à exposer, aucun écran à dessiner — et un secret
 * saisi par un administrateur ne transite jamais par du code de plugin avant
 * d'être chiffré.
 *
 * Un `secret` n'a pas de valeur par défaut : un secret écrit dans un manifeste
 * public n'en est pas un. Les réglages sont stricts — une clé inconnue, comme
 * `defaut` pour `default`, est refusée plutôt qu'ignorée en silence.
 */
export const pluginSettingSchema = z
  .discriminatedUnion('type', [
    z.strictObject({ ...reglageCommun, type: z.literal('text'), default: z.string().optional() }),
    z.strictObject({ ...reglageCommun, type: z.literal('secret') }),
    z.strictObject({
      ...reglageCommun,
      type: z.literal('boolean'),
      default: z.boolean().optional(),
    }),
    z.strictObject({
      ...reglageCommun,
      type: z.literal('number'),
      min: z.number().optional(),
      max: z.number().optional(),
      default: z.number().optional(),
    }),
    z.strictObject({
      ...reglageCommun,
      type: z.literal('enum'),
      options: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    }),
  ])
  .refine(
    (reglage) =>
      reglage.type !== 'enum' ||
      reglage.default === undefined ||
      reglage.options.includes(reglage.default),
    { message: 'la valeur par défaut doit figurer parmi les options' },
  );

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
  /** Réglages que l'administrateur renseigne depuis l'écran des extensions. */
  settings: z
    .array(pluginSettingSchema)
    .max(50)
    .default([])
    .refine((reglages) => new Set(reglages.map((r) => r.key)).size === reglages.length, {
      message: 'deux réglages portent la même clé',
    }),
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
export type PluginSetting = z.infer<typeof pluginSettingSchema>;

/** Nom du schéma PostgreSQL réservé à un plugin. */
export function pluginSchemaName(id: string): string {
  return `plugin_${id.replaceAll('-', '_')}`;
}
