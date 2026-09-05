import { z } from 'zod';

/** Langues prises en charge par l'interface et les modeles de notification. */
export const localeSchema = z.enum(['fr', 'en']);
export type Locale = z.infer<typeof localeSchema>;
export const DEFAULT_LOCALE: Locale = 'fr';

/** Reponse du point de sante de l'API. */
export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type Health = z.infer<typeof healthSchema>;

/**
 * Portee d'un droit, toujours combinee a l'entite active.
 * Voir docs/03-entites-droits-securite.md.
 */
export const rightScopeSchema = z.enum(['own', 'group', 'entity', 'recursive', 'all']);
export type RightScope = z.infer<typeof rightScopeSchema>;

export const profileInterfaceSchema = z.enum(['standard', 'self_service']);
export type ProfileInterface = z.infer<typeof profileInterfaceSchema>;
