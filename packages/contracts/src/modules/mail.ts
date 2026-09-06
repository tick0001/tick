import { z } from 'zod';

export const mailAfterReadSchema = z.enum(['delete', 'flag', 'move']);
export type MailAfterRead = z.infer<typeof mailAfterReadSchema>;

export const mailActionSchema = z.enum(['ticket', 'followup', 'ignored', 'refused', 'error']);
export type MailAction = z.infer<typeof mailActionSchema>;

/** Boite relevee par le collecteur entrant. */
export const mailCollectorSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  host: z.string(),
  port: z.number().int(),
  useTls: z.boolean(),
  login: z.string(),
  folder: z.string(),
  afterRead: mailAfterReadSchema,
  targetFolder: z.string().nullable(),
  isActive: z.boolean(),
  entityId: z.number().int(),
  entityName: z.string(),
  profileId: z.number().int(),
  requestSourceId: z.number().int().nullable(),
  createUnknownRequester: z.boolean(),
  maxPerRun: z.number().int(),
  lastRunAt: z.string().nullable(),
  lastError: z.string().nullable(),
  /** Le mot de passe n'est jamais renvoye : seule sa presence l'est. */
  hasPassword: z.boolean(),
});
export type MailCollector = z.infer<typeof mailCollectorSchema>;

export const upsertMailCollectorSchema = z.object({
  name: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65_535).default(993),
  useTls: z.boolean().default(true),
  login: z.string().min(1).max(255),
  /**
   * Absent a la modification : le laisser vide conserve le mot de passe en
   * place, plutot que de le remplacer par du vide sur une simple correction de
   * libelle.
   */
  password: z.string().max(255).optional(),
  folder: z.string().min(1).max(255).default('INBOX'),
  afterRead: mailAfterReadSchema.default('flag'),
  targetFolder: z.string().max(255).nullish(),
  isActive: z.boolean().default(true),
  profileId: z.number().int().positive(),
  requestSourceId: z.number().int().positive().nullish(),
  createUnknownRequester: z.boolean().default(false),
  maxPerRun: z.number().int().min(1).max(500).default(50),
});
export type UpsertMailCollector = z.infer<typeof upsertMailCollectorSchema>;

/** Trace de ce que le collecteur a fait d'un message. */
export const mailCollectorLogSchema = z.object({
  id: z.number().int().positive(),
  collectorId: z.number().int(),
  messageId: z.string().nullable(),
  sender: z.string().nullable(),
  subject: z.string().nullable(),
  action: mailActionSchema,
  ticketId: z.number().int().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
});
export type MailCollectorLog = z.infer<typeof mailCollectorLogSchema>;
