import { sql, type SQL } from '@tick/db';

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
export function actorLabels(role: 'requester' | 'observer' | 'assigned'): SQL {
  return sql`(
    SELECT array_remove(array_agg(
      CASE acteur.actor_type
        WHEN 'user' THEN coalesce(
          nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
          u.username::text
        )
        WHEN 'group' THEN g.name
        WHEN 'supplier' THEN f.name
      END
    ), NULL)
    FROM itil_actors acteur
    LEFT JOIN users u ON acteur.actor_type = 'user' AND u.id = acteur.actor_id
    LEFT JOIN groups g ON acteur.actor_type = 'group' AND g.id = acteur.actor_id
    LEFT JOIN suppliers f ON acteur.actor_type = 'supplier' AND f.id = acteur.actor_id
    WHERE acteur.itil_type = 'ticket'
      AND acteur.itil_id = tickets.id
      AND acteur.role = ${role}
  )`;
}

/** Nombre de suivis non supprimés d'un ticket. */
export const followupCount = sql`(
  SELECT count(*) FROM itil_followups s
   WHERE s.itil_type = 'ticket' AND s.itil_id = tickets.id AND s.deleted_at IS NULL
)`;

/** Nombre de tâches non supprimées d'un ticket. */
export const taskCount = sql`(
  SELECT count(*) FROM itil_tasks k
   WHERE k.itil_type = 'ticket' AND k.itil_id = tickets.id AND k.deleted_at IS NULL
)`;

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

/**
 * Convertit en date ISO une valeur venant de SQL brut.
 *
 * `tx.execute` ne passe pas par le typage de Drizzle : selon la requete, une
 * colonne temporelle revient en `Date` ou en chaine. Supposer l'un des deux
 * produit une panne a l'execution, loin de la requete fautive.
 */
export function toIso(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) return valeur.toISOString();

  const date = new Date(String(valeur));

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Variante non nulle, pour les colonnes obligatoires. */
export function toIsoRequired(valeur: unknown): string {
  return toIso(valeur) ?? new Date(0).toISOString();
}
