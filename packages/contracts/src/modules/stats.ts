import { z } from 'zod';

/**
 * Dimensions d'analyse.
 *
 * Liste fermée : chacune correspond à une expression SQL enregistrée côté
 * serveur. Laisser passer un nom de colonne arbitraire aurait transformé ce
 * point d'entrée en interface SQL ouverte.
 */
export const statDimensionSchema = z.enum([
  'entity',
  'category',
  'technician',
  'group',
  'priority',
  'source',
  'status',
  'type',
]);
export type StatDimension = z.infer<typeof statDimensionSchema>;

export const statsFilterSchema = z.object({
  /** Bornes sur la date d'ouverture. Absentes : tout l'historique visible. */
  from: z.string().optional(),
  to: z.string().optional(),
  dimension: statDimensionSchema.default('status'),
});
export type StatsFilter = z.infer<typeof statsFilterSchema>;

/** Indicateurs globaux du périmètre, tels que l'en-tête les affiche. */
export const statsSummarySchema = z.object({
  opened: z.number().int().nonnegative(),
  solved: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  /** Tickets encore ouverts à l'instant de la lecture. */
  pending: z.number().int().nonnegative(),
  /** Secondes, temps calendaire moyen. `null` si aucun ticket ne l'a atteint. */
  averageTakeIntoAccount: z.number().nonnegative().nullable(),
  averageSolve: z.number().nonnegative().nullable(),
  /** Part des échéances tenues, entre 0 et 1. `null` sans engagement applicable. */
  slaCompliance: z.number().min(0).max(1).nullable(),
  /** Note moyenne de satisfaction sur 5. */
  satisfaction: z.number().min(0).max(5).nullable(),
  satisfactionCount: z.number().int().nonnegative(),
});
export type StatsSummary = z.infer<typeof statsSummarySchema>;

export const statsBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  opened: z.number().int().nonnegative(),
  solved: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  averageSolve: z.number().nonnegative().nullable(),
});
export type StatsBucket = z.infer<typeof statsBucketSchema>;

export const statsReportSchema = z.object({
  summary: statsSummarySchema,
  dimension: statDimensionSchema,
  buckets: z.array(statsBucketSchema),
});
export type StatsReport = z.infer<typeof statsReportSchema>;

/** Un point de la courbe d'activité, agrégé par jour. */
export const statsTrendPointSchema = z.object({
  day: z.string(),
  opened: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
});
export type StatsTrendPoint = z.infer<typeof statsTrendPointSchema>;

// --- Tableaux de bord --------------------------------------------------------

/**
 * Widget d'un tableau de bord.
 *
 * `kind` est une clé, pas un type fermé : les plugins en déclarent, et fermer
 * l'énumération ici rendrait le contrat impossible à respecter pour eux.
 */
export const dashboardWidgetSchema = z.object({
  id: z.number().int().positive(),
  kind: z.string(),
  title: z.string(),
  position: z.number().int().nonnegative(),
  width: z.number().int().min(1).max(12),
  config: z.record(z.string(), z.unknown()),
});
export type DashboardWidget = z.infer<typeof dashboardWidgetSchema>;

export const dashboardSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  isPublic: z.boolean(),
  isRecursive: z.boolean(),
  isMine: z.boolean(),
  entityId: z.number().int(),
  entityName: z.string(),
  owner: z.string().nullable(),
  widgets: z.array(dashboardWidgetSchema),
});
export type Dashboard = z.infer<typeof dashboardSchema>;

export const upsertDashboardWidgetSchema = z.object({
  kind: z.string().min(1).max(120),
  title: z.string().max(200).default(''),
  width: z.number().int().min(1).max(12).default(6),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type UpsertDashboardWidget = z.infer<typeof upsertDashboardWidgetSchema>;

export const upsertDashboardSchema = z.object({
  name: z.string().min(1).max(200),
  isPublic: z.boolean().default(false),
  isRecursive: z.boolean().default(false),
  widgets: z.array(upsertDashboardWidgetSchema).max(30).default([]),
});
export type UpsertDashboard = z.infer<typeof upsertDashboardSchema>;

/** Widget proposé à la composition, cœur ou plugin. */
export const widgetCatalogEntrySchema = z.object({
  kind: z.string(),
  label: z.string(),
  description: z.string(),
  pluginId: z.string().optional(),
});
export type WidgetCatalogEntry = z.infer<typeof widgetCatalogEntrySchema>;

// --- Exports et actions massives --------------------------------------------

export const exportFormatSchema = z.enum(['csv', 'pdf']);
export type ExportFormat = z.infer<typeof exportFormatSchema>;

/**
 * Action appliquée à une sélection.
 *
 * Fermée à dessein : une action massive est irréversible à l'échelle de la
 * sélection, et ouvrir la liste reviendrait à exposer une mise à jour de masse
 * sur des champs arbitraires.
 */
export const bulkActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('setStatus'), value: z.string() }),
  /**
   * L'urgence, jamais la priorité : celle-ci est dérivée de l'urgence et de
   * l'impact par la matrice de l'entité. Permettre de la forcer en masse
   * produirait des tickets dont la priorité contredit l'urgence affichée.
   */
  z.object({ action: z.literal('setUrgency'), value: z.number().int().min(1).max(5) }),
  z.object({ action: z.literal('setCategory'), value: z.number().int().positive().nullable() }),
  z.object({ action: z.literal('assignGroup'), value: z.number().int().positive() }),
  z.object({ action: z.literal('assignUser'), value: z.number().int().positive() }),
  z.object({ action: z.literal('delete') }),
]);
export type BulkAction = z.infer<typeof bulkActionSchema>;

export const bulkRequestSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(500),
  operation: bulkActionSchema,
});
export type BulkRequest = z.infer<typeof bulkRequestSchema>;

/**
 * Résultat d'une action massive.
 *
 * Les échecs sont rendus un par un plutôt que résumés : « 3 tickets sur 40 ont
 * échoué » n'aide personne à savoir lesquels reprendre.
 */
export const bulkResultSchema = z.object({
  applied: z.number().int().nonnegative(),
  failures: z.array(z.object({ id: z.number().int(), reason: z.string() })),
});
export type BulkResult = z.infer<typeof bulkResultSchema>;
