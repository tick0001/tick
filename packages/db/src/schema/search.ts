import { relations } from 'drizzle-orm';
import { bigint, boolean, index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { users } from './users.js';

/**
 * Recherches sauvegardées.
 *
 * Une recherche est un arbre de critères, pas une chaîne : elle doit pouvoir
 * être rejouée, modifiée et validée champ par champ. La stocker en texte libre
 * interdirait de vérifier qu'elle ne porte que sur des champs autorisés.
 *
 * Objet de données rattaché à une entité, et non de configuration : une
 * recherche publique n'a de sens que là où elle a été créée.
 */
export const savedSearches = pgTable(
  'saved_searches',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    /** Propriétaire. Une recherche publique reste attribuée à son auteur. */
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Objet visé : `ticket` aujourd'hui, problème et changement demain. */
    target: text('target').notNull().default('ticket'),
    /** Visible des autres utilisateurs du périmètre. */
    isPublic: boolean('is_public').notNull().default(false),
    /** Épinglée dans la barre latérale de son propriétaire. */
    isPinned: boolean('is_pinned').notNull().default(false),
    /** Arbre de critères, validé contre le registre des champs interrogeables. */
    criteria: jsonb('criteria').notNull(),
    /** Colonnes affichées, tri et sens. */
    display: jsonb('display'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('saved_searches_user_idx').on(t.userId, t.target),
    index('saved_searches_entity_path_gist').using('gist', t.entityPath),
  ],
);

export const savedSearchesRelations = relations(savedSearches, ({ one }) => ({
  user: one(users, { fields: [savedSearches.userId], references: [users.id] }),
  entity: one(entities, { fields: [savedSearches.entityId], references: [entities.id] }),
}));
