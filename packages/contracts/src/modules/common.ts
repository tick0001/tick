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
 * Ce qu'une instance dit d'elle-meme avant toute authentification.
 *
 * Sert l'ecran de connexion, seul endroit ou l'on peut s'adresser a quelqu'un
 * qui n'est pas encore entre : horaires du support, numero d'astreinte,
 * maintenance annoncee.
 */
export const instanceInfoSchema = z.object({
  /** `null` quand l'exploitant n'a rien a dire — le cas courant. */
  banner: z.string().max(500).nullable(),
});
export type InstanceInfo = z.infer<typeof instanceInfoSchema>;

/**
 * Portee d'un droit, toujours combinee a l'entite active.
 * Voir docs/03-entites-droits-securite.md.
 */
export const rightScopeSchema = z.enum(['own', 'group', 'entity', 'recursive', 'all']);
export type RightScope = z.infer<typeof rightScopeSchema>;

export const profileInterfaceSchema = z.enum(['standard', 'self_service']);
export type ProfileInterface = z.infer<typeof profileInterfaceSchema>;

/**
 * Booleen venant d'une chaine de requete.
 *
 * `z.coerce.boolean()` ne convient pas : il applique la veracite JavaScript, ou
 * la chaine `"false"` vaut vrai. Un filtre qui s'active quand on le desactive
 * est le genre de bug qu'on met longtemps a croire.
 */
export const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((valeur) => valeur === true || valeur === 'true' || valeur === '1');
