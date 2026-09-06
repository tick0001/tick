import { z } from 'zod';

/** Entite telle qu'elle apparait dans une liste ou un selecteur. */
export const entitySummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  /** Chemin lisible : « Racine > Filiale Nord > Site A ». */
  completeName: z.string(),
  /** Chemin technique ltree : `e1.e3.e4`. */
  path: z.string(),
  level: z.number().int().nonnegative(),
  parentId: z.number().int().positive().nullable(),
});
export type EntitySummary = z.infer<typeof entitySummarySchema>;

export const createEntitySchema = z.object({
  name: z.string().min(1).max(255),
  parentId: z.number().int().positive(),
  comment: z.string().max(2000).nullish(),
});
export type CreateEntity = z.infer<typeof createEntitySchema>;

export const updateEntitySchema = z.object({
  name: z.string().min(1).max(255).optional(),
  comment: z.string().max(2000).nullish(),
  /** Deplacement de sous-arbre : tous les descendants suivent. */
  parentId: z.number().int().positive().optional(),
});
export type UpdateEntity = z.infer<typeof updateEntitySchema>;

/** Cles de configuration heritables le long de l'arbre des entites. */
export const settingKeySchema = z.enum([
  'autoCloseDelayDays',
  'autoPurgeDelayDays',
  'mailFrom',
  'mailReplyTo',
  'defaultLocale',
  'priorityMatrix',
  'defaultTicketTemplateId',
]);
export type SettingKey = z.infer<typeof settingKeySchema>;

/**
 * Un reglage effectif, avec son origine.
 *
 * L'origine est tout l'interet : « 7 jours » ne dit pas si la valeur a ete posee
 * ici ou heritee de la racine, et c'est pourtant ce qu'il faut savoir avant de
 * la changer — modifier une valeur heritee la detache du parent, definitivement
 * et sans le dire.
 */
export const resolvedSettingSchema = z.object({
  key: settingKeySchema,
  value: z.unknown(),
  origin: z.object({ id: z.number().int(), completeName: z.string() }).nullable(),
  /** Vrai si la valeur est posee sur l'entite consultee, et non heritee. */
  isOwn: z.boolean(),
});
export type ResolvedSetting = z.infer<typeof resolvedSettingSchema>;

export const entitySettingsSchema = z.object({
  entityId: z.number().int(),
  entityName: z.string(),
  settings: z.array(resolvedSettingSchema),
});
export type EntitySettings = z.infer<typeof entitySettingsSchema>;

/**
 * Ecriture des reglages.
 *
 * `null` n'est pas « vide » mais « retablir l'heritage » : c'est la seule facon
 * de revenir au comportement du parent apres avoir pose une valeur locale. Les
 * cles absentes ne sont pas touchees, ce qui permet a l'ecran de n'envoyer que
 * ce qu'il a modifie.
 */
export const writeSettingsSchema = z.object({
  autoCloseDelayDays: z.number().int().min(0).max(3650).nullable().optional(),
  autoPurgeDelayDays: z.number().int().min(0).max(3650).nullable().optional(),
  mailFrom: z.string().max(255).nullable().optional(),
  mailReplyTo: z.string().max(255).nullable().optional(),
  defaultLocale: z.enum(['fr', 'en']).nullable().optional(),
  priorityMatrix: z
    .array(z.array(z.number().int().min(1).max(5)).length(5))
    .length(5)
    .nullable()
    .optional(),
  defaultTicketTemplateId: z.number().int().positive().nullable().optional(),
});
export type WriteSettings = z.infer<typeof writeSettingsSchema>;
