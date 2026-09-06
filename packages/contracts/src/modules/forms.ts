import { z } from 'zod';
import { ruleOperatorSchema } from './slm.js';

export const formQuestionKindSchema = z.enum([
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'user',
  'group',
  'location',
  'category',
  'urgency',
]);
export type FormQuestionKind = z.infer<typeof formQuestionKindSchema>;

export const formTargetTypeSchema = z.enum(['profile', 'group', 'user']);
export type FormTargetType = z.infer<typeof formTargetTypeSchema>;

export const formDestinationKindSchema = z.enum(['ticket', 'problem', 'change']);
export type FormDestinationKind = z.infer<typeof formDestinationKindSchema>;

/** Condition d'affichage d'une question. */
export const formConditionSchema = z.object({
  /** Question dont depend l'affichage, designee par son rang dans le formulaire. */
  dependsOn: z.number().int().nonnegative(),
  operator: ruleOperatorSchema,
  value: z.string().max(500).nullish(),
});
export type FormCondition = z.infer<typeof formConditionSchema>;

export const formQuestionSchema = z.object({
  id: z.number().int().positive().optional(),
  kind: formQuestionKindSchema,
  label: z.string().min(1).max(255),
  description: z.string().max(2000).nullish(),
  isRequired: z.boolean().default(false),
  options: z.array(z.string().max(200)).max(100).default([]),
  defaultValue: z.string().max(500).nullish(),
  conditions: z.array(formConditionSchema).max(10).default([]),
});
export type FormQuestion = z.infer<typeof formQuestionSchema>;

export const formSectionSchema = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  questions: z.array(formQuestionSchema).max(100).default([]),
});
export type FormSection = z.infer<typeof formSectionSchema>;

/**
 * Correspondance entre une reponse et un champ de l'objet cree.
 *
 * Explicite : deviner qu'une question intitulee « Urgence » alimente l'urgence
 * marcherait jusqu'au premier formulaire traduit.
 */
export const formMappingSchema = z.object({
  field: z.string().min(1).max(60),
  /** Reponse a une question, designee par son rang, ou valeur fixe. */
  source: z.enum(['question', 'literal']),
  question: z.number().int().nonnegative().nullish(),
  value: z.string().max(500).nullish(),
});
export type FormMapping = z.infer<typeof formMappingSchema>;

export const formDestinationSchema = z.object({
  kind: formDestinationKindSchema.default('ticket'),
  mappings: z.array(formMappingSchema).max(30).default([]),
});
export type FormDestination = z.infer<typeof formDestinationSchema>;

export const formSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
  isActive: z.boolean(),
  ranking: z.number().int(),
  entityId: z.number().int(),
  entityName: z.string(),
  isRecursive: z.boolean(),
  sections: z.array(formSectionSchema),
  access: z.array(z.object({ targetType: formTargetTypeSchema, targetId: z.number().int() })),
  destinations: z.array(formDestinationSchema),
});
export type Form = z.infer<typeof formSchema>;

/** Entree du catalogue : ce qu'un demandeur voit avant d'ouvrir le formulaire. */
export const formSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  category: z.string().nullable(),
});
export type FormSummary = z.infer<typeof formSummarySchema>;

export const upsertFormSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  category: z.string().max(120).nullish(),
  isActive: z.boolean().default(true),
  ranking: z.number().int().min(0).max(100_000).default(100),
  isRecursive: z.boolean().default(true),
  sections: z.array(formSectionSchema).min(1).max(20),
  access: z
    .array(z.object({ targetType: formTargetTypeSchema, targetId: z.number().int().positive() }))
    .max(50)
    .default([]),
  destinations: z.array(formDestinationSchema).max(3).default([]),
});
export type UpsertForm = z.infer<typeof upsertFormSchema>;

/**
 * Reponses soumises, indexees par rang de question.
 *
 * Le rang plutot que l'identifiant : le formulaire servi et le formulaire
 * soumis sont la meme structure, et l'interface n'a pas a connaitre les
 * identifiants de base pour repondre.
 */
export const submitFormSchema = z.object({
  answers: z.record(z.string(), z.union([z.string(), z.array(z.string()), z.null()])),
});
export type SubmitForm = z.infer<typeof submitFormSchema>;

export const formSubmissionResultSchema = z.object({
  submissionId: z.number().int().positive(),
  ticketId: z.number().int().positive().nullable(),
});
export type FormSubmissionResult = z.infer<typeof formSubmissionResultSchema>;
