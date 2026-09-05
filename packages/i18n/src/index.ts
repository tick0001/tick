import { en } from './locales/en.js';
import { fr, type Traductions } from './locales/fr.js';

export type { Traductions };

/** Langues livrées. Le français est la langue source. */
export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';

export const resources: Record<Locale, Traductions> = { fr, en };

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * Choisit la langue à servir.
 *
 * Ordre de priorité : préférence explicite de l'utilisateur, puis en-tête du
 * navigateur, puis la langue par défaut. Les étiquettes régionales (`fr-CA`)
 * sont ramenées à leur langue de base plutôt que rejetées.
 */
export function negotiateLocale(...candidates: (string | null | undefined)[]): Locale {
  for (const candidate of candidates) {
    if (!candidate) continue;

    for (const tag of candidate.split(',')) {
      const base = tag.trim().split(';')[0]?.split('-')[0]?.toLowerCase();

      if (base && isLocale(base)) return base;
    }
  }

  return DEFAULT_LOCALE;
}

export { fr, en };
