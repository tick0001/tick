import {
  bigint,
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ldapGroupSearchModeEnum } from './enums.js';

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

    /**
     * Comment retrouver les groupes d'un utilisateur.
     *
     * Les deux annuaires du marche ne repondent pas de la meme facon :
     *
     *  - `attribute` : l'entree utilisateur porte ses groupes. C'est le cas
     *    d'Active Directory, qui expose `memberOf` nativement ;
     *  - `search` : il faut chercher les groupes dont l'utilisateur est membre.
     *    C'est le cas d'OpenLDAP, ou `memberOf` demande une surcouche souvent
     *    absente.
     *
     * Ne supporter que le premier mode reviendrait a ne fonctionner qu'avec
     * Active Directory.
     */
    groupSearchMode: ldapGroupSearchModeEnum('group_search_mode').notNull().default('attribute'),
    /** Attribut des groupes porte par l'entree utilisateur, en mode `attribute`. */
    memberOfAttribute: text('member_of_attribute').notNull().default('memberOf'),
    /** Attribut des membres porte par l'entree groupe, en mode `search`. */
    groupMemberAttribute: text('group_member_attribute').notNull().default('member'),
    /** Racine de recherche des groupes. Nulle : on repart de `baseDn`. */
    groupBaseDn: text('group_base_dn'),
    groupFilter: text('group_filter').notNull().default('(objectClass=groupOfNames)'),

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
