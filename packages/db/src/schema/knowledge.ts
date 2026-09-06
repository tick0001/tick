import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
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

/** Colonnes communes a tout objet de configuration rattache a une entite. */
const scopeColumns = {
  entityId: bigint('entity_id', { mode: 'number' })
    .notNull()
    .references(() => entities.id),
  entityPath: ltree('entity_path').notNull(),
  isRecursive: boolean('is_recursive').notNull().default(true),
};

/**
 * Catégories d'articles, arborescentes.
 *
 * Séparées des catégories ITIL à dessein : on ne range pas un article de
 * connaissance comme on qualifie un incident. Les confondre obligerait à
 * choisir entre une arborescence utile aux techniciens et une arborescence
 * lisible par les demandeurs.
 */
export const kbCategories = pgTable(
  'kb_categories',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    parentId: bigint('parent_id', { mode: 'number' }),
    path: ltree('path').notNull(),
    ...scopeColumns,
    name: text('name').notNull(),
    completeName: text('complete_name').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: 'kb_categories_parent_fk' }),
    index('kb_categories_path_gist').using('gist', t.path),
    index('kb_categories_entity_path_gist').using('gist', t.entityPath),
  ],
);

/**
 * Article de connaissance.
 *
 * `isFaq` n'est pas un simple classement : il **publie**. Un article marqué
 * ainsi devient lisible sans compte, par quiconque a l'adresse. C'est la
 * décision explicite qu'un article destiné au grand public doit demander, et
 * la raison pour laquelle elle ne se déduit pas de la catégorie.
 */
export const kbArticles = pgTable(
  'kb_articles',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    categoryId: bigint('category_id', { mode: 'number' }).references(() => kbCategories.id),
    name: text('name').notNull(),
    content: text('content').notNull().default(''),
    /** Publié dans la FAQ publique, accessible sans authentification. */
    isFaq: boolean('is_faq').notNull().default(false),
    /** Un brouillon reste invisible de tous sauf de son auteur. */
    isPublished: boolean('is_published').notNull().default(true),
    /** Nombre de consultations, pour distinguer l'utile de l'oublié. */
    viewCount: integer('view_count').notNull().default(0),
    /** Version courante, incrémentée à chaque révision enregistrée. */
    version: integer('version').notNull().default(1),
    authorId: bigint('author_id', { mode: 'number' }).references(() => users.id),
    updatedById: bigint('updated_by_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('kb_articles_entity_path_gist').using('gist', t.entityPath),
    index('kb_articles_category_idx').on(t.categoryId),
    // La FAQ publique interroge cet index a chaque visite anonyme.
    index('kb_articles_faq_idx').on(t.isFaq, t.isPublished),
  ],
);

/**
 * Révisions successives.
 *
 * Conservées entières plutôt qu'en différentiel : un article de connaissance se
 * relit, et pouvoir répondre à « qu'est-ce que cet article disait le mois
 * dernier » vaut largement les quelques kilo-octets épargnés.
 */
export const kbArticleRevisions = pgTable(
  'kb_article_revisions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    articleId: bigint('article_id', { mode: 'number' })
      .notNull()
      .references(() => kbArticles.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    content: text('content').notNull(),
    authorId: bigint('author_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('kb_article_revisions_key').on(t.articleId, t.version)],
);

/** Nature d'une cible de visibilité. */
export const kbTargetTypeEnum = pgEnum('kb_target_type', ['profile', 'group', 'user']);

/**
 * Ciblage fin de la visibilité.
 *
 * L'entité est déjà tranchée par le Row-Level Security ; ce qui se joue ici est
 * plus fin — un article réservé aux techniciens, ou à un groupe. **Aucune
 * cible signifie « tout le monde dans le périmètre »** : exiger une cible
 * rendrait la publication d'un article ordinaire inutilement cérémonieuse.
 */
export const kbArticleTargets = pgTable(
  'kb_article_targets',
  {
    articleId: bigint('article_id', { mode: 'number' })
      .notNull()
      .references(() => kbArticles.id, { onDelete: 'cascade' }),
    targetType: kbTargetTypeEnum('target_type').notNull(),
    targetId: bigint('target_id', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.articleId, t.targetType, t.targetId] })],
);

/** Articles épinglés par un utilisateur. */
export const kbFavorites = pgTable(
  'kb_favorites',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    articleId: bigint('article_id', { mode: 'number' })
      .notNull()
      .references(() => kbArticles.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.articleId] })],
);

export const kbArticlesRelations = relations(kbArticles, ({ many, one }) => ({
  revisions: many(kbArticleRevisions),
  targets: many(kbArticleTargets),
  category: one(kbCategories, {
    fields: [kbArticles.categoryId],
    references: [kbCategories.id],
  }),
  author: one(users, { fields: [kbArticles.authorId], references: [users.id] }),
}));

export const kbArticleTargetsRelations = relations(kbArticleTargets, ({ one }) => ({
  article: one(kbArticles, {
    fields: [kbArticleTargets.articleId],
    references: [kbArticles.id],
  }),
}));
