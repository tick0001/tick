import { z } from 'zod';
import { queryBoolean } from './common.js';
import { itilStatusSchema } from './itil.js';

/** Les trois objets ITIL partageant le socle commun. */
export const itilTypeSchema = z.enum(['ticket', 'problem', 'change']);
export type ItilType = z.infer<typeof itilTypeSchema>;

/** Les deux objets que ce module gere ; le ticket a le sien. */
export const itilKindSchema = z.enum(['problem', 'change']);
export type ItilKind = z.infer<typeof itilKindSchema>;

export const itilLinkTypeSchema = z.enum(['linked', 'duplicate', 'child']);
export type ItilLinkType = z.infer<typeof itilLinkTypeSchema>;

/** Une ligne de la liste de controle d'un changement. */
export const checklistItemSchema = z.object({
  label: z.string().min(1).max(200),
  done: z.boolean().default(false),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

/** Socle commun au probleme et au changement, tel que la liste l'affiche. */
export const itilObjectSummarySchema = z.object({
  id: z.number().int().positive(),
  kind: itilKindSchema,
  name: z.string(),
  status: itilStatusSchema,
  urgency: z.number().int().min(1).max(5),
  impact: z.number().int().min(1).max(5),
  priority: z.number().int().min(1).max(5),
  entityId: z.number().int(),
  entityName: z.string(),
  categoryId: z.number().int().nullable(),
  categoryName: z.string().nullable(),
  dateOpened: z.string(),
  requesters: z.array(z.string()),
  assignees: z.array(z.string()),
  followupCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
});
export type ItilObjectSummary = z.infer<typeof itilObjectSummarySchema>;

export const itilObjectSchema = itilObjectSummarySchema.extend({
  content: z.string(),
  locationId: z.number().int().nullable(),
  locationName: z.string().nullable(),
  dateSolved: z.string().nullable(),
  dateClosed: z.string().nullable(),
  internalTime: z.number().int().nonnegative(),
  createdBy: z.string().nullable(),
  updatedAt: z.string(),

  /** Champs du probleme, nuls sur un changement. */
  symptoms: z.string().nullable(),
  causes: z.string().nullable(),
  impacts: z.string().nullable(),

  /** Champs du changement, nuls sur un probleme. */
  deploymentPlan: z.string().nullable(),
  rollbackPlan: z.string().nullable(),
  validationPlan: z.string().nullable(),
  checklist: z.array(checklistItemSchema),
});
export type ItilObject = z.infer<typeof itilObjectSchema>;

const socleModifiable = {
  name: z.string().min(1).max(255),
  content: z.string().max(200_000).default(''),
  status: itilStatusSchema.optional(),
  urgency: z.number().int().min(1).max(5).default(3),
  impact: z.number().int().min(1).max(5).default(3),
  categoryId: z.number().int().positive().nullish(),
  locationId: z.number().int().positive().nullish(),
};

export const upsertItilObjectSchema = z.object({
  ...socleModifiable,

  symptoms: z.string().max(20_000).nullish(),
  causes: z.string().max(20_000).nullish(),
  impacts: z.string().max(20_000).nullish(),

  deploymentPlan: z.string().max(20_000).nullish(),
  rollbackPlan: z.string().max(20_000).nullish(),
  validationPlan: z.string().max(20_000).nullish(),
  checklist: z.array(checklistItemSchema).max(100).default([]),
});
export type UpsertItilObject = z.infer<typeof upsertItilObjectSchema>;

export const itilObjectFilterSchema = z.object({
  status: z.string().optional(),
  search: z.string().max(200).optional(),
  deleted: queryBoolean.default(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ItilObjectFilter = z.infer<typeof itilObjectFilterSchema>;

/** Un lien, vu depuis l'objet qui le consulte. */
export const itilLinkSchema = z.object({
  id: z.number().int().positive(),
  linkType: itilLinkTypeSchema,
  /** L'objet a l'autre bout, quel que soit le sens d'enregistrement du lien. */
  targetType: itilTypeSchema,
  targetId: z.number().int().positive(),
  targetName: z.string(),
  targetStatus: itilStatusSchema,
});
export type ItilLink = z.infer<typeof itilLinkSchema>;

export const createLinkSchema = z.object({
  targetType: itilTypeSchema,
  targetId: z.number().int().positive(),
  linkType: itilLinkTypeSchema.default('linked'),
});
export type CreateLink = z.infer<typeof createLinkSchema>;

/**
 * Promotion d'un objet vers un autre.
 *
 * L'original reste ouvert : promouvoir n'est pas deplacer. Un incident qui
 * revele un probleme reste un incident a traiter pour celui qui l'a signale.
 */
export const promoteSchema = z.object({
  to: itilKindSchema,
  name: z.string().min(1).max(255).optional(),
});
export type Promote = z.infer<typeof promoteSchema>;

export const promotionResultSchema = z.object({
  kind: itilKindSchema,
  id: z.number().int().positive(),
});
export type PromotionResult = z.infer<typeof promotionResultSchema>;
