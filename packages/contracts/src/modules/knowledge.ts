import { z } from 'zod';
import { queryBoolean } from './common.js';

export const kbTargetTypeSchema = z.enum(['profile', 'group', 'user']);
export type KbTargetType = z.infer<typeof kbTargetTypeSchema>;

export const kbCategorySchema = z.object({
  id: z.number().int().positive(),
  parentId: z.number().int().nullable(),
  name: z.string(),
  completeName: z.string(),
  path: z.string(),
  level: z.number().int(),
});
export type KbCategory = z.infer<typeof kbCategorySchema>;

export const upsertKbCategorySchema = z.object({
  parentId: z.number().int().positive().nullish(),
  name: z.string().min(1).max(120),
  comment: z.string().max(2000).nullish(),
  isRecursive: z.boolean().default(true),
});
export type UpsertKbCategory = z.infer<typeof upsertKbCategorySchema>;

/** Article tel que la liste et la fiche l'affichent. */
export const kbArticleSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  content: z.string(),
  categoryId: z.number().int().nullable(),
  categoryName: z.string().nullable(),
  isFaq: z.boolean(),
  isPublished: z.boolean(),
  viewCount: z.number().int().nonnegative(),
  version: z.number().int().positive(),
  entityId: z.number().int(),
  entityName: z.string(),
  isRecursive: z.boolean(),
  isFavorite: z.boolean(),
  author: z.string().nullable(),
  updatedAt: z.string(),
  targets: z.array(z.object({ targetType: kbTargetTypeSchema, targetId: z.number().int() })),
});
export type KbArticle = z.infer<typeof kbArticleSchema>;

/** Entree de liste : le contenu complet n'y est pas, seul un extrait. */
export const kbArticleSummarySchema = kbArticleSchema
  .omit({ content: true, targets: true })
  .extend({ excerpt: z.string() });
export type KbArticleSummary = z.infer<typeof kbArticleSummarySchema>;

export const upsertKbArticleSchema = z.object({
  name: z.string().min(1).max(255),
  content: z.string().max(200_000),
  categoryId: z.number().int().positive().nullish(),
  /**
   * Publie l'article dans la FAQ publique.
   *
   * Ce n'est pas un classement mais une **publication** : l'article devient
   * lisible sans compte par quiconque a l'adresse.
   */
  isFaq: z.boolean().default(false),
  isPublished: z.boolean().default(true),
  isRecursive: z.boolean().default(true),
  targets: z
    .array(z.object({ targetType: kbTargetTypeSchema, targetId: z.number().int().positive() }))
    .max(50)
    .default([]),
});
export type UpsertKbArticle = z.infer<typeof upsertKbArticleSchema>;

export const kbRevisionSchema = z.object({
  version: z.number().int().positive(),
  name: z.string(),
  content: z.string(),
  author: z.string().nullable(),
  createdAt: z.string(),
});
export type KbRevision = z.infer<typeof kbRevisionSchema>;

export const kbQuerySchema = z.object({
  search: z.string().max(200).optional(),
  categoryId: z.coerce.number().int().positive().optional(),
  faqOnly: queryBoolean.default(false),
  favoritesOnly: queryBoolean.default(false),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type KbQuery = z.infer<typeof kbQuerySchema>;

/** Article de la FAQ publique : ni auteur, ni entite, ni compteur interne. */
export const publicArticleSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  content: z.string(),
  categoryName: z.string().nullable(),
  updatedAt: z.string(),
});
export type PublicArticle = z.infer<typeof publicArticleSchema>;

export const publicArticleSummarySchema = publicArticleSchema
  .omit({ content: true })
  .extend({ excerpt: z.string() });
export type PublicArticleSummary = z.infer<typeof publicArticleSummarySchema>;
