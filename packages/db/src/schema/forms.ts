import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { ruleOperatorEnum } from './slm.js';
import { tickets } from './itil-tickets.js';
import { users } from './users.js';

/**
 * Nature d'une question.
 *
 * Une liste fermée : chaque nature décide d'un rendu, d'une validation et d'une
 * façon de retomber sur un champ de ticket. Accepter un type libre reviendrait à
 * ne rien pouvoir garantir de la réponse.
 */
/**
 * Natures de question, calquees sur le jeu de GLPI.
 *
 * L'ordre suit celui du contrat : saisie libre, choix, ce que le ticket attend,
 * puis ce qui n'attend rien. Les valeurs ajoutees le sont **a la fin** de
 * l'enumeration PostgreSQL : `ALTER TYPE ... ADD VALUE` ne sait pas inserer au
 * milieu sans reecrire le type, et l'ordre de declaration n'a ici aucun effet
 * sur le tri -- c'est l'ecran qui groupe.
 */
export const formQuestionKindEnum = pgEnum('form_question_kind', [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'user',
  'group',
  'location',
  'category',
  'urgency',
  'time',
  'datetime',
  'email',
  'url',
  'radio',
  'requesttype',
  'description',
]);

/** À qui un formulaire est ouvert. */
export const formTargetTypeEnum = pgEnum('form_target_type', ['profile', 'group', 'user']);

/** Objet créé par la soumission. */
export const formDestinationKindEnum = pgEnum('form_destination_kind', [
  'ticket',
  'problem',
  'change',
]);

/**
 * Formulaire du catalogue de services.
 *
 * Objet de configuration : une organisation publie ses formulaires à la racine,
 * une filiale les siens. Le catalogue qu'un demandeur voit est donc celui de son
 * entité, augmenté de ce qui descend de ses ancêtres.
 */
export const forms = pgTable(
  'forms',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    isRecursive: boolean('is_recursive').notNull().default(true),
    name: text('name').notNull(),
    description: text('description'),
    /** Rubrique du catalogue, libre : « Matériel », « Accès », « Congés ». */
    category: text('category'),
    /** Un formulaire inactif reste modifiable mais disparaît du catalogue. */
    isActive: boolean('is_active').notNull().default(true),
    ranking: integer('ranking').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('forms_entity_path_gist').using('gist', t.entityPath)],
);

export const formSections = pgTable(
  'form_sections',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    formId: bigint('form_id', { mode: 'number' })
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    ranking: integer('ranking').notNull().default(0),
  },
  (t) => [index('form_sections_form_idx').on(t.formId, t.ranking)],
);

export const formQuestions = pgTable(
  'form_questions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    sectionId: bigint('section_id', { mode: 'number' })
      .notNull()
      .references(() => formSections.id, { onDelete: 'cascade' }),
    kind: formQuestionKindEnum('kind').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    isRequired: boolean('is_required').notNull().default(false),
    ranking: integer('ranking').notNull().default(0),
    /** Choix proposés pour une liste, sous forme de tableau de chaînes. */
    options: jsonb('options'),
    defaultValue: text('default_value'),
  },
  (t) => [index('form_questions_section_idx').on(t.sectionId, t.ranking)],
);

/**
 * Affichage conditionnel.
 *
 * Une question ne s'affiche que si ses conditions sont vraies. Sans elles, un
 * formulaire couvrant plusieurs cas devient un mur de champs dont la plupart ne
 * concernent pas la personne qui le remplit — et qu'elle remplit quand même.
 */
export const formQuestionConditions = pgTable(
  'form_question_conditions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    questionId: bigint('question_id', { mode: 'number' })
      .notNull()
      .references(() => formQuestions.id, { onDelete: 'cascade' }),
    /** Question dont dépend l'affichage. */
    dependsOnId: bigint('depends_on_id', { mode: 'number' })
      .notNull()
      .references(() => formQuestions.id, { onDelete: 'cascade' }),
    operator: ruleOperatorEnum('operator').notNull(),
    value: text('value'),
  },
  (t) => [index('form_question_conditions_question_idx').on(t.questionId)],
);

/**
 * Traductions des libellés.
 *
 * Polymorphe sur trois natures d'objet plutôt qu'une table par objet : une
 * traduction n'a ni logique ni contrainte propre, et trois tables jumelles
 * imposeraient trois fois le même code de lecture.
 */
export const formTranslations = pgTable(
  'form_translations',
  {
    itemType: text('item_type').notNull(),
    itemId: bigint('item_id', { mode: 'number' }).notNull(),
    locale: text('locale').notNull(),
    label: text('label').notNull(),
    description: text('description'),
  },
  (t) => [primaryKey({ columns: [t.itemType, t.itemId, t.locale] })],
);

/**
 * Politique d'accès.
 *
 * Aucune cible signifie « ouvert à tout le périmètre ». Exiger une cible
 * rendrait cérémonieuse la publication d'un formulaire ordinaire, qui est le
 * cas courant.
 */
export const formAccess = pgTable(
  'form_access',
  {
    formId: bigint('form_id', { mode: 'number' })
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    targetType: formTargetTypeEnum('target_type').notNull(),
    targetId: bigint('target_id', { mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.formId, t.targetType, t.targetId] })],
);

/**
 * Ce que la soumission produit.
 *
 * La correspondance entre réponses et champs de l'objet est **explicite** :
 * deviner qu'une question intitulée « Urgence » alimente l'urgence marcherait
 * jusqu'au premier formulaire traduit.
 */
export const formDestinations = pgTable(
  'form_destinations',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    formId: bigint('form_id', { mode: 'number' })
      .notNull()
      .references(() => forms.id, { onDelete: 'cascade' }),
    kind: formDestinationKindEnum('kind').notNull().default('ticket'),
    /** Correspondances champ de l'objet vers question ou valeur fixe. */
    mappings: jsonb('mappings').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('form_destinations_form_key').on(t.formId, t.kind)],
);

/**
 * Une soumission, conservée avec ses réponses.
 *
 * Le ticket ne garde que ce que la correspondance en a tiré ; les réponses
 * complètes restent ici. Sans elles, une question retirée du formulaire
 * emporterait avec elle ce que les demandeurs y avaient répondu.
 */
export const formSubmissions = pgTable(
  'form_submissions',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    formId: bigint('form_id', { mode: 'number' })
      .notNull()
      .references(() => forms.id),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    submittedById: bigint('submitted_by_id', { mode: 'number' }).references(() => users.id),
    ticketId: bigint('ticket_id', { mode: 'number' }).references(() => tickets.id, {
      onDelete: 'set null',
    }),
    answers: jsonb('answers').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('form_submissions_form_idx').on(t.formId, t.createdAt),
    index('form_submissions_entity_path_gist').using('gist', t.entityPath),
  ],
);

export const formsRelations = relations(forms, ({ many }) => ({
  sections: many(formSections),
  access: many(formAccess),
  destinations: many(formDestinations),
  submissions: many(formSubmissions),
}));

export const formSectionsRelations = relations(formSections, ({ one, many }) => ({
  form: one(forms, { fields: [formSections.formId], references: [forms.id] }),
  questions: many(formQuestions),
}));

export const formQuestionsRelations = relations(formQuestions, ({ one, many }) => ({
  section: one(formSections, {
    fields: [formQuestions.sectionId],
    references: [formSections.id],
  }),
  conditions: many(formQuestionConditions),
}));
