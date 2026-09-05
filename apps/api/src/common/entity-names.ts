import { entities, inArray } from '@tick/db';
import type { DatabaseService } from '../database/database.service.js';

/**
 * Noms d'entités, résolus avec le rôle propriétaire.
 *
 * Un objet de configuration hérité vit sur un **ancêtre**, donc hors du
 * périmètre descendant. Joindre `entities` dans la requête soumise au
 * Row-Level Security ferait alors disparaître la ligne entière — pas seulement
 * le nom — sans erreur ni trace : un calendrier défini à la racine deviendrait
 * invisible depuis une filiale, et l'échéance qu'il porte serait silencieusement
 * ignorée.
 *
 * La visibilité de l'objet a déjà été tranchée par sa propre politique. Il ne
 * reste ici qu'à nommer l'entité qui le porte, ce qui ne révèle rien de plus
 * que ce que l'objet lui-même vient de révéler.
 */
export async function entityNames(
  db: DatabaseService,
  ids: readonly number[],
): Promise<Map<number, string>> {
  const uniques = [...new Set(ids)];

  if (uniques.length === 0) return new Map();

  const rows = await db.asOwner((tx) =>
    tx
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(inArray(entities.id, uniques)),
  );

  return new Map(rows.map((row) => [row.id, row.name]));
}
