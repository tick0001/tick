import { z } from 'zod';

/**
 * Opérateurs de recherche.
 *
 * Volontairement peu nombreux et explicites. Chaque champ déclare ceux qui
 * s'appliquent à lui : proposer « commence par » sur une date n'a pas de sens,
 * et laisser l'interface le proposer produit des recherches qui échouent.
 */
export const searchOperatorSchema = z.enum([
  'eq',
  'ne',
  'contains',
  'startsWith',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'isNull',
  'isNotNull',
]);
export type SearchOperator = z.infer<typeof searchOperatorSchema>;

export const searchFieldTypeSchema = z.enum([
  'text',
  'number',
  'enum',
  'date',
  'boolean',
  'reference',
]);
export type SearchFieldType = z.infer<typeof searchFieldTypeSchema>;

/** Description d'un champ interrogeable, telle que l'interface la reçoit. */
export const searchFieldSchema = z.object({
  key: z.string(),
  /** Libellé déjà traduit par le serveur, selon la langue de la session. */
  label: z.string(),
  type: searchFieldTypeSchema,
  operators: z.array(searchOperatorSchema),
  /** Valeurs possibles pour un champ énuméré. */
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  /** Plugin qui a déclaré ce champ, absent pour les champs du cœur. */
  pluginId: z.string().optional(),
});
export type SearchField = z.infer<typeof searchFieldSchema>;

/**
 * Arbre de critères.
 *
 * Récursif à dessein : « (statut = nouveau OU statut = en cours) ET priorité
 * >= 4 » ne s'exprime pas avec une liste plate, et c'est exactement le genre de
 * recherche qu'un superviseur enregistre.
 */
export interface SearchNode {
  kind: 'criterion' | 'group';
  field?: string;
  operator?: SearchOperator;
  value?: unknown;
  link?: 'and' | 'or';
  children?: SearchNode[];
}

export const searchNodeSchema: z.ZodType<SearchNode> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('criterion'),
      field: z.string().min(1).max(120),
      operator: searchOperatorSchema,
      value: z.unknown().optional(),
    }),
    z.object({
      kind: z.literal('group'),
      link: z.enum(['and', 'or']).default('and'),
      // Profondeur bornée : un arbre arbitrairement profond produit une requête
      // arbitrairement coûteuse, et aucune recherche utile n'en a besoin.
      children: z.array(searchNodeSchema).max(50),
    }),
  ]),
);

export const searchRequestSchema = z.object({
  criteria: searchNodeSchema.optional(),
  sort: z.enum(['dateOpened', 'priority', 'dateDue', 'status']).default('dateOpened'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(200).default(50),
  deleted: z.boolean().default(false),
});
export type SearchRequest = z.infer<typeof searchRequestSchema>;

// --- Recherches sauvegardées -------------------------------------------------

export const savedSearchSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  target: z.string(),
  isPublic: z.boolean(),
  isPinned: z.boolean(),
  isMine: z.boolean(),
  criteria: searchNodeSchema,
  owner: z.string(),
});
export type SavedSearch = z.infer<typeof savedSearchSchema>;

export const saveSearchSchema = z.object({
  name: z.string().min(1).max(120),
  target: z.string().default('ticket'),
  isPublic: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  criteria: searchNodeSchema,
});
export type SaveSearch = z.infer<typeof saveSearchSchema>;
