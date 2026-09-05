import { Injectable } from '@nestjs/common';
import { logs, type Transaction } from '@tick/db';
import { currentContext } from '../common/request-context.js';

export interface FieldChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

/** Champs dont la valeur n'a pas d'intérêt dans l'historique. */
const IGNORED = new Set(['updatedAt', 'updatedById', 'entityPath', 'priority']);

function render(valeur: unknown): string | null {
  if (valeur === null || valeur === undefined) return null;
  if (valeur instanceof Date) return valeur.toISOString();
  if (typeof valeur === 'object') return JSON.stringify(valeur);

  return String(valeur);
}

/**
 * Historique universel.
 *
 * Une ligne par champ modifié. La priorité en est exclue : elle est dérivée de
 * l'urgence et de l'impact, et la journaliser ferait apparaître deux entrées
 * pour une seule décision humaine.
 */
@Injectable()
export class HistoryService {
  /**
   * Compare l'avant et l'après, et journalise ce qui a changé.
   *
   * Écrit dans la transaction en cours : l'historique et la modification qu'il
   * décrit sont validés ensemble, ou pas du tout.
   */
  async recordChanges(
    tx: Transaction,
    item: { type: string; id: number; entityId: number },
    avant: Record<string, unknown>,
    apres: Record<string, unknown>,
  ): Promise<string[]> {
    const changements: FieldChange[] = [];

    for (const [field, valeur] of Object.entries(apres)) {
      if (IGNORED.has(field)) continue;

      const ancienne = render(avant[field]);
      const nouvelle = render(valeur);

      if (ancienne === nouvelle) continue;

      changements.push({ field, oldValue: ancienne, newValue: nouvelle });
    }

    if (changements.length > 0) {
      await this.record(tx, item, changements);
    }

    return changements.map((changement) => changement.field);
  }

  /** Journalise des entrées déjà constituées, y compris des actions nommées. */
  async record(
    tx: Transaction,
    item: { type: string; id: number; entityId: number },
    changements: readonly FieldChange[],
  ): Promise<void> {
    if (changements.length === 0) return;

    const userId = currentContext()?.userId ?? null;

    await tx.insert(logs).values(
      changements.map((changement) => ({
        itemType: item.type,
        itemId: item.id,
        entityId: item.entityId,
        // Recalculé par le déclencheur depuis `entity_id`.
        entityPath: null,
        field: changement.field,
        oldValue: changement.oldValue,
        newValue: changement.newValue,
        userId,
      })),
    );
  }

  /** Journalise une action sans avant ni après : création, suppression, restauration. */
  async recordAction(
    tx: Transaction,
    item: { type: string; id: number; entityId: number },
    action: string,
    detail?: string | null,
  ): Promise<void> {
    await this.record(tx, item, [{ field: action, oldValue: null, newValue: detail ?? null }]);
  }
}
