import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { requestSources } from './itil-referentials.js';
import { profiles } from './profiles.js';

/**
 * Sort d'un message une fois traité.
 *
 * `flag` par défaut dans l'interface : marquer comme lu laisse le message
 * consultable, ce qui est la seule façon de vérifier après coup ce que le
 * collecteur a réellement reçu. La suppression est un choix explicite.
 */
export const mailAfterReadEnum = pgEnum('mail_after_read', ['delete', 'flag', 'move']);

/** Ce que le collecteur a fait d'un message. */
export const mailActionEnum = pgEnum('mail_action', [
  'ticket',
  'followup',
  'ignored',
  'refused',
  'error',
]);

/**
 * Boîte relevée pour créer des tickets.
 *
 * Rattachée à une entité, et non partagée : c'est l'adresse qui décide de
 * l'organisation destinataire. Une boîte unique pour toute l'arborescence
 * obligerait à deviner l'entité à partir du contenu du message, ce qui échoue
 * dès la première réorganisation.
 */
export const mailCollectors = pgTable(
  'mail_collectors',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    name: text('name').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull().default(993),
    useTls: boolean('use_tls').notNull().default(true),
    login: text('login').notNull(),
    /** Chiffré au repos, comme le compte de service de l'annuaire. */
    passwordEncrypted: text('password_encrypted'),
    folder: text('folder').notNull().default('INBOX'),
    afterRead: mailAfterReadEnum('after_read').notNull().default('flag'),
    /** Dossier de destination quand `afterRead` vaut `move`. */
    targetFolder: text('target_folder'),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Profil sous lequel le collecteur agit.
     *
     * Un courriel entrant crée un ticket **au nom de son expéditeur**, mais il
     * faut bien un profil pour que les droits, les règles et les engagements
     * s'appliquent comme pour une saisie. Le déclarer ici, plutôt que de tout
     * écrire en propriétaire, garde le collecteur soumis aux mêmes contrôles
     * que le reste de l'application.
     */
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    /** Source appliquée aux tickets créés, pour les distinguer d'une saisie. */
    requestSourceId: bigint('request_source_id', { mode: 'number' }).references(
      () => requestSources.id,
    ),
    /**
     * Crée un compte local pour un expéditeur inconnu.
     *
     * Faux par défaut : accepter n'importe quelle adresse ouvrirait la création
     * de comptes à quiconque sait écrire un courriel. L'activer est une
     * décision d'administration, pas un réglage par défaut.
     */
    createUnknownRequester: boolean('create_unknown_requester').notNull().default(false),
    /** Messages traités par relève, pour qu'un retard se rattrape par paliers. */
    maxPerRun: integer('max_per_run').notNull().default(50),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mail_collectors_entity_path_gist').using('gist', t.entityPath)],
);

/**
 * Journal des messages relevés.
 *
 * Sans lui, « pourquoi ce courriel n'a-t-il pas créé de ticket » reste sans
 * réponse : le message a été marqué lu et l'information a disparu avec lui.
 */
export const mailCollectorLogs = pgTable(
  'mail_collector_logs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    collectorId: bigint('collector_id', { mode: 'number' })
      .notNull()
      .references(() => mailCollectors.id, { onDelete: 'cascade' }),
    entityId: bigint('entity_id', { mode: 'number' }).references(() => entities.id),
    entityPath: ltree('entity_path'),
    /** Identifiant du message tel que la messagerie l'a posé. */
    messageId: text('message_id'),
    sender: text('sender'),
    subject: text('subject'),
    action: mailActionEnum('action').notNull(),
    ticketId: bigint('ticket_id', { mode: 'number' }),
    detail: text('detail'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mail_collector_logs_collector_idx').on(t.collectorId, t.createdAt),
    index('mail_collector_logs_message_idx').on(t.messageId),
  ],
);

export const mailCollectorsRelations = relations(mailCollectors, ({ many, one }) => ({
  logs: many(mailCollectorLogs),
  entity: one(entities, { fields: [mailCollectors.entityId], references: [entities.id] }),
}));
