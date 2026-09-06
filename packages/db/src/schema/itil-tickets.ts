import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import {
  actorRoleEnum,
  actorTypeEnum,
  followupSourceEnum,
  itilLinkTypeEnum,
  itilStatusEnum,
  itilTypeEnum,
  solutionStateEnum,
  taskStateEnum,
  templateFieldKindEnum,
  ticketTypeEnum,
  validationStateEnum,
} from './itil-enums.js';
import {
  itilCategories,
  locations,
  requestSources,
  solutionTypes,
  taskCategories,
} from './itil-referentials.js';
import { groups, users } from './users.js';

/** Colonnes communes a toute donnee rattachee a une entite. */
const scopeColumns = {
  entityId: bigint('entity_id', { mode: 'number' })
    .notNull()
    .references(() => entities.id),
  entityPath: ltree('entity_path').notNull(),
};

/**
 * Gabarits de ticket.
 *
 * Un gabarit ne fixe pas des valeurs : il declare, champ par champ, si celui-ci
 * est prerempli, obligatoire ou masque. Les trois natures se combinent — un
 * champ peut etre prerempli **et** obligatoire.
 */
export const ticketTemplates = pgTable(
  'ticket_templates',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,
    isRecursive: boolean('is_recursive').notNull().default(false),
    name: text('name').notNull(),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('ticket_templates_entity_path_gist').using('gist', t.entityPath)],
);

export const ticketTemplateFields = pgTable(
  'ticket_template_fields',
  {
    templateId: bigint('template_id', { mode: 'number' })
      .notNull()
      .references(() => ticketTemplates.id, { onDelete: 'cascade' }),
    /** Nom du champ du ticket, tel qu'exposé par l'API. */
    field: text('field').notNull(),
    kind: templateFieldKindEnum('kind').notNull(),
    /** Valeur preremplie, en JSON textuel. Nulle pour `mandatory` et `hidden`. */
    value: text('value'),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.field, t.kind] })],
);

/**
 * Tickets : incidents et demandes de service.
 *
 * Objet de **donnees** : il appartient a exactement une entite et ne porte pas
 * de drapeau recursif. Un ticket n'est pas partage, il est situe.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    ...scopeColumns,

    type: ticketTypeEnum('type').notNull().default('incident'),
    status: itilStatusEnum('status').notNull().default('new'),
    name: text('name').notNull(),
    content: text('content').notNull().default(''),

    /**
     * Urgence et impact sont saisis, la priorite en decoule.
     *
     * Echelle de 1 (tres basse) a 5 (tres haute). La matrice de conversion est
     * reglable par entite : deux organisations n'ont pas la meme idee de ce
     * qu'un incident majeur signifie.
     */
    urgency: integer('urgency').notNull().default(3),
    impact: integer('impact').notNull().default(3),
    priority: integer('priority').notNull().default(3),

    categoryId: bigint('category_id', { mode: 'number' }).references(() => itilCategories.id),
    requestSourceId: bigint('request_source_id', { mode: 'number' }).references(
      () => requestSources.id,
    ),
    locationId: bigint('location_id', { mode: 'number' }).references(() => locations.id),
    templateId: bigint('template_id', { mode: 'number' }).references(() => ticketTemplates.id),

    dateOpened: timestamp('date_opened', { withTimezone: true }).notNull().defaultNow(),
    /** Echeance de resolution, calculee par l'engagement en temps ouvre. */
    dateDue: timestamp('date_due', { withTimezone: true }),
    /** Echeance de prise en compte. */
    dateDueOwn: timestamp('date_due_own', { withTimezone: true }),
    /**
     * Echeances internes, portees par les OLA.
     *
     * Distinctes des precedentes : un engagement interne se tient plus tot que
     * l'engagement opposable au demandeur, et c'est precisement l'ecart entre
     * les deux qui laisse a l'equipe une marge de rattrapage. Les confondre
     * reviendrait a n'avoir qu'un seul engagement.
     */
    dateDueInternal: timestamp('date_due_internal', { withTimezone: true }),
    dateDueOwnInternal: timestamp('date_due_own_internal', { withTimezone: true }),

    /**
     * Engagements appliques.
     *
     * Quatre references distinctes : chaque axe se parametre et s'escalade
     * separement, et un OLA interne n'a pas la meme echeance qu'un SLA opposable.
     */
    slaTtoId: bigint('sla_tto_id', { mode: 'number' }),
    slaTtrId: bigint('sla_ttr_id', { mode: 'number' }),
    olaTtoId: bigint('ola_tto_id', { mode: 'number' }),
    olaTtrId: bigint('ola_ttr_id', { mode: 'number' }),

    /** Prochain niveau d'escalade a declencher, et son echeance. */
    escalationLevelId: bigint('escalation_level_id', { mode: 'number' }),
    escalationAt: timestamp('escalation_at', { withTimezone: true }),
    dateTakenIntoAccount: timestamp('date_taken_into_account', { withTimezone: true }),
    dateSolved: timestamp('date_solved', { withTimezone: true }),
    dateClosed: timestamp('date_closed', { withTimezone: true }),

    /** Delais constates, en secondes, heures ouvrees deduites. */
    takeIntoAccountDelay: integer('take_into_account_delay'),
    solveDelay: integer('solve_delay'),
    closeDelay: integer('close_delay'),
    /** Cumul du temps passe en statut « en attente », qui suspend les delais. */
    waitingDuration: integer('waiting_duration').notNull().default(0),
    /** Debut de la periode d'attente en cours, nulle si le ticket n'attend pas. */
    waitingSince: timestamp('waiting_since', { withTimezone: true }),
    /** Somme des durees de taches, en minutes. */
    internalTime: integer('internal_time').notNull().default(0),

    /** Etat agrege des validations, nul si aucune n'a ete demandee. */
    validationStatus: validationStateEnum('validation_status'),

    createdById: bigint('created_by_id', { mode: 'number' }).references(() => users.id),
    updatedById: bigint('updated_by_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** Suppression logique : la corbeille de GLPI, et l'exigence d'audit. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('tickets_entity_path_gist').using('gist', t.entityPath),
    // Les listes de tickets sont triees par date decroissante et filtrees par
    // statut : c'est la requete la plus frequente de tout l'outil.
    index('tickets_status_date_idx').on(t.status, t.dateOpened.desc()),
    index('tickets_entity_status_idx').on(t.entityId, t.status),
    index('tickets_category_idx').on(t.categoryId),
    index('tickets_due_idx').on(t.dateDue),
    // La tache d'escalade balaie cette colonne a chaque cycle : sans index,
    // elle scannerait toute la table de tickets a chaque minute.
    index('tickets_escalation_idx').on(t.escalationAt),
  ],
);

