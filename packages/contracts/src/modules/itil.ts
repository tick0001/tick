import { z } from 'zod';
import { queryBoolean } from './common.js';

/** Un ticket est un incident ou une demande de service. */
export const ticketTypeSchema = z.enum(['incident', 'request']);
export type TicketType = z.infer<typeof ticketTypeSchema>;

export const itilStatusSchema = z.enum([
  'new',
  'assigned',
  'planned',
  'waiting',
  'solved',
  'closed',
]);
export type ItilStatus = z.infer<typeof itilStatusSchema>;

/** Statuts considérés comme ouverts, au sens des listes de travail. */
export const OPEN_STATUSES: readonly ItilStatus[] = ['new', 'assigned', 'planned', 'waiting'];

export const actorRoleSchema = z.enum(['requester', 'observer', 'assigned']);
export type ActorRole = z.infer<typeof actorRoleSchema>;

export const actorTypeSchema = z.enum(['user', 'group', 'supplier']);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const followupSourceSchema = z.enum(['interface', 'email', 'phone', 'other']);
export const taskStateSchema = z.enum(['information', 'todo', 'done']);
export const validationStateSchema = z.enum(['waiting', 'granted', 'refused']);
export const solutionStateSchema = z.enum(['proposed', 'accepted', 'refused']);

/**
 * Échelle d'urgence, d'impact et de priorité.
 *
 * De 1 (très basse) à 5 (très haute), comme GLPI. La priorité n'est pas saisie :
 * elle découle de l'urgence et de l'impact par la matrice de l'entité.
 */
export const severitySchema = z.number().int().min(1).max(5);

const referenceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
});

/** Acteur tel qu'il est affiché : la nature détermine ce que `id` désigne. */
export const ticketActorSchema = z.object({
  role: actorRoleSchema,
  actorType: actorTypeSchema,
  actorId: z.number().int().positive(),
  label: z.string(),
  alternativeEmail: z.string().nullable(),
});
export type TicketActor = z.infer<typeof ticketActorSchema>;

export const ticketActorInputSchema = z.object({
  role: actorRoleSchema,
  actorType: actorTypeSchema,
  actorId: z.number().int().positive(),
  alternativeEmail: z.string().email().nullish(),
});
export type TicketActorInput = z.infer<typeof ticketActorInputSchema>;

export const createTicketSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string().max(100_000).default(''),
  type: ticketTypeSchema.default('incident'),
  urgency: severitySchema.default(3),
  impact: severitySchema.default(3),
  categoryId: z.number().int().positive().nullish(),
  requestSourceId: z.number().int().positive().nullish(),
  locationId: z.number().int().positive().nullish(),
  templateId: z.number().int().positive().nullish(),
  /**
   * Acteurs initiaux. Sans demandeur explicite, l'auteur le devient : un ticket
   * sans demandeur n'a personne à qui répondre.
   */
  actors: z.array(ticketActorInputSchema).default([]),
});
export type CreateTicket = z.infer<typeof createTicketSchema>;

export const updateTicketSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  content: z.string().max(100_000).optional(),
  type: ticketTypeSchema.optional(),
  status: itilStatusSchema.optional(),
  urgency: severitySchema.optional(),
  impact: severitySchema.optional(),
  categoryId: z.number().int().positive().nullish(),
  requestSourceId: z.number().int().positive().nullish(),
  locationId: z.number().int().positive().nullish(),
});
export type UpdateTicket = z.infer<typeof updateTicketSchema>;

/** Ligne de liste : le strict nécessaire pour un tableau dense. */
export const ticketSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  type: ticketTypeSchema,
  status: itilStatusSchema,
  urgency: severitySchema,
  impact: severitySchema,
  priority: severitySchema,
  entity: referenceSchema,
  category: referenceSchema.nullable(),
  dateOpened: z.string(),
  dateDue: z.string().nullable(),
  /** Acteurs résumés, pour afficher demandeur et affectation sans requête N+1. */
  requesters: z.array(z.string()),
  assignees: z.array(z.string()),
  followupCount: z.number().int().nonnegative(),
  taskCount: z.number().int().nonnegative(),
});
export type TicketSummary = z.infer<typeof ticketSummarySchema>;

