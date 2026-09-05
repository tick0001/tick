import { z } from 'zod';

// --- Calendriers -------------------------------------------------------------

export const calendarSegmentSchema = z.object({
  /** 0 = dimanche, conformement a `Date.getDay()`. */
  weekday: z.number().int().min(0).max(6),
  beginAt: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  endAt: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
});
export type CalendarSegment = z.infer<typeof calendarSegmentSchema>;

export const holidaySchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(120),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  isPerpetual: z.boolean().default(false),
});
export type Holiday = z.infer<typeof holidaySchema>;

export const calendarSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  comment: z.string().nullable(),
  timezone: z.string(),
  entityId: z.number().int(),
  entityName: z.string(),
  isRecursive: z.boolean(),
  segments: z.array(calendarSegmentSchema),
  holidays: z.array(holidaySchema),
});
export type Calendar = z.infer<typeof calendarSchema>;

export const upsertCalendarSchema = z.object({
  name: z.string().min(1).max(120),
  comment: z.string().max(2000).nullish(),
  /** Fuseau IANA. Verifie par le serveur contre les fuseaux connus. */
  timezone: z.string().min(1).max(64).default('Europe/Paris'),
  isRecursive: z.boolean().default(true),
  segments: z.array(calendarSegmentSchema).max(70).default([]),
  holidays: z.array(holidaySchema).max(200).default([]),
});
export type UpsertCalendar = z.infer<typeof upsertCalendarSchema>;

// --- Engagements -------------------------------------------------------------

export const agreementKindSchema = z.enum(['sla', 'ola']);
export type AgreementKind = z.infer<typeof agreementKindSchema>;

export const agreementAxisSchema = z.enum(['tto', 'ttr']);
export type AgreementAxis = z.infer<typeof agreementAxisSchema>;

export const escalationActionSchema = z.enum([
  'set_priority',
  'set_urgency',
  'assign_group',
  'assign_user',
  'add_observer',
  'notify',
]);
export type EscalationAction = z.infer<typeof escalationActionSchema>;

export const agreementLevelSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(120),
  /** Decalage par rapport a l'echeance : negatif avant, positif apres. */
  offsetSeconds: z.number().int().min(-31_536_000).max(31_536_000),
  isActive: z.boolean().default(true),
  actions: z
    .array(
      z.object({
        action: escalationActionSchema,
        value: z.string().max(200).nullish(),
      }),
    )
    .max(20)
    .default([]),
});
export type AgreementLevel = z.infer<typeof agreementLevelSchema>;

export const agreementSchema = z.object({
  id: z.number().int().positive(),
  kind: agreementKindSchema,
  axis: agreementAxisSchema,
  name: z.string(),
  comment: z.string().nullable(),
  duration: z.number().int().positive(),
  calendarId: z.number().int().nullable(),
  calendarName: z.string().nullable(),
  entityId: z.number().int(),
  entityName: z.string(),
  isRecursive: z.boolean(),
  levels: z.array(agreementLevelSchema),
});
export type Agreement = z.infer<typeof agreementSchema>;

export const upsertAgreementSchema = z.object({
  kind: agreementKindSchema.default('sla'),
  axis: agreementAxisSchema.default('ttr'),
  name: z.string().min(1).max(120),
  comment: z.string().max(2000).nullish(),
  /** Duree en secondes ouvrees. Un an au plus, ce qui reste genereux. */
  duration: z.number().int().positive().max(31_536_000),
  calendarId: z.number().int().positive().nullish(),
  isRecursive: z.boolean().default(true),
  levels: z.array(agreementLevelSchema).max(20).default([]),
});
export type UpsertAgreement = z.infer<typeof upsertAgreementSchema>;

/** Etat d'un engagement sur un ticket, tel que la fiche l'affiche. */
export const ticketAgreementSchema = z.object({
  axis: agreementAxisSchema,
  kind: agreementKindSchema,
  agreementId: z.number().int(),
  name: z.string(),
  dueAt: z.string(),
  /** Vrai des que l'echeance est depassee sans que l'axe soit satisfait. */
  isBreached: z.boolean(),
  /** Secondes ouvrees restantes, negatif si l'echeance est passee. */
  remainingSeconds: z.number().int(),
});
export type TicketAgreement = z.infer<typeof ticketAgreementSchema>;

// --- Regles ------------------------------------------------------------------

export const ruleCollectionSchema = z.enum([
  'ticket.create',
  'ticket.update',
  'authorization.assign',
  'entity.assign',
  'dictionary.ticket',
]);
export type RuleCollection = z.infer<typeof ruleCollectionSchema>;

