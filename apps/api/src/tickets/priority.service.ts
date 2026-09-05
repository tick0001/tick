import { Injectable } from '@nestjs/common';
import { EntitiesService } from '../entities/entities.service.js';

/**
 * Matrice par défaut, calquée sur celle de GLPI.
 *
 * Lignes : urgence de 1 à 5. Colonnes : impact de 1 à 5. Elle est volontairement
 * asymétrique — un incident très urgent mais sans impact ne monte pas aussi haut
 * qu'un incident très impactant mais peu urgent, parce que l'impact concerne
 * plusieurs personnes et l'urgence une seule.
 */
const DEFAULT_MATRIX: readonly (readonly number[])[] = [
  [1, 1, 2, 2, 2],
  [1, 2, 2, 3, 3],
  [2, 2, 3, 4, 4],
  [2, 3, 4, 4, 5],
  [2, 3, 4, 5, 5],
];

function isMatrix(valeur: unknown): valeur is number[][] {
  return (
    Array.isArray(valeur) &&
    valeur.length === 5 &&
    valeur.every(
      (ligne) =>
        Array.isArray(ligne) &&
        ligne.length === 5 &&
        ligne.every((cellule) => typeof cellule === 'number' && cellule >= 1 && cellule <= 5),
    )
  );
}

/**
 * Dérivation de la priorité à partir de l'urgence et de l'impact.
 *
 * La priorité n'est jamais saisie : elle est calculée, et recalculée dès que
 * l'un de ses deux termes change. La laisser modifiable directement ouvrirait
 * la porte à des tickets dont la priorité contredit l'urgence affichée.
 */
@Injectable()
export class PriorityService {
  constructor(private readonly entities: EntitiesService) {}

  /**
   * Matrice effective d'une entité, héritée du parent si elle n'en définit pas.
   *
   * Une matrice mal formée en base est ignorée au profit de la matrice par
   * défaut : refuser de créer des tickets parce qu'un paramètre est corrompu
   * serait une réaction disproportionnée.
   */
  async matrixFor(entityId: number): Promise<readonly (readonly number[])[]> {
    const resolue = await this.entities.resolveSetting(entityId, 'priorityMatrix');

    return isMatrix(resolue) ? resolue : DEFAULT_MATRIX;
  }

  async compute(entityId: number, urgency: number, impact: number): Promise<number> {
    const matrice = await this.matrixFor(entityId);
    const ligne = matrice[Math.min(Math.max(urgency, 1), 5) - 1];

    return ligne?.[Math.min(Math.max(impact, 1), 5) - 1] ?? 3;
  }

  /** Matrice par défaut, exposée pour l'interface de configuration. */
  static get defaultMatrix(): readonly (readonly number[])[] {
    return DEFAULT_MATRIX;
  }
}