/**
 * Acteurs, polymorphes sur le type d'objet ITIL.
 *
 * La cle primaire porte les cinq colonnes : un meme utilisateur peut etre a la
 * fois demandeur et observateur, mais pas deux fois demandeur.
 */
export const itilActors = pgTable(
  'itil_actors',
  {
    itilType: itilTypeEnum('itil_type').notNull(),
    itilId: bigint('itil_id', { mode: 'number' }).notNull(),
    role: actorRoleEnum('role').notNull(),
    actorType: actorTypeEnum('actor_type').notNull(),
    actorId: bigint('actor_id', { mode: 'number' }).notNull(),
    /** Adresse de reponse quand l'acteur n'a pas de compte, ou en preferer une autre. */
    alternativeEmail: text('alternative_email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.itilType, t.itilId, t.role, t.actorType, t.actorId] }),
    index('itil_actors_object_idx').on(t.itilType, t.itilId),
    // « Mes tickets » et « ceux de mes groupes » interrogent cet index.
    index('itil_actors_actor_idx').on(t.actorType, t.actorId, t.role),
  ],
);

export const itilFollowups = pgTable(
  'itil_followups',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    itilType: itilTypeEnum('itil_type').notNull(),
    itilId: bigint('itil_id', { mode: 'number' }).notNull(),
    ...scopeColumns,
    content: text('content').notNull(),
    /** Un suivi prive n'est pas visible du demandeur. */
    isPrivate: boolean('is_private').notNull().default(false),
    source: followupSourceEnum('source').notNull().default('interface'),
    authorId: bigint('author_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('itil_followups_object_idx').on(t.itilType, t.itilId, t.createdAt),
    index('itil_followups_entity_path_gist').using('gist', t.entityPath),
  ],
);

export const itilTasks = pgTable(
  'itil_tasks',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    itilType: itilTypeEnum('itil_type').notNull(),
    itilId: bigint('itil_id', { mode: 'number' }).notNull(),
    ...scopeColumns,
    content: text('content').notNull(),
    state: taskStateEnum('state').notNull().default('todo'),
    categoryId: bigint('category_id', { mode: 'number' }).references(() => taskCategories.id),
    isPrivate: boolean('is_private').notNull().default(false),
    /** Duree reelle, en minutes. Alimente le temps interne du ticket. */
    actionTime: integer('action_time').notNull().default(0),
    /** Planification : les deux bornes alimentent le planning et les conflits. */
    beginAt: timestamp('begin_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    technicianId: bigint('technician_id', { mode: 'number' }).references(() => users.id),
    groupId: bigint('group_id', { mode: 'number' }).references(() => groups.id),
    authorId: bigint('author_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('itil_tasks_object_idx').on(t.itilType, t.itilId),
    index('itil_tasks_planning_idx').on(t.technicianId, t.beginAt),
    index('itil_tasks_entity_path_gist').using('gist', t.entityPath),
  ],
);

/**
 * Solutions successives.
 *
 * Plusieurs lignes possibles : la derniere fait foi. Conserver les solutions
 * refusees documente ce qui a ete tente, ce qu'un champ unique ecrase perdrait.
 */
export const itilSolutions = pgTable(
  'itil_solutions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    itilType: itilTypeEnum('itil_type').notNull(),
    itilId: bigint('itil_id', { mode: 'number' }).notNull(),
    ...scopeColumns,
    content: text('content').notNull(),
    solutionTypeId: bigint('solution_type_id', { mode: 'number' }).references(
      () => solutionTypes.id,
    ),
    status: solutionStateEnum('status').notNull().default('proposed'),
    authorId: bigint('author_id', { mode: 'number' }).references(() => users.id),
    approverId: bigint('approver_id', { mode: 'number' }).references(() => users.id),
    approvalComment: text('approval_comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [
    index('itil_solutions_object_idx').on(t.itilType, t.itilId, t.createdAt),
    index('itil_solutions_entity_path_gist').using('gist', t.entityPath),
  ],
);

export const itilValidations = pgTable(
  'itil_validations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    itilType: itilTypeEnum('itil_type').notNull(),
    itilId: bigint('itil_id', { mode: 'number' }).notNull(),
    ...scopeColumns,
    requesterId: bigint('requester_id', { mode: 'number' }).references(() => users.id),
    /** La cible est un utilisateur ou un groupe : n'importe qui du groupe repond. */
    validatorType: actorTypeEnum('validator_type').notNull().default('user'),
    validatorId: bigint('validator_id', { mode: 'number' }).notNull(),
    /** Utilisateur ayant effectivement repondu, utile pour une cible de groupe. */
    answeredById: bigint('answered_by_id', { mode: 'number' }).references(() => users.id),
    status: validationStateEnum('status').notNull().default('waiting'),
    requestComment: text('request_comment'),
    responseComment: text('response_comment'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
  },
  (t) => [
    index('itil_validations_object_idx').on(t.itilType, t.itilId),
    index('itil_validations_validator_idx').on(t.validatorType, t.validatorId, t.status),
    index('itil_validations_entity_path_gist').using('gist', t.entityPath),
  ],
);

export const itilCosts = pgTable(
  'itil_costs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    itilType: itilTypeEnum('itil_type').notNull(),
    itilId: bigint('itil_id', { mode: 'number' }).notNull(),
    ...scopeColumns,
    name: text('name').notNull(),
    beginAt: timestamp('begin_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    /** Duree facturee, en minutes. */
    actionTime: integer('action_time').notNull().default(0),
    /** Montants en unites monetaires. `numeric` et non `float` : c'est de l'argent. */
    costTime: numeric('cost_time', { precision: 12, scale: 2 }).notNull().default('0'),
    costFixed: numeric('cost_fixed', { precision: 12, scale: 2 }).notNull().default('0'),
    costMaterial: numeric('cost_material', { precision: 12, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('itil_costs_object_idx').on(t.itilType, t.itilId),
    index('itil_costs_entity_path_gist').using('gist', t.entityPath),
  ],
);

/**
 * Liens entre objets ITIL.
 *
 * `linked` est symetrique, `duplicate` et `child` ne le sont pas : la source
 * d'un `child` est l'enfant. L'index unique empeche le doublon exact.
 */
export const itilLinks = pgTable(
  'itil_links',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sourceType: itilTypeEnum('source_type').notNull(),
    sourceId: bigint('source_id', { mode: 'number' }).notNull(),
    targetType: itilTypeEnum('target_type').notNull(),
    targetId: bigint('target_id', { mode: 'number' }).notNull(),
    linkType: itilLinkTypeEnum('link_type').notNull().default('linked'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('itil_links_unique').on(
      t.sourceType,
      t.sourceId,
      t.targetType,
      t.targetId,
      t.linkType,
    ),
    index('itil_links_target_idx').on(t.targetType, t.targetId),
  ],
);

export const ticketsRelations = relations(tickets, ({ one }) => ({
  entity: one(entities, { fields: [tickets.entityId], references: [entities.id] }),
  category: one(itilCategories, {
    fields: [tickets.categoryId],
    references: [itilCategories.id],
  }),
  requestSource: one(requestSources, {
    fields: [tickets.requestSourceId],
    references: [requestSources.id],
  }),
  location: one(locations, { fields: [tickets.locationId], references: [locations.id] }),
  template: one(ticketTemplates, {
    fields: [tickets.templateId],
    references: [ticketTemplates.id],
  }),
  createdBy: one(users, { fields: [tickets.createdById], references: [users.id] }),
}));

export const ticketTemplatesRelations = relations(ticketTemplates, ({ many }) => ({
  fields: many(ticketTemplateFields),
}));

export const ticketTemplateFieldsRelations = relations(ticketTemplateFields, ({ one }) => ({
  template: one(ticketTemplates, {
    fields: [ticketTemplateFields.templateId],
    references: [ticketTemplates.id],
  }),
}));
