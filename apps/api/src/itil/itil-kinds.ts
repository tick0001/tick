import type { ItilType } from '@tick/contracts';

/**
 * Ce qui distingue les trois objets ITIL, et rien d'autre.
 *
 * Le reste — acteurs, chronologie, historique, droits — est commun, et le code
 * qui les manipule ne connaît que ce descripteur. C'est ce qui permet d'ajouter
 * un objet sans réécrire la chronologie, et c'est l'inverse de ce qu'une table
 * fourre-tout aurait produit : là, tout aurait été commun, y compris ce qui ne
 * l'est pas.
 */
export interface ItilDescriptor {
  kind: ItilType;
  /**
   * Nom de la table.
   *
   * Interpolé en SQL brut, donc jamais issu d'une saisie : c'est une constante
   * du code, choisie par une clé du type `ItilType` que Zod a déjà validée.
   */
  table: string;
  /** Objet de droit associé, tel que les profils le nomment. */
  right: string;
  /** Colonnes propres à ce type, en plus du socle commun. */
  extra: readonly string[];
}

export const ITIL_KINDS: Record<ItilType, ItilDescriptor> = {
  ticket: { kind: 'ticket', table: 'tickets', right: 'ticket', extra: [] },
  problem: {
    kind: 'problem',
    table: 'problems',
    right: 'problem',
    // Le symptôme est ce que l'on observe, la cause ce que l'on a compris,
    // l'impact ce que cela coûte. Trois champs parce que trois questions.
    extra: ['symptoms', 'causes', 'impacts'],
  },
  change: {
    kind: 'change',
    table: 'changes',
    right: 'change',
    extra: ['deploymentPlan', 'rollbackPlan', 'validationPlan', 'checklist'],
  },
};

/** Colonne SQL correspondant à une propriété du contrat. */
export function colonne(propriete: string): string {
  return propriete.replaceAll(/[A-Z]/g, (lettre) => `_${lettre.toLowerCase()}`);
}
