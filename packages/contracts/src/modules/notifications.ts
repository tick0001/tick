import { z } from 'zod';
import { localeSchema } from './common.js';

/**
 * Roles de destinataires.
 *
 * Un destinataire n'est pas une adresse mais un role, resolu au moment de
 * l'envoi. `fixed` est la seule exception, et porte donc une adresse.
 */
export const notificationTargetSchema = z.enum([
  'requester',
  'observer',
  'assigned',
  'assigned_group',
  'assigned_group_manager',
  'requester_group',
  'requester_group_manager',
  'author',
  'followup_author',
  'fixed',
]);
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

export const notificationStateSchema = z.enum(['pending', 'sent', 'failed', 'cancelled']);
export type NotificationState = z.infer<typeof notificationStateSchema>;

/** Evenement notifiable, libelle deja traduit par le serveur. */
export const notificationEventSchema = z.object({
  name: z.string(),
  label: z.string(),
});
export type NotificationEvent = z.infer<typeof notificationEventSchema>;

export const notificationTranslationSchema = z.object({
  locale: localeSchema,
  subject: z.string().min(1).max(300),
  bodyText: z.string().min(1).max(20_000),
  bodyHtml: z.string().max(50_000).nullish(),
});
export type NotificationTranslation = z.infer<typeof notificationTranslationSchema>;

export const notificationTargetEntrySchema = z.object({
  target: notificationTargetSchema,
  /** Adresse du role `fixed`, ignoree pour les autres. */
  address: z.string().email().max(200).nullish(),
});
export type NotificationTargetEntry = z.infer<typeof notificationTargetEntrySchema>;

export const notificationTemplateSchema = z.object({
  id: z.number().int().positive(),
  event: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  entityId: z.number().int(),
  entityName: z.string(),
  isRecursive: z.boolean(),
  targets: z.array(notificationTargetEntrySchema),
  translations: z.array(notificationTranslationSchema),
});
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

export const upsertNotificationTemplateSchema = z.object({
  event: z.string().min(1).max(120),
  name: z.string().min(1).max(120),
  isActive: z.boolean().default(true),
  isRecursive: z.boolean().default(true),
  targets: z.array(notificationTargetEntrySchema).min(1).max(10),
  /**
   * Au moins une traduction : un modele sans texte ne produit rien, et le
   * decouvrir a l'envoi coute une notification manquee.
   */
  translations: z.array(notificationTranslationSchema).min(1).max(10),
});
export type UpsertNotificationTemplate = z.infer<typeof upsertNotificationTemplateSchema>;

/** Une ligne de la file d'envoi, telle que l'ecran d'administration l'affiche. */
export const notificationQueueEntrySchema = z.object({
  id: z.number().int().positive(),
  event: z.string(),
  itemType: z.string().nullable(),
  itemId: z.number().int().nullable(),
  recipientEmail: z.string(),
  subject: z.string(),
  state: notificationStateSchema,
  attempts: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  sentAt: z.string().nullable(),
});
export type NotificationQueueEntry = z.infer<typeof notificationQueueEntrySchema>;

/**
 * Filtre de la file d'envoi.
 *
 * Il vient d'une chaîne de requête, où tout arrive en texte : `z.number()` y
 * refuserait `?limit=10` avec une 400, et l'écran ne pourrait jamais dépasser
 * la première page. Le défaut est silencieux tant que personne n'envoie ces
 * paramètres — la pagination existe alors sans fonctionner.
 */
export const notificationQueueFilterSchema = z.object({
  state: notificationStateSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});
export type NotificationQueueFilter = z.infer<typeof notificationQueueFilterSchema>;

/** Preference d'un utilisateur pour un evenement donne. */
export const notificationPreferenceSchema = z.object({
  event: z.string(),
  label: z.string(),
  enabled: z.boolean(),
});
export type NotificationPreference = z.infer<typeof notificationPreferenceSchema>;

export const setNotificationPreferenceSchema = z.object({
  event: z.string().min(1).max(120),
  enabled: z.boolean(),
});
export type SetNotificationPreference = z.infer<typeof setNotificationPreferenceSchema>;
