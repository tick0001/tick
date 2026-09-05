import { relations } from 'drizzle-orm';
import { bigint, boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { entities } from './entities.js';
import { profiles } from './profiles.js';
import { users } from './users.js';

/**
 * Session active. Le contexte de travail y est materialise : entite active,
 * profil actif, et indicateur « inclure les sous-entites ». L'utilisateur peut
 * en changer sans se reconnecter, ce qui met a jour la ligne.
 *
 * Le jeton de rafraichissement n'est stocke que sous forme de condensat : une
 * fuite de la base ne permet pas de rejouer les sessions.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    profileId: bigint('profile_id', { mode: 'number' })
      .notNull()
      .references(() => profiles.id),
    entityId: bigint('entity_id', { mode: 'number' })
      .notNull()
      .references(() => entities.id),
    includeSubEntities: boolean('include_sub_entities').notNull().default(true),
    refreshTokenHash: text('refresh_token_hash').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
  profile: one(profiles, { fields: [sessions.profileId], references: [profiles.id] }),
  entity: one(entities, { fields: [sessions.entityId], references: [entities.id] }),
}));
