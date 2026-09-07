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

/**
 * Création ou modification d'une catégorie.
 *
 * Ni `path` ni `completeName` : la base les calcule au déclencheur, à partir du
 * parent. Les laisser écrire par l'appelant permettrait de composer un chemin
 * incohérent avec la hiérarchie réelle, que plus rien ne rattraperait.
 */
export const upsertItilCategorySchema = z.object({
  name: z.string().min(1).max(200),
  parentId: z.number().int().positive().nullish(),
  comment: z.string().max(2000).nullish(),

  /**
   * Proposée au guichet.
   *
   * Une catégorie sert à deux publics : celui qui ouvre la demande, et celui
   * qui la traite. « Escalade niveau 3 » a du sens pour le second et n'en a
   * aucun pour le premier — d'où ce drapeau, plutôt que deux référentiels.
   */
  isHelpdeskVisible: z.boolean().default(true),

  /**
   * Objets auxquels la catégorie s'applique.
   *
   * Les quatre à faux donneraient une catégorie que rien ne peut choisir : le
   * serveur refuse, plutôt que de laisser une ligne inerte dans le référentiel.
   */
  forIncident: z.boolean().default(true),
  forRequest: z.boolean().default(true),
  forProblem: z.boolean().default(true),
  forChange: z.boolean().default(true),

  /** Utilisable dans les sous-entités, et pas seulement dans la sienne. */
  isRecursive: z.boolean().default(true),
});
export type UpsertItilCategory = z.infer<typeof upsertItilCategorySchema>;

/** Catégorie vue depuis l'écran de configuration : tout ce qui se règle. */
export const itilCategoryDetailSchema = itilCategorySchema.extend({
  comment: z.string().nullable(),
  isHelpdeskVisible: z.boolean(),
  forIncident: z.boolean(),
  forRequest: z.boolean(),
  forProblem: z.boolean(),
  forChange: z.boolean(),
  isRecursive: z.boolean(),
  entityId: z.number().int(),
  entityName: z.string(),
  /** Nombre de filles : une catégorie qui en a ne se supprime pas. */
  childCount: z.number().int().nonnegative(),
});
export type ItilCategoryDetail = z.infer<typeof itilCategoryDetailSchema>;
