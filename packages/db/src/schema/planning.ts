import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { users } from './users.js';
import { ticketTemplates } from './itil-tickets.js';

/** Colonnes communes a tout objet rattache a une entite. */
const scopeColumns = {
  entityId: bigint('entity_id', { mode: 'number' })
    .notNull()
    .references(() => entities.id),
  entityPath: ltree('entity_path').notNull(),
};

/**
 * Périodicité d'un ticket récurrent.
 *
 * Trois pas seulement, combinés à un intervalle : « toutes les deux semaines »
 * s'écrit `weekly` × 2. Une expression cron serait plus expressive et
 * illisible pour celui qui la configure — et personne n'a jamais eu besoin
 * d'un ticket récurrent « le troisième mardi ouvré ».
 */
export const recurrenceStepEnum = pgEnum('recurrence_step', ['daily', 'weekly', 'monthly']);

/**
 * Tickets récurrents.
 *
 * Le gabarit porte le contenu, cette table porte le calendrier. Les séparer
 * permet d'utiliser le même gabarit pour une création manuelle et pour une
 * génération automatique, sans le dupliquer.
 */
export const recurringTickets = pgTable(
  'recurring_tickets',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    name: text('name').notNull(),
    /**
     * Description reportee sur chaque ticket produit.
     *
     * Portee par la recurrence et non par le gabarit : le gabarit dit comment
     * un ticket est fait, la recurrence dit ce qu'il y a a faire cette fois-ci.
     */
    content: text('content').notNull().default(''),
    isActive: boolean('is_active').notNull().default(true),
    templateId: bigint('template_id', { mode: 'number' })
      .notNull()
      .references(() => ticketTemplates.id),

    step: recurrenceStepEnum('step').notNull().default('weekly'),
    /** Nombre de pas entre deux occurrences. `2` avec `weekly` : une quinzaine. */
    interval: integer('interval').notNull().default(1),
    beginAt: timestamp('begin_at', { withTimezone: true }).notNull(),
    /** Nulle : la récurrence ne s'arrête pas d'elle-même. */
    endAt: timestamp('end_at', { withTimezone: true }),
    /**
     * Avance de création, en minutes.
     *
     * Un ticket d'intervention pour lundi 8 h doit exister le vendredi, sinon
     * personne ne l'a préparé. C'est la seule raison d'être de ce champ.
     */
    createAheadMinutes: integer('create_ahead_minutes').notNull().default(0),

    /** Prochaine occurrence due. Piloté par la base, donc résistant au redémarrage. */
    nextOccurrenceAt: timestamp('next_occurrence_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),

    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('recurring_tickets_entity_path_gist').using('gist', t.entityPath),
    index('recurring_tickets_due_idx').on(t.nextOccurrenceAt),
  ],
);

/**
 * Trace des occurrences générées.
 *
 * L'index unique est le verrou : deux instances de l'API qui balayent en même
 * temps ne peuvent pas produire deux fois le même ticket, et un redémarrage au
 * milieu d'un cycle ne rejoue rien.
 */
export const recurrenceRuns = pgTable(
  'recurrence_runs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    recurringId: bigint('recurring_id', { mode: 'number' })
      .notNull()
      .references(() => recurringTickets.id, { onDelete: 'cascade' }),
    occurrenceAt: timestamp('occurrence_at', { withTimezone: true }).notNull(),
    ticketId: bigint('ticket_id', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('recurrence_runs_unique').on(t.recurringId, t.occurrenceAt)],
);

/**
 * Indisponibilités.
 *
 * Elles vivent à côté des tâches plutôt que dedans : une absence n'est pas une
 * tâche, elle n'a ni ticket ni durée facturée, et la ranger dans `itil_tasks`
 * l'aurait fait apparaître dans la chronologie d'un objet qu'elle ne concerne
 * pas. Le planning les superpose, et la détection de conflits les compte.
 */
export const unavailabilities = pgTable(
  'unavailabilities',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id),
    beginAt: timestamp('begin_at', { withTimezone: true }).notNull(),
    endAt: timestamp('end_at', { withTimezone: true }).notNull(),
    reason: text('reason').notNull().default(''),
    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('unavailabilities_user_idx').on(t.userId, t.beginAt),
    index('unavailabilities_entity_path_gist').using('gist', t.entityPath),
  ],
);

/**
 * Tableaux de bord.
 *
 * Composables : un tableau de bord n'est qu'une liste de widgets ordonnés. La
 * configuration de chaque widget est en JSON parce que les plugins en déclarent
 * de nouveaux, dont le cœur ne peut pas connaître les champs à l'avance.
 */
export const dashboards = pgTable(
  'dashboards',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    isRecursive: boolean('is_recursive').notNull().default(false),
    name: text('name').notNull(),
    /** Partagé avec tout le périmètre, par opposition au tableau personnel. */
    isPublic: boolean('is_public').notNull().default(false),
    ownerId: bigint('owner_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('dashboards_entity_path_gist').using('gist', t.entityPath)],
);

export const dashboardWidgets = pgTable(
  'dashboard_widgets',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    dashboardId: bigint('dashboard_id', { mode: 'number' })
      .notNull()
      .references(() => dashboards.id, { onDelete: 'cascade' }),
    /** Clé du widget : `core.counts`, ou `<plugin>.<clé>` pour une extension. */
    kind: text('kind').notNull(),
    title: text('title').notNull().default(''),
    position: integer('position').notNull().default(0),
    /** Largeur en douzièmes, comme une grille. */
    width: integer('width').notNull().default(6),
    config: jsonb('config').notNull().default({}),
  },
  (t) => [index('dashboard_widgets_dashboard_idx').on(t.dashboardId, t.position)],
);

export const recurringTicketsRelations = relations(recurringTickets, ({ one, many }) => ({
  entity: one(entities, { fields: [recurringTickets.entityId], references: [entities.id] }),
  template: one(ticketTemplates, {
    fields: [recurringTickets.templateId],
    references: [ticketTemplates.id],
  }),
  runs: many(recurrenceRuns),
}));

export const recurrenceRunsRelations = relations(recurrenceRuns, ({ one }) => ({
  recurring: one(recurringTickets, {
    fields: [recurrenceRuns.recurringId],
    references: [recurringTickets.id],
  }),
}));

export const unavailabilitiesRelations = relations(unavailabilities, ({ one }) => ({
  user: one(users, { fields: [unavailabilities.userId], references: [users.id] }),
  entity: one(entities, { fields: [unavailabilities.entityId], references: [entities.id] }),
}));

export const dashboardsRelations = relations(dashboards, ({ one, many }) => ({
  entity: one(entities, { fields: [dashboards.entityId], references: [entities.id] }),
  owner: one(users, { fields: [dashboards.ownerId], references: [users.id] }),
  widgets: many(dashboardWidgets),
}));

export const dashboardWidgetsRelations = relations(dashboardWidgets, ({ one }) => ({
  dashboard: one(dashboards, {
    fields: [dashboardWidgets.dashboardId],
    references: [dashboards.id],
  }),
}));
