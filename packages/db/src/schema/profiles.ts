import { relations } from 'drizzle-orm';
import {
  bigint,
  boolean,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { profileInterfaceEnum, rightScopeEnum } from './enums.js';
import { entities } from './entities.js';
import { users } from './users.js';

/** Jeu de droits nomme : Self-service, Technicien, Superviseur, Administrateur... */
export const profiles = pgTable(
  'profiles',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    name: text('name').notNull(),
    interface: profileInterfaceEnum('interface').notNull().default('standard'),
    /** Profil attribue par defaut a un nouvel utilisateur sans regle applicable. */
    isDefault: boolean('is_default').notNull().default(false),
    comment: text('comment'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('profiles_name_key').on(t.name)],
);

/**
 * Un droit est un triplet objet x action x portee.
 *
 * L'absence de ligne vaut refus : aucune permission implicite.
 */
export const profileRights = pgTable(
  'profile_rights',
  {
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** Objet vise : `ticket`, `entity`, `profile`, ou `plugin:<id>:<objet>`. */
    object: text('object').notNull(),
    /** Action : `read`, `create`, `update`, `delete`, `purge`, ou une action propre a l'objet. */
    action: text('action').notNull(),
    scope: rightScopeEnum('scope').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.object, t.action] })],
);

/**
 * Habilitation : le lien entre un utilisateur et ses droits n'est pas
 * `utilisateur -> profil` mais le quadruplet (utilisateur, profil, entite, recursif).
 *
 * C'est ce cumul qui permet d'etre technicien sur une branche et simple
 * demandeur sur une autre, et donc de rendre le produit multi-organisation.
 */
export const authorizations = pgTable(
  'authorizations',
  {
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id, { onDelete: 'cascade' }),
    /** L'habilitation porte-t-elle aussi sur la descendance de l'entite ? */
    isRecursive: boolean('is_recursive').notNull().default(false),
    /**
     * Posee par une regle d'affectation depuis l'annuaire. Ces habilitations sont
     * revoquees automatiquement quand l'utilisateur quitte le groupe correspondant,
     * a la difference de celles saisies a la main.
     */
    isDynamic: boolean('is_dynamic').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.profileId, t.entityId] }),
    index('authorizations_user_idx').on(t.userId),
    index('authorizations_entity_idx').on(t.entityId),
  ],
);

export const profilesRelations = relations(profiles, ({ many }) => ({
  rights: many(profileRights),
  authorizations: many(authorizations),
}));

export const profileRightsRelations = relations(profileRights, ({ one }) => ({
  profile: one(profiles, { fields: [profileRights.profileId], references: [profiles.id] }),
}));

export const authorizationsRelations = relations(authorizations, ({ one }) => ({
  user: one(users, { fields: [authorizations.userId], references: [users.id] }),
  profile: one(profiles, { fields: [authorizations.profileId], references: [profiles.id] }),
  entity: one(entities, { fields: [authorizations.entityId], references: [entities.id] }),
}));