export const ticketDetailSchema = ticketSummarySchema.extend({
  content: z.string(),
  requestSource: referenceSchema.nullable(),
  location: referenceSchema.nullable(),
  dateTakenIntoAccount: z.string().nullable(),
  dateSolved: z.string().nullable(),
  dateClosed: z.string().nullable(),
  internalTime: z.number().int().nonnegative(),
  waitingDuration: z.number().int().nonnegative(),
  validationStatus: validationStateSchema.nullable(),
  actors: z.array(ticketActorSchema),
  createdBy: referenceSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TicketDetail = z.infer<typeof ticketDetailSchema>;

// --- Chronologie -------------------------------------------------------------

const timelineBase = {
  id: z.number().int().positive(),
  at: z.string(),
  author: referenceSchema.nullable(),
};

/**
 * Chronologie unifiée du ticket.
 *
 * Suivis, tâches, solutions, validations et historique dans un seul flux
 * ordonné : c'est ce que l'on lit pour comprendre un ticket, et le découper en
 * onglets séparés oblige à reconstituer l'enchaînement de tête.
 */
export const timelineEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...timelineBase,
    kind: z.literal('followup'),
    content: z.string(),
    isPrivate: z.boolean(),
    source: followupSourceSchema,
  }),
  z.object({
    ...timelineBase,
    kind: z.literal('task'),
    content: z.string(),
    state: taskStateSchema,
    isPrivate: z.boolean(),
    actionTime: z.number().int().nonnegative(),
    beginAt: z.string().nullable(),
    endAt: z.string().nullable(),
    technician: referenceSchema.nullable(),
    group: referenceSchema.nullable(),
    category: referenceSchema.nullable(),
  }),
  z.object({
    ...timelineBase,
    kind: z.literal('solution'),
    content: z.string(),
    status: solutionStateSchema,
    solutionType: referenceSchema.nullable(),
    approvalComment: z.string().nullable(),
  }),
  z.object({
    ...timelineBase,
    kind: z.literal('validation'),
    status: validationStateSchema,
    validator: referenceSchema.nullable(),
    requestComment: z.string().nullable(),
    responseComment: z.string().nullable(),
  }),
  z.object({
    ...timelineBase,
    kind: z.literal('log'),
    field: z.string(),
    oldValue: z.string().nullable(),
    newValue: z.string().nullable(),
  }),
]);
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

// --- Écritures sur la chronologie --------------------------------------------

export const addFollowupSchema = z.object({
  content: z.string().min(1).max(100_000),
  isPrivate: z.boolean().default(false),
  source: followupSourceSchema.default('interface'),
});
export type AddFollowup = z.infer<typeof addFollowupSchema>;

export const addTaskSchema = z.object({
  content: z.string().min(1).max(100_000),
  state: taskStateSchema.default('todo'),
  isPrivate: z.boolean().default(false),
  categoryId: z.number().int().positive().nullish(),
  /** Durée réelle, en minutes. Alimente le temps interne du ticket. */
  actionTime: z
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 30)
    .default(0),
  beginAt: z.string().datetime().nullish(),
  endAt: z.string().datetime().nullish(),
  technicianId: z.number().int().positive().nullish(),
  groupId: z.number().int().positive().nullish(),
});
export type AddTask = z.infer<typeof addTaskSchema>;

export const updateTaskSchema = addTaskSchema.partial();
export type UpdateTask = z.infer<typeof updateTaskSchema>;

export const addSolutionSchema = z.object({
  content: z.string().min(1).max(100_000),
  solutionTypeId: z.number().int().positive().nullish(),
});
export type AddSolution = z.infer<typeof addSolutionSchema>;

