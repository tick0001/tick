import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { users } from './users.js';

/** État d'un envoi dans la file. */
export const notificationStateEnum = pgEnum('notification_state', [
  'pending',
  'sent',
  'failed',
  'cancelled',
]);

/**
 * Destinataires calculés au moment de l'envoi.
 *
 * Un destinataire n'est pas une adresse mais un **rôle** : « le demandeur »
 * désigne quelqu'un de différent d'un ticket à l'autre. Figer des adresses
 * produirait des notifications envoyées aux mauvaises personnes dès qu'un
 * acteur change.
 */
export const notificationTargetEnum = pgEnum('notification_target', [
  'requester',
  'observer',
  'assigned',
  'assigned_group',
  'author',
]);

/** Un modèle par événement métier. */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    isRecursive: boolean('is_recursive').notNull().default(false),
    /** Nom de l'événement du bus : `ticket.created`, `followup.added`… */
    event: text('event').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notification_templates_event_idx').on(t.event, t.isActive),
    index('notification_templates_entity_path_gist').using('gist', t.entityPath),
  ],
);

/**
 * Traductions d'un modèle.
 *
 * Multilingue dès l'origine, et non ajouté après coup : un même événement
 * s'adresse à des personnes de langues différentes dans la même organisation,
 * et rétrofitter la traduction imposerait de reprendre chaque modèle écrit.
 */
export const notificationTemplateTranslations = pgTable(
  'notification_template_translations',
  {
    templateId: bigint('template_id', { mode: 'number' })
      .notNull()
      .references(() => notificationTemplates.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.locale] })],
);

export const notificationTemplateTargets = pgTable(
  'notification_template_targets',
  {
    templateId: bigint('template_id', { mode: 'number' })
      .notNull()
      .references(() => notificationTemplates.id, { onDelete: 'cascade' }),
    target: notificationTargetEnum('target').notNull(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.target] })],
);

/**
 * File d'envoi persistante.
 *
 * Les messages vivent en base et non seulement dans Redis : on doit pouvoir
 * répondre à « ce message est-il parti, et sinon pourquoi », des semaines plus
 * tard. Une file en mémoire ne garde aucune trace d'un échec définitif.
 */
export const notificationQueue = pgTable(
  'notification_queue',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' }).references(() => entities.id),
    entityPath: ltree('entity_path'),
    event: text('event').notNull(),
    /** Objet concerné, pour retrouver les envois d'un ticket. */
    itemType: text('item_type'),
    itemId: bigint('item_id', { mode: 'number' }),
    recipientEmail: text('recipient_email').notNull(),
    recipientUserId: bigint('recipient_user_id', { mode: 'number' }).references(() => users.id),
    locale: text('locale').notNull().default('fr'),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    bodyHtml: text('body_html'),
    state: notificationStateEnum('state').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    index('notification_queue_state_idx').on(t.state, t.createdAt),
    index('notification_queue_item_idx').on(t.itemType, t.itemId),
  ],
);

/** Désactivation d'un événement par un utilisateur. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    enabled: boolean('enabled').notNull().default(true),
  },
  (t) => [primaryKey({ columns: [t.userId, t.event] })],
);

/**
 * Documents attachés.
 *
 * Le contenu est stocké hors base et adressé par son empreinte : deux envois
 * du même fichier ne l'écrivent qu'une fois, et l'empreinte permet de vérifier
 * l'intégrité sans relire l'original.
 */
export const documents = pgTable(
  'documents',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    name: text('name').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(),
    /** SHA-256 du contenu, qui sert aussi de chemin de stockage. */
    checksum: text('checksum').notNull(),
    uploadedById: bigint('uploaded_by_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('documents_checksum_idx').on(t.checksum),
    index('documents_entity_path_gist').using('gist', t.entityPath),
  ],
);

/** Rattachement polymorphe d'un document à un objet. */
export const documentItems = pgTable(
  'document_items',
  {
    documentId: bigint('document_id', { mode: 'number' })
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(),
    itemId: bigint('item_id', { mode: 'number' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.documentId, t.itemType, t.itemId] }),
    uniqueIndex('document_items_item_idx').on(t.itemType, t.itemId, t.documentId),
  ],
);

export const notificationTemplatesRelations = relations(notificationTemplates, ({ many }) => ({
  translations: many(notificationTemplateTranslations),
  targets: many(notificationTemplateTargets),
}));

export const documentsRelations = relations(documents, ({ many, one }) => ({
  items: many(documentItems),
  uploadedBy: one(users, { fields: [documents.uploadedById], references: [users.id] }),
}));
