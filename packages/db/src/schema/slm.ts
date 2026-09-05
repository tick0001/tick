import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';

/**
 * Nature d'un engagement.
 *
 *  sla - engagement envers le demandeur, opposable
 *  ola - engagement interne entre équipes, qui n'engage pas le demandeur
 */
export const agreementKindEnum = pgEnum('agreement_kind', ['sla', 'ola']);

/**
 * Axe mesuré.
 *
 *  tto - time to own : délai de prise en compte
 *  ttr - time to resolve : délai de résolution
 */
export const agreementAxisEnum = pgEnum('agreement_axis', ['tto', 'ttr']);

/** Action déclenchée par un niveau d'escalade. */
export const escalationActionEnum = pgEnum('escalation_action', [
  'set_priority',
  'set_urgency',
  'assign_group',
  'assign_user',
  'add_observer',
  'notify',
]);

/**
 * Calendriers d'ouverture.
 *
 * Objet de configuration : une organisation en définit un à la racine, une
 * filiale aux horaires particuliers le sien. Sans calendrier, un engagement se
 * mesure en temps calendaire — ce qui est un choix légitime, pas une absence.
 */
export const calendars = pgTable(
  'calendars',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    isRecursive: boolean('is_recursive').notNull().default(false),
    name: text('name').notNull(),
    comment: text('comment'),
    /**
     * Fuseau dans lequel lire les plages d'ouverture.
     *
     * Les segments sont des heures murales : « 8h-18h » désigne 8h **sur
     * place**. Sans fuseau explicite, le calcul dépendrait de l'horloge du
     * serveur, et une échéance changerait de deux heures au passage à l'heure
     * d'été — sans que rien ne le signale.
     */
    timezone: text('timezone').notNull().default('Europe/Paris'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('calendars_entity_path_gist').using('gist', t.entityPath)],
);

/**
 * Plages d'ouverture, par jour de semaine.
 *
 * Plusieurs segments par jour sont autorisés : une organisation qui ferme entre
 * midi et deux ne compte pas cette heure, et l'exprimer par deux segments est
 * plus juste qu'un facteur correctif.
 */
export const calendarSegments = pgTable(
  'calendar_segments',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    calendarId: bigint('calendar_id', { mode: 'number' })
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    /** 0 = dimanche, conformément à `Date.getDay()`. */
    weekday: integer('weekday').notNull(),
    beginAt: time('begin_at').notNull(),
    endAt: time('end_at').notNull(),
  },
  (t) => [index('calendar_segments_calendar_idx').on(t.calendarId, t.weekday)],
);

/**
 * Jours fériés.
 *
 * `isPerpetual` distingue un jour qui revient chaque année à la même date
 * — le 1er janvier — d'une fermeture ponctuelle. Sans cette distinction, il
 * faudrait ressaisir les fériés fixes tous les ans.
 */
export const holidays = pgTable(
  'holidays',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    calendarId: bigint('calendar_id', { mode: 'number' })
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    day: date('day').notNull(),
    isPerpetual: boolean('is_perpetual').notNull().default(false),
  },
  (t) => [index('holidays_calendar_idx').on(t.calendarId, t.day)],
);

/**
 * Engagements de niveau de service.
 *
 * Un engagement porte sur **un seul axe** : le délai de prise en compte et le
 * délai de résolution se paramètrent séparément parce qu'ils se mesurent
 * séparément et s'escaladent séparément.
 */
export const agreements = pgTable(
  'agreements',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    isRecursive: boolean('is_recursive').notNull().default(false),
    kind: agreementKindEnum('kind').notNull().default('sla'),
    axis: agreementAxisEnum('axis').notNull().default('ttr'),
    name: text('name').notNull(),
    comment: text('comment'),
    /** Durée de l'engagement, en secondes de temps ouvré. */
    duration: integer('duration').notNull(),
    /** Calendrier appliqué. Nul : le décompte se fait en temps calendaire. */
    calendarId: bigint('calendar_id', { mode: 'number' }).references(() => calendars.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('agreements_entity_path_gist').using('gist', t.entityPath)],
);

/**
 * Niveaux d'escalade.
 *
 * `offsetSeconds` se compte **par rapport à l'échéance** : négatif avant,
 * positif après. Exprimer les rappels relativement à l'échéance plutôt qu'à
 * l'ouverture les rend justes quel que soit l'engagement appliqué.
 */
