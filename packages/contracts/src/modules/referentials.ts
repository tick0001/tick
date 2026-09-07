import { z } from 'zod';
import { queryBoolean } from './common.js';
import { itilTypeSchema } from './itil-objects.js';

/**
 * Référentiels que l'on choisit en remplissant un objet ITIL.
 *
 * Ils sont en lecture seule ici : les créer et les organiser relève de la
 * configuration, qui viendra sur ses propres écrans. Ce que ce module expose,
 * c'est ce qu'il faut pour **choisir** — et rien de plus, parce qu'une liste
 * déroulante n'a que faire des dates d'audit ou des affectations par défaut.
 */

export const itilCategorySchema = z.object({
  id: z.number().int().positive(),
  /** Nom seul, tel qu'il est saisi. */
  name: z.string(),
  /**
   * Nom complet, ancêtres inclus : « Matériel > Impression ».
   *
   * C'est lui qu'une liste déroulante affiche. Le nom seul rendrait
   * indistinguables deux « Installation » vivant sous deux branches.
   */
  completeName: z.string(),
  parentId: z.number().int().nullable(),
  /** Profondeur dans l'arbre, pour indenter sans recalculer. */
  level: z.number().int().nonnegative(),
});
export type ItilCategory = z.infer<typeof itilCategorySchema>;

/**
 * Filtre des catégories.
 *
 * Une catégorie déclare à quels objets elle s'applique : proposer une catégorie
 * de changement à l'ouverture d'un incident produirait un classement que les
 * rapports ne sauraient pas lire.
 *
 * La visibilité côté demandeur n'est **pas** un paramètre : c'est le serveur qui
 * la décide d'après l'interface du profil actif. La laisser au client
 * permettrait de la demander, et un référentiel interne se retrouverait dans la
 * liste déroulante d'un guichet public.
 */
export const itilCategoryFilterSchema = z.object({
  type: itilTypeSchema.optional(),
  /** Restreint aux catégories qui acceptent d'être choisies. */
  selectable: queryBoolean.default(true),
});
export type ItilCategoryFilter = z.infer<typeof itilCategoryFilterSchema>;