export const ruleOperatorSchema = z.enum([
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'regex',
  'not_regex',
  'under',
  'not_under',
  'is_empty',
  'is_not_empty',
]);
export type RuleOperator = z.infer<typeof ruleOperatorSchema>;

export const ruleActionTypeSchema = z.enum(['assign', 'append', 'regex_result', 'clear']);
export type RuleActionType = z.infer<typeof ruleActionTypeSchema>;

export const ruleFieldTypeSchema = z.enum([
  'text',
  'number',
  'enum',
  'boolean',
  'tree',
  'reference',
]);
export type RuleFieldType = z.infer<typeof ruleFieldTypeSchema>;

/** Champ disponible dans une collection, decrit pour l'interface. */
export const ruleFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: ruleFieldTypeSchema,
  /** Utilisable en critere, et avec quels operateurs. */
  operators: z.array(ruleOperatorSchema),
  /** Utilisable en action, et avec quels types d'action. */
  actions: z.array(ruleActionTypeSchema),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});
export type RuleField = z.infer<typeof ruleFieldSchema>;

export const ruleCriterionSchema = z.object({
  field: z.string().min(1).max(120),
  operator: ruleOperatorSchema,
  value: z.string().max(500).nullish(),
});
export type RuleCriterion = z.infer<typeof ruleCriterionSchema>;

export const ruleActionSchema = z.object({
  field: z.string().min(1).max(120),
  action: ruleActionTypeSchema.default('assign'),
  value: z.string().max(500).nullish(),
});
export type RuleAction = z.infer<typeof ruleActionSchema>;

export const ruleSchema = z.object({
  id: z.number().int().positive(),
  collection: ruleCollectionSchema,
  name: z.string(),
  description: z.string().nullable(),
  ranking: z.number().int(),
  isActive: z.boolean(),
  matchAll: z.boolean(),
  stopAfter: z.boolean(),
  entityId: z.number().int(),
  entityName: z.string(),
  isRecursive: z.boolean(),
  criteria: z.array(ruleCriterionSchema),
  actions: z.array(ruleActionSchema),
});
export type Rule = z.infer<typeof ruleSchema>;

export const upsertRuleSchema = z.object({
  collection: ruleCollectionSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullish(),
  ranking: z.number().int().min(0).max(100_000).default(100),
  isActive: z.boolean().default(true),
  matchAll: z.boolean().default(true),
  stopAfter: z.boolean().default(false),
  isRecursive: z.boolean().default(true),
  criteria: z.array(ruleCriterionSchema).max(30).default([]),
  actions: z.array(ruleActionSchema).max(30).default([]),
});
export type UpsertRule = z.infer<typeof upsertRuleSchema>;

export const reorderRulesSchema = z.object({
  /** Identifiants dans l'ordre d'evaluation voulu. */
  ids: z.array(z.number().int().positive()).min(1).max(500),
});
export type ReorderRules = z.infer<typeof reorderRulesSchema>;

/**
 * Simulation.
 *
 * Le meme moteur que l'execution reelle, sans ecriture : c'est la seule facon
 * honnete de repondre a « pourquoi ce ticket a-t-il ete affecte la ». Une
 * seconde implementation « d'apercu » finirait par diverger de la vraie.
 */
export const simulateRulesSchema = z.object({
  collection: ruleCollectionSchema,
  /** Valeurs de depart, indexees par cle de champ. */
  input: z.record(z.string(), z.unknown()).default({}),
});
export type SimulateRules = z.infer<typeof simulateRulesSchema>;

export const ruleTraceSchema = z.object({
  ruleId: z.number().int(),
  name: z.string(),
  matched: z.boolean(),
  /** Criteres evalues, avec leur verdict individuel. */
  criteria: z.array(
    z.object({
      field: z.string(),
      operator: ruleOperatorSchema,
      value: z.string().nullable(),
      actual: z.string().nullable(),
      matched: z.boolean(),
    }),
  ),
  /** Champs reellement modifies par la regle. */
  applied: z.array(z.object({ field: z.string(), value: z.string().nullable() })),
  stopped: z.boolean(),
});
export type RuleTrace = z.infer<typeof ruleTraceSchema>;

export const simulationResultSchema = z.object({
  output: z.record(z.string(), z.unknown()),
  traces: z.array(ruleTraceSchema),
});
export type SimulationResult = z.infer<typeof simulationResultSchema>;