export const agreementLevels = pgTable(
  'agreement_levels',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    agreementId: bigint('agreement_id', { mode: 'number' })
      .notNull()
      .references(() => agreements.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    offsetSeconds: integer('offset_seconds').notNull(),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('agreement_levels_order_idx').on(t.agreementId, t.offsetSeconds)],
);

export const agreementLevelActions = pgTable(
  'agreement_level_actions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    levelId: bigint('level_id', { mode: 'number' })
      .notNull()
      .references(() => agreementLevels.id, { onDelete: 'cascade' }),
    action: escalationActionEnum('action').notNull(),
    /** Paramètre de l'action : niveau de priorité, identifiant de groupe… */
    value: text('value'),
  },
  (t) => [index('agreement_level_actions_level_idx').on(t.levelId)],
);

/**
 * Trace des niveaux déjà déclenchés.
 *
 * Indispensable : sans elle, un redémarrage rejouerait toutes les escalades
 * déjà passées, et un ticket en retard depuis une semaine réaffecterait son
 * groupe à chaque cycle.
 */
export const ticketEscalations = pgTable(
  'ticket_escalations',
  {
    ticketId: bigint('ticket_id', { mode: 'number' }).notNull(),
    levelId: bigint('level_id', { mode: 'number' })
      .notNull()
      .references(() => agreementLevels.id, { onDelete: 'cascade' }),
    executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.levelId] })],
);

export const calendarsRelations = relations(calendars, ({ many }) => ({
  segments: many(calendarSegments),
  holidays: many(holidays),
}));

export const agreementsRelations = relations(agreements, ({ one, many }) => ({
  calendar: one(calendars, { fields: [agreements.calendarId], references: [calendars.id] }),
  levels: many(agreementLevels),
}));

export const agreementLevelsRelations = relations(agreementLevels, ({ one, many }) => ({
  agreement: one(agreements, {
    fields: [agreementLevels.agreementId],
    references: [agreements.id],
  }),
  actions: many(agreementLevelActions),
}));

/**
 * Collections de règles.
 *
 * Un même moteur, plusieurs points d'application. Les séparer par collection
 * évite d'évaluer des règles de tickets lors d'une synchronisation d'annuaire,
 * et rend explicite le catalogue de champs disponible à chaque endroit.
 */
export const ruleCollectionEnum = pgEnum('rule_collection', [
  'ticket.create',
  'ticket.update',
  'authorization.assign',
  'entity.assign',
  'dictionary.ticket',
]);

export const ruleOperatorEnum = pgEnum('rule_operator', [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'regex',
  'not_regex',
  'under',
  'not_under',
  'is_empty',
  'is_not_empty',
]);

export const ruleActionTypeEnum = pgEnum('rule_action_type', [
  'assign',
  'append',
  'regex_result',
  'clear',
]);

export const rules = pgTable(
  'rules',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    isRecursive: boolean('is_recursive').notNull().default(false),
    collection: ruleCollectionEnum('collection').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    /** Ordre d'évaluation croissant. */
    ranking: integer('ranking').notNull().default(100),
    isActive: boolean('is_active').notNull().default(true),
    /** Toutes les conditions, ou au moins une. */
    matchAll: boolean('match_all').notNull().default(true),
    /**
     * Arrête l'évaluation de la collection après application.
     *
     * Sans ce drapeau, une règle générale placée en fin de liste écraserait
     * systématiquement les décisions des règles précédentes.
     */
    stopAfter: boolean('stop_after').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('rules_collection_idx').on(t.collection, t.isActive, t.ranking),
    index('rules_entity_path_gist').using('gist', t.entityPath),
  ],
);

export const ruleCriteria = pgTable(
  'rule_criteria',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ruleId: bigint('rule_id', { mode: 'number' })
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    /** Clé du catalogue de la collection, jamais un nom de colonne libre. */
    field: text('field').notNull(),
    operator: ruleOperatorEnum('operator').notNull(),
    value: text('value'),
  },
  (t) => [index('rule_criteria_rule_idx').on(t.ruleId)],
);

export const ruleActions = pgTable(
  'rule_actions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ruleId: bigint('rule_id', { mode: 'number' })
      .notNull()
      .references(() => rules.id, { onDelete: 'cascade' }),
    field: text('field').notNull(),
    action: ruleActionTypeEnum('action').notNull().default('assign'),
    value: text('value'),
    /** Paramètres complémentaires d'une action, si elle en demande. */
    options: jsonb('options'),
  },
  (t) => [index('rule_actions_rule_idx').on(t.ruleId)],
);

export const rulesRelations = relations(rules, ({ many }) => ({
  criteria: many(ruleCriteria),
  actions: many(ruleActions),
}));
