import { relations } from 'drizzle-orm';
import {
  bigint,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import { entities } from './entities.js';

/**
 * Etat d'un plugin.
 *
 *  decouvert - present sur le disque, manifeste lu, rien d'installe
 *  installe  - schema cree et migrations appliquees, mais inactif
 *  actif     - hooks, routes et taches enregistres
 *  inactif   - desactive volontairement, donnees conservees
 *  erreur    - defaillant de maniere repetee, desactive automatiquement
 */
export const pluginStateEnum = pgEnum('plugin_state', [
  'decouvert',
  'installe',
  'actif',
  'inactif',
  'erreur',
]);

/**
 * Plugins connus de l'instance.
 *
 * L'identifiant est celui du manifeste, pas une cle technique : il apparait
 * dans les noms de schema SQL, les prefixes de route et les cles de droits, et
 * doit donc rester stable et lisible.
 */
export const plugins = pgTable('plugins', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  state: pluginStateEnum('state').notNull().default('decouvert'),
  /** Contrainte de compatibilite declaree, en semver, sur la version du SDK. */
  sdkRange: text('sdk_range').notNull(),
  /** Manifeste complet, conserve tel quel pour l'audit et le diagnostic. */
  manifest: jsonb('manifest').notNull(),
  /** Derniere erreur ayant provoque la desactivation automatique. */
  lastError: text('last_error'),
  failureCount: integer('failure_count').notNull().default(0),
  installedAt: timestamp('installed_at', { withTimezone: true }),
  activatedAt: timestamp('activated_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Migrations appliquees par plugin.
 *
 * L'empreinte est conservee pour detecter la modification d'une migration deja
 * appliquee : elle produirait des schemas divergents entre installations, et
 * c'est le genre d'ecart qu'on ne remarque qu'en production.
 */
export const pluginMigrations = pgTable(
  'plugin_migrations',
  {
    pluginId: text('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    checksum: text('checksum').notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pluginId, t.filename] })],
);

/**
 * Reglages des plugins, tels que declares dans leur manifeste.
 *
 * Une ligne par valeur posee : `entity_id` nul pour un reglage d'instance, ou
 * pour la valeur racine d'un reglage d'entite. Un reglage sans ligne prend la
 * valeur de l'ancetre le plus proche, puis celle du manifeste.
 *
 * `value` est du texte : clair pour un reglage ordinaire, chiffre par
 * `SecretsService` pour un secret. Le type declare est relu dans le manifeste a
 * chaque lecture, pas stocke ici : un plugin qui change le type d'un reglage
 * doit le migrer, pas le decouvrir mal interprete.
 *
 * **Le role applicatif n'y a aucun acces.** Un plugin execute du SQL brut avec
 * ce role : sans la revocation de la migration, il lirait et reecrirait les
 * reglages des autres, validation comprise.
 */
export const pluginSettings = pgTable(
  'plugin_settings',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    pluginId: text('plugin_id')
      .notNull()
      .references(() => plugins.id, { onDelete: 'cascade' }),
    entityId: bigint('entity_id', { mode: 'number' }).references(() => entities.id, {
      onDelete: 'cascade',
    }),
    key: text('key').notNull(),
    value: text('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('plugin_settings_cle').on(t.pluginId, t.entityId, t.key).nullsNotDistinct()],
);

export const pluginsRelations = relations(plugins, ({ many }) => ({
  migrations: many(pluginMigrations),
}));

export const pluginMigrationsRelations = relations(pluginMigrations, ({ one }) => ({
  plugin: one(plugins, { fields: [pluginMigrations.pluginId], references: [plugins.id] }),
}));
