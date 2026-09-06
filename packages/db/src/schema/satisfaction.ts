import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { tickets } from './itil-tickets.js';

/**
 * Paramétrage des enquêtes, par entité.
 *
 * Objet de configuration, donc soumis à la visibilité ascendante : une
 * organisation règle son taux à la racine, une filiale exigeante le relève chez
 * elle. Sans héritage, il faudrait le redéclarer entité par entité.
 */
export const satisfactionConfigs = pgTable(
  'satisfaction_configs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    isRecursive: boolean('is_recursive').notNull().default(true),
    isActive: boolean('is_active').notNull().default(false),
    /**
     * Part des tickets clos qui déclenchent une enquête, en pourcentage.
     *
     * Interroger tout le monde à chaque ticket éteint les réponses : le taux
     * existe pour que l'enquête reste rare, donc lue.
     */
    percentage: integer('percentage').notNull().default(30),
    /** Délai entre la clôture et l'envoi, en jours. */
    delayDays: integer('delay_days').notNull().default(1),
    /** Durée pendant laquelle le lien reste utilisable, en jours. */
    durationDays: integer('duration_days').notNull().default(30),
    /** Relance unique après ce délai, nulle pour ne pas relancer. */
    reminderDays: integer('reminder_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('satisfaction_configs_entity_path_gist').using('gist', t.entityPath)],
);

/**
 * Une enquête, et sa réponse éventuelle.
 *
 * Une seule par ticket : relancer deux enquêtes sur la même clôture rendrait la
 * statistique fausse et le demandeur agacé.
 */
export const satisfactions = pgTable(
  'satisfactions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ticketId: bigint('ticket_id', { mode: 'number' })
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    /**
     * Jeton du lien public.
     *
     * C'est lui, et lui seul, qui autorise la réponse : l'enquête doit pouvoir
     * être remplie sans compte, depuis un client de messagerie, par quelqu'un
     * qui ne se connectera jamais à l'interface.
     */
    token: text('token').notNull(),
    /** Instant à partir duquel l'enquête peut partir. */
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    reminderSentAt: timestamp('reminder_sent_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    /** Note de 1 à 5, nulle tant que l'enquête n'a pas de réponse. */
    rating: integer('rating'),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('satisfactions_ticket_key').on(t.ticketId),
    uniqueIndex('satisfactions_token_key').on(t.token),
    // La tache d'envoi balaie cette colonne : sans index, elle relirait toute
    // la table a chaque cycle.
    index('satisfactions_schedule_idx').on(t.requestedAt, t.scheduledAt),
    index('satisfactions_entity_path_gist').using('gist', t.entityPath),
  ],
);

export const satisfactionsRelations = relations(satisfactions, ({ one }) => ({
  ticket: one(tickets, { fields: [satisfactions.ticketId], references: [tickets.id] }),
}));
