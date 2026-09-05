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

/**
 * Configuration d'une entite. Une valeur nulle signifie « heriter du parent ».
 * La resolution remonte l'arbre jusqu'a la premiere valeur explicite.
 */
export const entitySettingsSchema = z.object({
  autoCloseDelayDays: z.number().int().nonnegative().nullable(),
  autoPurgeDelayDays: z.number().int().nonnegative().nullable(),
  mailFrom: z.string().email().nullable(),
  mailReplyTo: z.string().email().nullable(),
  defaultLocale: z.string().nullable(),
});
export type EntitySettings = z.infer<typeof entitySettingsSchema>;

/** Valeur effective d'un parametre, avec l'entite dont elle provient. */
export const resolvedSettingSchema = z.object({
  value: z.unknown(),
  /** Entite d'origine, ou null si aucune valeur explicite n'existe dans l'arbre. */
  inheritedFrom: entitySummarySchema.nullable(),
});
export type ResolvedSetting = z.infer<typeof resolvedSettingSchema>;