export const answerSolutionSchema = z.object({
  accepted: z.boolean(),
  comment: z.string().max(10_000).nullish(),
});
export type AnswerSolution = z.infer<typeof answerSolutionSchema>;

export const requestValidationSchema = z.object({
  validatorType: z.enum(['user', 'group']).default('user'),
  validatorId: z.number().int().positive(),
  comment: z.string().max(10_000).nullish(),
});
export type RequestValidation = z.infer<typeof requestValidationSchema>;

export const answerValidationSchema = z.object({
  granted: z.boolean(),
  comment: z.string().max(10_000).nullish(),
});
export type AnswerValidation = z.infer<typeof answerValidationSchema>;

// --- Listes ------------------------------------------------------------------

/** Liste venant d'une chaîne de requête : `a,b` ou répétition du paramètre. */
function queryList<T extends z.ZodTypeAny>(element: T) {
  return z.preprocess((valeur) => {
    if (typeof valeur === 'string') return valeur.split(',').filter(Boolean);
    return valeur;
  }, z.array(element));
}

export const ticketFilterSchema = z.object({
  status: queryList(itilStatusSchema).optional(),
  type: ticketTypeSchema.optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  priority: queryList(z.coerce.number().int().min(1).max(5)).optional(),
  /** Recherche plein texte sur le titre et la description. */
  search: z.string().max(200).optional(),
  /** Restreint aux tickets où l'utilisateur courant est acteur. */
  mine: queryBoolean.optional(),
  /** Inclut la corbeille au lieu de l'exclure. */
  deleted: queryBoolean.default(false),
  /** Pagination par curseur : l'`OFFSET` s'effondre sur de gros volumes. */
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['dateOpened', 'priority', 'dateDue', 'status']).default('dateOpened'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});
export type TicketFilter = z.infer<typeof ticketFilterSchema>;

export const ticketPageSchema = z.object({
  items: z.array(ticketSummarySchema),
  /** Curseur de la page suivante, nul s'il n'y en a pas. */
  nextCursor: z.string().nullable(),
});
export type TicketPage = z.infer<typeof ticketPageSchema>;

// --- Gabarits ----------------------------------------------------------------

export const templateFieldKindSchema = z.enum(['predefined', 'mandatory', 'hidden']);
export type TemplateFieldKind = z.infer<typeof templateFieldKindSchema>;

/**
 * Gabarit de ticket.
 *
 * Un gabarit ne fige pas un formulaire : il déclare, champ par champ, une
 * valeur préremplie, une obligation, ou un masquage. Les trois natures se
 * combinent — un champ peut être prérempli **et** obligatoire, ce qui revient à
 * proposer une valeur que l'utilisateur peut changer mais pas effacer.
 */
export const ticketTemplateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  comment: z.string().nullable(),
  entity: z.object({ id: z.number().int().positive(), name: z.string() }),
  isRecursive: z.boolean(),
  /** Valeurs préremplies, par nom de champ. */
  predefined: z.record(z.string(), z.unknown()),
  /** Champs dont la saisie est bloquante. */
  mandatory: z.array(z.string()),
  /** Champs retirés du formulaire. */
  hidden: z.array(z.string()),
});
export type TicketTemplate = z.infer<typeof ticketTemplateSchema>;

export const templateFieldInputSchema = z.object({
  field: z.string().min(1).max(64),
  kind: templateFieldKindSchema,
  /** Valeur préremplie, en JSON. Ignorée pour `mandatory` et `hidden`. */
  value: z.unknown().optional(),
});

export const saveTicketTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  comment: z.string().max(2000).nullish(),
  isRecursive: z.boolean().default(false),
  fields: z.array(templateFieldInputSchema).default([]),
});
export type SaveTicketTemplate = z.infer<typeof saveTicketTemplateSchema>;
