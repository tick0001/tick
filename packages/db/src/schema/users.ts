import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { citext, ltree } from '../types.js';
import { authSourceEnum } from './enums.js';
import { entities } from './entities.js';

export const users = pgTable(
  'users',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    username: citext('username').notNull(),
    email: citext('email'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    /** Nul pour un compte d'annuaire : l'authentification est deleguee. */
    passwordHash: text('password_hash'),
    authSource: authSourceEnum('auth_source').notNull().default('local'),
    ldapDn: text('ldap_dn'),
    locale: text('locale'),
    isActive: boolean('is_active').notNull().default(true),
    /** Entite proposee a la connexion, parmi celles ou l'utilisateur est habilite. */
    defaultEntityId: bigint('default_entity_id', { mode: 'number' }).references(() => entities.id),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_username_key').on(t.username), index('users_email_idx').on(t.email)],
);

/**
 * Groupes, arborescents et rattaches a une entite.
 *
 * Objet de configuration : `isRecursive` le rend utilisable dans toute la
 * descendance de son entite. `entityPath` est denormalise depuis `entities`
 * par declencheur, pour que les politiques RLS restent indexables.
 */
export const groups = pgTable(
  'groups',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    parentId: bigint('parent_id', { mode: 'number' }),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    entityPath: ltree('entity_path').notNull(),
    isRecursive: boolean('is_recursive').notNull().default(false),
    name: text('name').notNull(),
    completeName: text('complete_name').notNull(),
    comment: text('comment'),
    /** Le groupe peut-il etre demandeur, et/ou recevoir des attributions ? */
    isRequester: boolean('is_requester').notNull().default(true),
    isAssignable: boolean('is_assignable').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: 'groups_parent_fk' }),
    index('groups_entity_path_gist').using('gist', t.entityPath),
    index('groups_entity_idx').on(t.entityId),
  ],
);

export const groupMembers = pgTable(
  'group_members',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: bigint('group_id', { mode: 'number' })
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** Responsable du groupe : destinataire des escalades et des notifications. */
    isManager: boolean('is_manager').notNull().default(false),
    /** Pose par une regle d'affectation depuis l'annuaire, donc revocable automatiquement. */
    isDynamic: boolean('is_dynamic').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId] }),
    index('group_members_group_idx').on(t.groupId),
  ],
);

export const usersRelations = relations(users, ({ many, one }) => ({
  memberships: many(groupMembers),
  defaultEntity: one(entities, {
    fields: [users.defaultEntityId],
    references: [entities.id],
  }),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  entity: one(entities, { fields: [groups.entityId], references: [entities.id] }),
  parent: one(groups, {
    fields: [groups.parentId],
    references: [groups.id],
    relationName: 'groupParent',
  }),
  children: many(groups, { relationName: 'groupParent' }),
  members: many(groupMembers),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  user: one(users, { fields: [groupMembers.userId], references: [users.id] }),
  group: one(groups, { fields: [groupMembers.groupId], references: [groups.id] }),
}));
