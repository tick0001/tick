import { relations } from 'drizzle-orm';
import { bigint, boolean, foreignKey, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { groups, users } from './users.js';

/**
 * Referentiels ITIL.
 *
 * Tous sont des **objets de configuration** : ils portent `entity_id`,
 * `entity_path` et `is_recursive`, et suivent donc la regle de visibilite
 * ascendante. Un referentiel defini a la racine avec le drapeau recursif est
 * utilisable partout ; sans lui, il n'existe que pour son entite.
 */

/** Colonnes communes a tout referentiel rattache a une entite. */
const scopeColumns = {
  entityId: bigint('entity_id', { mode: 'number' })
    .notNull()
    .references(() => entities.id),
  entityPath: ltree('entity_path').notNull(),
  isRecursive: boolean('is_recursive').notNull().default(false),
};

const auditColumns = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/**
 * Categories ITIL, arborescentes.
 *
 * Une categorie porte bien plus qu'un libelle : elle peut restreindre les types
 * d'objets auxquels elle s'applique, definir le technicien ou le groupe
 * d'affectation par defaut, et etre masquee de l'interface simplifiee.
 */
export const itilCategories = pgTable(
  'itil_categories',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    parentId: bigint('parent_id', { mode: 'number' }),
    path: ltree('path').notNull(),
    ...scopeColumns,
    name: text('name').notNull(),
    completeName: text('complete_name').notNull(),
    comment: text('comment'),

    /** Visible depuis l'interface simplifiee des demandeurs. */
    isHelpdeskVisible: boolean('is_helpdesk_visible').notNull().default(true),
    /** Types d'objets auxquels la categorie s'applique. */
    forIncident: boolean('for_incident').notNull().default(true),
    forRequest: boolean('for_request').notNull().default(true),
    forProblem: boolean('for_problem').notNull().default(true),
    forChange: boolean('for_change').notNull().default(true),

    /** Affectation par defaut proposee lorsque la categorie est choisie. */
    defaultTechnicianId: bigint('default_technician_id', { mode: 'number' }).references(
      () => users.id,
    ),
    defaultGroupId: bigint('default_group_id', { mode: 'number' }).references(() => groups.id),
    ...auditColumns,
  },
  (t) => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'itil_categories_parent_fk',
    }),
    index('itil_categories_path_gist').using('gist', t.path),
    index('itil_categories_entity_path_gist').using('gist', t.entityPath),
  ],
);

/** Origine de la demande : telephone, courriel, guichet, supervision… */
export const requestSources = pgTable(
  'request_sources',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    name: text('name').notNull(),
    comment: text('comment'),
    isActive: boolean('is_active').notNull().default(true),
    /** Source retenue quand rien n'est precise, notamment par l'API. */
    isDefault: boolean('is_default').notNull().default(false),
    ...auditColumns,
  },
  (t) => [index('request_sources_entity_path_gist').using('gist', t.entityPath)],
);

/** Categories de taches, arborescentes. */
export const taskCategories = pgTable(
  'task_categories',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    parentId: bigint('parent_id', { mode: 'number' }),
    path: ltree('path').notNull(),
    ...scopeColumns,
    name: text('name').notNull(),
    completeName: text('complete_name').notNull(),
    comment: text('comment'),
    ...auditColumns,
  },
  (t) => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'task_categories_parent_fk',
    }),
    index('task_categories_entity_path_gist').using('gist', t.entityPath),
  ],
);

/** Types de solution : contournement, correctif, documentation… */
export const solutionTypes = pgTable(
  'solution_types',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    name: text('name').notNull(),
    comment: text('comment'),
    ...auditColumns,
  },
  (t) => [index('solution_types_entity_path_gist').using('gist', t.entityPath)],
);

/** Lieux, arborescents : site, batiment, etage, salle. */
export const locations = pgTable(
  'locations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    parentId: bigint('parent_id', { mode: 'number' }),
    path: ltree('path').notNull(),
    ...scopeColumns,
    name: text('name').notNull(),
    completeName: text('complete_name').notNull(),
    comment: text('comment'),
    ...auditColumns,
  },
  (t) => [
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: 'locations_parent_fk' }),
    index('locations_entity_path_gist').using('gist', t.entityPath),
  ],
);

/** Fournisseurs, acteurs possibles d'un ticket au meme titre qu'un groupe. */
export const suppliers = pgTable(
  'suppliers',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    comment: text('comment'),
    isActive: boolean('is_active').notNull().default(true),
    ...auditColumns,
  },
  (t) => [index('suppliers_entity_path_gist').using('gist', t.entityPath)],
);

export const itilCategoriesRelations = relations(itilCategories, ({ one, many }) => ({
  entity: one(entities, { fields: [itilCategories.entityId], references: [entities.id] }),
  parent: one(itilCategories, {
    fields: [itilCategories.parentId],
    references: [itilCategories.id],
    relationName: 'itilCategoryParent',
  }),
  children: many(itilCategories, { relationName: 'itilCategoryParent' }),
}));

export const taskCategoriesRelations = relations(taskCategories, ({ one, many }) => ({
  parent: one(taskCategories, {
    fields: [taskCategories.parentId],
    references: [taskCategories.id],
    relationName: 'taskCategoryParent',
  }),
  children: many(taskCategories, { relationName: 'taskCategoryParent' }),
}));

export const locationsRelations = relations(locations, ({ one, many }) => ({
  parent: one(locations, {
    fields: [locations.parentId],
    references: [locations.id],
    relationName: 'locationParent',
  }),
  children: many(locations, { relationName: 'locationParent' }),
}));
