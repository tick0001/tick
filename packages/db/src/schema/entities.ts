import { relations } from 'drizzle-orm';
import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';

/**
 * Arbre des entites : l'unite d'organisation du produit.
 *
 * `path` est le chemin materialise, unique et indexe en GIST. Deplacer un
 * sous-arbre se resume a une mise a jour de prefixe, et toute question de
 * visibilite descendante devient un `<@` indexe.
 */
export const entities = pgTable(
  'entities',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    parentId: bigint('parent_id', { mode: 'number' }),
    path: ltree('path').notNull(),
    name: text('name').notNull(),
    /** Chemin lisible complet, recalcule avec le path : « Racine > Filiale Nord > Site A ». */
    completeName: text('complete_name').notNull(),
    level: integer('level').notNull().default(0),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: 'entities_parent_fk' }),
    uniqueIndex('entities_path_key').on(t.path),
    index('entities_path_gist').using('gist', t.path),
    index('entities_parent_idx').on(t.parentId),
  ],
);

/**
 * Configuration par entite. Une colonne nulle signifie « heriter du parent » :
 * la resolution remonte l'arbre jusqu'a la premiere valeur explicite.
 */
export const entitySettings = pgTable('entity_settings', {
  entityId: bigint('entity_id', { mode: 'number' })
    .primaryKey()
    .references(() => entities.id, { onDelete: 'cascade' }),
  autoCloseDelayDays: integer('auto_close_delay_days'),
  autoPurgeDelayDays: integer('auto_purge_delay_days'),
  mailFrom: text('mail_from'),
  mailReplyTo: text('mail_reply_to'),
  defaultLocale: text('default_locale'),
  /** Matrice urgence x impact vers priorite, propre a l'entite. */
  priorityMatrix: jsonb('priority_matrix'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  parent: one(entities, {
    fields: [entities.parentId],
    references: [entities.id],
    relationName: 'entityParent',
  }),
  children: many(entities, { relationName: 'entityParent' }),
  settings: one(entitySettings, {
    fields: [entities.id],
    references: [entitySettings.entityId],
  }),
}));
