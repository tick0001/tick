import { z } from 'zod';

/**
 * Plugins et leurs réglages, vus depuis l'écran des extensions.
 *
 * Le manifeste déclare les réglages ; le cœur les affiche, les valide et les
 * stocke. Ces contrats décrivent ce qui traverse l'API pour cela.
 */

export const pluginStateSchema = z.enum(['decouvert', 'installe', 'actif', 'inactif', 'erreur']);
export type PluginState = z.infer<typeof pluginStateSchema>;

export const pluginStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  state: pluginStateSchema,
  sdkRange: z.string(),
  compatible: z.boolean(),
  hasClient: z.boolean(),
  lastError: z.string().nullable(),
  description: z.string().nullable(),
  /**
   * Ce que le plugin a déclaré vouloir faire. Affiché avant l'installation :
   * c'est tout l'intérêt de les déclarer.
   */
  permissions: z.array(z.string()),
  hasSettings: z.boolean(),
});
export type PluginStatus = z.infer<typeof pluginStatusSchema>;

export const pluginSettingValueSchema = z.union([z.string(), z.number(), z.boolean()]);
export type PluginSettingValue = z.infer<typeof pluginSettingValueSchema>;

/** Un réglage, tel que l'écran l'affiche pour un niveau donné. */
export const pluginSettingViewSchema = z.object({
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  type: z.enum(['text', 'secret', 'boolean', 'number', 'enum']),
  scope: z.enum(['instance', 'entity']),
  options: z.array(z.string()).nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  default: pluginSettingValueSchema.nullable(),
  /**
   * Valeur posée à ce niveau.
   *
   * **Toujours nulle pour un secret**, qui n'est jamais renvoyé : `isSet` dit
   * seulement s'il y en a un. L'écran peut ainsi afficher « enregistré » sans
   * remettre la valeur en circulation.
   */
  value: pluginSettingValueSchema.nullable(),
  isSet: z.boolean(),
  /**
   * Pour un réglage d'entité sans valeur à ce niveau : ce qui s'applique, et
   * d'où. Sans cela, l'administrateur d'une filiale ne sait pas qu'un réglage
   * vide chez lui est en fait renseigné plus haut.
   */
  inherited: z
    .object({
      fromEntityId: z.number().int().positive(),
      fromEntityName: z.string(),
      value: pluginSettingValueSchema.nullable(),
    })
    .nullable(),
});
export type PluginSettingView = z.infer<typeof pluginSettingViewSchema>;

export const pluginSettingsViewSchema = z.object({
  pluginId: z.string(),
  /** `null` : les réglages d'instance. Un nombre : ceux de cette entité. */
  entityId: z.number().int().positive().nullable(),
  settings: z.array(pluginSettingViewSchema),
});
export type PluginSettingsView = z.infer<typeof pluginSettingsViewSchema>;

export const pluginSettingsQuerySchema = z.object({
  entityId: z.coerce.number().int().positive().optional(),
});
export type PluginSettingsQuery = z.infer<typeof pluginSettingsQuerySchema>;

export const updatePluginSettingsSchema = z.object({
  entityId: z.number().int().positive().nullable(),
  /**
   * Clés absentes : inchangées. `null` : valeur retirée, le réglage hérite de
   * l'ancêtre ou du manifeste.
   *
   * Pour un secret, c'est la seule façon de l'effacer : une chaîne vide est
   * refusée, pour qu'un champ laissé blanc ne vide pas un secret par mégarde.
   */
  values: z.record(z.string(), pluginSettingValueSchema.nullable()),
});
export type UpdatePluginSettings = z.infer<typeof updatePluginSettingsSchema>;
