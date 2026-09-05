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
import { entities } from './entities.js';
import { profiles } from './profiles.js';

/**
 * Annuaire LDAP ou Active Directory.
 *
 * Le mot de passe du compte de service est chiffre avant stockage : c'est un
 * secret reutilisable qui donne acces a l'annuaire entier, pas un mot de passe
 * utilisateur dont un condensat suffirait.
 */
export const ldapDirectories = pgTable(
  'ldap_directories',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull().default(389),
    useTls: boolean('use_tls').notNull().default(false),
    bindDn: text('bind_dn'),
    /** Chiffre en AES-256-GCM. Jamais renvoye par l'API. */
    bindPasswordEncrypted: text('bind_password_encrypted'),
    baseDn: text('base_dn').notNull(),
    userFilter: text('user_filter').notNull().default('(objectClass=person)'),

    /** Correspondance des attributs vers les champs du compte local. */
    loginAttribute: text('login_attribute').notNull().default('uid'),
    emailAttribute: text('email_attribute').notNull().default('mail'),
    firstNameAttribute: text('first_name_attribute').notNull().default('givenName'),
    lastNameAttribute: text('last_name_attribute').notNull().default('sn'),
    groupMemberAttribute: text('group_member_attribute').notNull().default('memberOf'),

    isActive: boolean('is_active').notNull().default(true),
    /** Annuaire interroge en premier lorsqu'un identifiant est inconnu localement. */
    isDefault: boolean('is_default').notNull().default(false),
    timeoutMs: integer('timeout_ms').notNull().default(5000),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('ldap_directories_name_key').on(t.name)],
);

/**
 * Correspondance groupe d'annuaire vers habilitation.
 *
 * Ces correspondances produisent des habilitations marquees `is_dynamic`, donc
 * revoquees automatiquement des que l'utilisateur quitte le groupe. Les
 * habilitations saisies a la main ne sont jamais touchees.
 *
 * Forme volontairement simple : le moteur de regles generique du jalon J4
 * remplacera la source de decision, mais le mecanisme de revocation, lui, ne
 * bougera pas.
 */
export const ldapGroupMappings = pgTable(
  'ldap_group_mappings',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    directoryId: bigint('directory_id', { mode: 'number' })
      .notNull()
      .references(() => ldapDirectories.id, { onDelete: 'cascade' }),
    /** Nom distinctif du groupe, compare sans tenir compte de la casse. */
    groupDn: text('group_dn').notNull(),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    isRecursive: boolean('is_recursive').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('ldap_group_mappings_directory_idx').on(t.directoryId),
    uniqueIndex('ldap_group_mappings_key').on(t.directoryId, t.groupDn, t.profileId, t.entityId),
  ],
);

export const ldapDirectoriesRelations = relations(ldapDirectories, ({ many }) => ({
  mappings: many(ldapGroupMappings),
}));

export const ldapGroupMappingsRelations = relations(ldapGroupMappings, ({ one }) => ({
  directory: one(ldapDirectories, {
    fields: [ldapGroupMappings.directoryId],
    references: [ldapDirectories.id],
  }),
  profile: one(profiles, { fields: [ldapGroupMappings.profileId], references: [profiles.id] }),
  entity: one(entities, { fields: [ldapGroupMappings.entityId], references: [entities.id] }),
}));
