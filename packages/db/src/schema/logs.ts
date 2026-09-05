import { bigint, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { ltree } from '../types.js';
import { entities } from './entities.js';
import { users } from './users.js';

/**
 * Historique universel.
 *
 * Une ligne par champ modifie, et non par enregistrement : c'est ce qui permet
 * de repondre a « qui a change la priorite, et quand », question centrale dans
 * un outil d'assistance. Une table dediee par objet multiplierait les schemas
 * sans rien apporter.
 *
 * Les valeurs sont conservees en texte : le but est de restituer ce qui a ete
 * vu, pas de rejouer la donnee. Un identifiant devenu invalide reste lisible.
 */
export const logs = pgTable(
  'logs',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** Type de l'objet : `ticket`, `entity`, ou `plugin:<id>:<objet>`. */
    itemType: text('item_type').notNull(),
    itemId: bigint('item_id', { mode: 'number' }).notNull(),
    entityId: bigint('entity_id', { mode: 'number' }).references(() => entities.id),
    entityPath: ltree('entity_path'),
    /** Champ modifie, ou une action nommee : `creation`, `suppression`. */
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    /** Auteur, nul pour une modification faite par une tache automatique. */
    userId: bigint('user_id', { mode: 'number' }).references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('logs_item_idx').on(t.itemType, t.itemId, t.createdAt),
    index('logs_entity_path_gist').using('gist', t.entityPath),
    index('logs_created_idx').on(t.createdAt),
  ],
);
