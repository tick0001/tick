import { relations } from 'drizzle-orm';
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { itilStatusEnum, validationStateEnum } from './itil-enums.js';
import { itilCategories, locations } from './itil-referentials.js';
import { users } from './users.js';

/**
 * Problèmes et changements.
 *
 * Trois tables distinctes — `tickets`, `problems`, `changes` — plutôt qu'une
 * table unique discriminée. Les colonnes communes se répètent, et c'est le prix
 * assumé : les index, les politiques de sécurité et les droits d'une table
 * fourre-tout deviendraient illisibles, et chaque requête traînerait un filtre
 * de type que rien ne garantit.
 *
 * Les satellites, eux, sont bien partagés : `itil_actors`, `itil_followups`,
 * `itil_tasks`, `itil_solutions`, `itil_validations`, `itil_costs` et
 * `itil_links` sont polymorphes sur `itil_type`. C'est là que la mutualisation
 * paie, parce que le comportement y est réellement identique.
 */

/** Colonnes communes a tout objet ITIL rattache a une entite. */
const scopeColumns = {
  entityId: bigint('entity_id', { mode: 'number' })
    .notNull()
    .references(() => entities.id),
  entityPath: ltree('entity_path').notNull(),
};

/** Colonnes de cycle de vie, identiques a celles du ticket. */
const lifecycleColumns = {
  status: itilStatusEnum('status').notNull().default('new'),
  name: text('name').notNull(),
  content: text('content').notNull().default(''),
  urgency: integer('urgency').notNull().default(3),
  impact: integer('impact').notNull().default(3),
  priority: integer('priority').notNull().default(3),
  categoryId: bigint('category_id', { mode: 'number' }).references(() => itilCategories.id),
  locationId: bigint('location_id', { mode: 'number' }).references(() => locations.id),

  dateOpened: timestamp('date_opened', { withTimezone: true }).notNull().defaultNow(),
  dateDue: timestamp('date_due', { withTimezone: true }),
  dateTakenIntoAccount: timestamp('date_taken_into_account', { withTimezone: true }),
  dateSolved: timestamp('date_solved', { withTimezone: true }),
  dateClosed: timestamp('date_closed', { withTimezone: true }),

  takeIntoAccountDelay: integer('take_into_account_delay'),
  solveDelay: integer('solve_delay'),
  closeDelay: integer('close_delay'),
  waitingDuration: integer('waiting_duration').notNull().default(0),
  waitingSince: timestamp('waiting_since', { withTimezone: true }),
  internalTime: integer('internal_time').notNull().default(0),

  validationStatus: validationStateEnum('validation_status'),

  createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
  updatedById: bigint('updated_by_id', { mode: 'number' }).references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
};

/**
 * Problème.
 *
 * Ce qui le distingue d'un incident tient en trois champs : le symptôme est ce
 * que l'on observe, la cause ce que l'on a fini par comprendre, l'impact ce que
 * cela coûte. Les séparer force la distinction ; les fondre dans la description
 * la ferait disparaître dès le deuxième paragraphe.
 */
export const problems = pgTable(
  'problems',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    ...lifecycleColumns,

    symptoms: text('symptoms'),
    causes: text('causes'),
    impacts: text('impacts'),
  },
  (t) => [
    index('problems_entity_path_gist').using('gist', t.entityPath),
    index('problems_status_date_idx').on(t.status, t.dateOpened.desc()),
    index('problems_category_idx').on(t.categoryId),
  ],
);

/**
 * Changement.
 *
 * Les trois plans ne sont pas de la paperasse : le plan de retour arrière est
 * ce qu'on relit à trois heures du matin quand le déploiement a mal tourné, et
 * il n'a de valeur que s'il a été écrit avant.
 */
export const changes = pgTable(
  'changes',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    ...lifecycleColumns,

    deploymentPlan: text('deployment_plan'),
    rollbackPlan: text('rollback_plan'),
    validationPlan: text('validation_plan'),
    /** Liste de contrôle : tableau de `{ label, done }`. */
    checklist: jsonb('checklist').notNull().default([]),
  },
  (t) => [
    index('changes_entity_path_gist').using('gist', t.entityPath),
    index('changes_status_date_idx').on(t.status, t.dateOpened.desc()),
    index('changes_category_idx').on(t.categoryId),
  ],
);

export const problemsRelations = relations(problems, ({ one }) => ({
  entity: one(entities, { fields: [problems.entityId], references: [entities.id] }),
  category: one(itilCategories, {
    fields: [problems.categoryId],
    references: [itilCategories.id],
  }),
}));

export const changesRelations = relations(changes, ({ one }) => ({
  entity: one(entities, { fields: [changes.entityId], references: [entities.id] }),
  category: one(itilCategories, {
    fields: [changes.categoryId],
    references: [itilCategories.id],
  }),
}));
