/**
 * Contrats partages entre l'API, l'interface et les plugins.
 *
 * Tout ce qui traverse une frontiere de processus est decrit ici une seule fois,
 * sous forme de schema Zod, dont les types TypeScript sont deduits. Un schema est
 * a la fois la documentation, la validation a l'execution et le type statique.
 */
import { z } from 'zod';

/** Reponse du point de sante de l'API. */
export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});
export type Health = z.infer<typeof healthSchema>;

/** Langues prises en charge par l'interface et les modeles de notification. */
export const localeSchema = z.enum(['fr', 'en']);
export type Locale = z.infer<typeof localeSchema>;
export const DEFAULT_LOCALE: Locale = 'fr';
