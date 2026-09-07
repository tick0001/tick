import type { ItilType } from '@tick/contracts';
import { sql, type SQL } from '@tick/db';
import { nomAffiche } from '../common/sql.js';
import { ITIL_KINDS } from '../itil/itil-kinds.js';

/** Table de l'objet porteur, interpolee en SQL brut depuis une constante. */
function table(porteur: ItilType): SQL {
  return sql.raw(ITIL_KINDS[porteur].table);
}

/**
 * Libellé d'un acteur, quelle que soit sa nature.
 *
 * Les trois natures vivent dans trois tables : les réunir dans un fragment
 * réutilisable évite de dupliquer la même jointure triple dans chaque requête,
 * et garantit que « demandeur » s'affiche partout de la même façon.
 *
 * Les jointures sont externes à dessein : un acteur hors du périmètre visible
 * produit un libellé nul, filtré ensuite, plutôt que de faire disparaître le
 * ticket entier de la liste.
 */
export function actorLabels(
  role: 'requester' | 'observer' | 'assigned',
  porteur: ItilType = 'ticket',
): SQL {
  return sql`(
    SELECT array_remove(array_agg(
      CASE acteur.actor_type
        WHEN 'user' THEN ${nomAffiche()}
        WHEN 'group' THEN g.name
        WHEN 'supplier' THEN f.name
      END
    ), NULL)
    FROM itil_actors acteur
    LEFT JOIN users u ON acteur.actor_type = 'user' AND u.id = acteur.actor_id
    LEFT JOIN groups g ON acteur.actor_type = 'group' AND g.id = acteur.actor_id
    LEFT JOIN suppliers f ON acteur.actor_type = 'supplier' AND f.id = acteur.actor_id
    WHERE acteur.itil_type = ${porteur}
      AND acteur.itil_id = ${table(porteur)}.id
      AND acteur.role = ${role}
  )`;
}

/** Nombre de suivis non supprimés de l'objet. */
export function followupCount(porteur: ItilType = 'ticket'): SQL {
  return sql`(
    SELECT count(*) FROM itil_followups s
     WHERE s.itil_type = ${porteur} AND s.itil_id = ${table(porteur)}.id
       AND s.deleted_at IS NULL
  )`;
}

/** Nombre de tâches non supprimées de l'objet. */
export function taskCount(porteur: ItilType = 'ticket'): SQL {
  return sql`(
    SELECT count(*) FROM itil_tasks k
     WHERE k.itil_type = ${porteur} AND k.itil_id = ${table(porteur)}.id
       AND k.deleted_at IS NULL
  )`;
}

/** Colonnes de tri autorisées, vers leur expression SQL. */
export const SORTABLE = {
  dateOpened: sql`tickets.date_opened`,
  priority: sql`tickets.priority`,
  dateDue: sql`tickets.date_due`,
  status: sql`tickets.status`,
} as const;

export type SortableColumn = keyof typeof SORTABLE;

/**
 * Curseur de pagination.
 *
 * Il transporte la valeur de tri **et** l'identifiant : deux tickets ouverts à
 * la même seconde sont fréquents, et un curseur sur la seule valeur de tri en
 * sauterait un à chaque page.
 */
export interface Cursor {
  value: string | null;
  id: number;
}

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeCursor(brut: string | undefined): Cursor | null {
  if (!brut) return null;

  try {
    const decode = JSON.parse(Buffer.from(brut, 'base64url').toString('utf8')) as unknown;

    if (
      typeof decode === 'object' &&
      decode !== null &&
      'id' in decode &&
      typeof (decode as Cursor).id === 'number'
    ) {
      return decode as Cursor;
    }
  } catch {
    // Curseur illisible : on repart du début plutôt que d'échouer. Un curseur
    // vient d'une page précédente, il n'a aucune valeur de sécurité.
  }

  return null;
}
