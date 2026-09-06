import { z } from 'zod';

export const satisfactionConfigSchema = z.object({
  id: z.number().int().positive(),
  entityId: z.number().int(),
  entityName: z.string(),
  isRecursive: z.boolean(),
  isActive: z.boolean(),
  percentage: z.number().int().min(0).max(100),
  delayDays: z.number().int().min(0).max(365),
  durationDays: z.number().int().min(1).max(365),
  reminderDays: z.number().int().min(1).max(365).nullable(),
});
export type SatisfactionConfig = z.infer<typeof satisfactionConfigSchema>;

export const upsertSatisfactionConfigSchema = z.object({
  isRecursive: z.boolean().default(true),
  isActive: z.boolean().default(false),
  percentage: z.number().int().min(0).max(100).default(30),
  delayDays: z.number().int().min(0).max(365).default(1),
  durationDays: z.number().int().min(1).max(365).default(30),
  reminderDays: z.number().int().min(1).max(365).nullish(),
});
export type UpsertSatisfactionConfig = z.infer<typeof upsertSatisfactionConfigSchema>;

/**
 * Enquete telle que le formulaire public la recoit.
 *
 * Volontairement pauvre : le sujet du ticket et rien d'autre. Le jeton circule
 * dans un courriel, et tout ce qu'il expose devient public de fait.
 */
export const publicSurveySchema = z.object({
  ticketId: z.number().int().positive(),
  ticketName: z.string(),
  closedAt: z.string().nullable(),
  answered: z.boolean(),
  rating: z.number().int().min(1).max(5).nullable(),
  comment: z.string().nullable(),
});
export type PublicSurvey = z.infer<typeof publicSurveySchema>;

export const answerSurveySchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).nullish(),
});
export type AnswerSurvey = z.infer<typeof answerSurveySchema>;

/** Exploitation statistique : ce que l'ecran de pilotage affiche. */
export const satisfactionStatsSchema = z.object({
  requested: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  averageRating: z.number().nullable(),
  distribution: z.array(z.object({ rating: z.number().int(), count: z.number().int() })),
});
export type SatisfactionStats = z.infer<typeof satisfactionStatsSchema>;
