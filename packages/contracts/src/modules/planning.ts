import { z } from 'zod';
import { queryBoolean } from './common.js';

// --- Planning ----------------------------------------------------------------

/**
 * Une entrée du planning.
 *
 * Les tâches et les indisponibilités partagent la même forme : le planning les
 * superpose, et les distinguer par deux listes obligerait l'interface à les
 * refusionner pour les afficher — et à réinventer la détection de conflits.
 */
export const planningEntrySchema = z.object({
  kind: z.enum(['task', 'unavailability']),
  id: z.number().int().positive(),
  beginAt: z.string(),
  endAt: z.string(),
  title: z.string(),
  userId: z.number().int().nullable(),
  userName: z.string().nullable(),
  groupId: z.number().int().nullable(),
  groupName: z.string().nullable(),
  /** Objet porteur, absent pour une indisponibilité. */
  itilType: z.enum(['ticket', 'problem', 'change']).nullable(),
  itilId: z.number().int().nullable(),
  state: z.enum(['information', 'todo', 'done']).nullable(),
  /** Identifiants des entrées qui se chevauchent, pour le même technicien. */
  conflicts: z.array(z.number().int()),
});
export type PlanningEntry = z.infer<typeof planningEntrySchema>;

export const planningFilterSchema = z.object({
  from: z.string(),
  to: z.string(),
  technicianId: z.coerce.number().int().positive().optional(),
  groupId: z.coerce.number().int().positive().optional(),
});
export type PlanningFilter = z.infer<typeof planningFilterSchema>;

export const upsertUnavailabilitySchema = z.object({
  userId: z.number().int().positive(),
  beginAt: z.string(),
  endAt: z.string(),
  reason: z.string().max(500).default(''),
});
export type UpsertUnavailability = z.infer<typeof upsertUnavailabilitySchema>;

// --- Tickets récurrents ------------------------------------------------------

export const recurrenceStepSchema = z.enum(['daily', 'weekly', 'monthly']);
export type RecurrenceStep = z.infer<typeof recurrenceStepSchema>;

export const recurringTicketSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  content: z.string(),
  isActive: z.boolean(),
  templateId: z.number().int(),
  templateName: z.string(),
  entityId: z.number().int(),
  entityName: z.string(),
  step: recurrenceStepSchema,
  interval: z.number().int().positive(),
  beginAt: z.string(),
  endAt: z.string().nullable(),
  createAheadMinutes: z.number().int().nonnegative(),
  nextOccurrenceAt: z.string().nullable(),
  lastRunAt: z.string().nullable(),
  /** Nombre d'occurrences déjà produites. */
  runCount: z.number().int().nonnegative(),
});
export type RecurringTicket = z.infer<typeof recurringTicketSchema>;

export const upsertRecurringTicketSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string().max(100_000).default(''),
  isActive: z.boolean().default(true),
  templateId: z.number().int().positive(),
  step: recurrenceStepSchema.default('weekly'),
  interval: z.number().int().min(1).max(365).default(1),
  beginAt: z.string(),
  endAt: z.string().nullish(),
  createAheadMinutes: z.number().int().min(0).max(43_200).default(0),
});
export type UpsertRecurringTicket = z.infer<typeof upsertRecurringTicketSchema>;

export const recurringFilterSchema = z.object({
  active: queryBoolean.optional(),
});
export type RecurringFilter = z.infer<typeof recurringFilterSchema>;
