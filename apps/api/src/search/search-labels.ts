import { resources, type Locale } from '@tick/i18n';

/**
 * Traduction cote serveur d'une cle pointee.
 *
 * Les champs de recherche sont declares par le coeur **et par les plugins** :
 * l'interface ne peut donc pas connaitre a l'avance les cles a traduire, et le
 * serveur livre des libelles deja resolus. Une cle absente est renvoyee telle
 * quelle, ce qui reste diagnosticable a l'ecran.
 */
export function translate(cle: string, locale: string): string {
  const langue = (locale in resources ? locale : 'fr') as Locale;
  const valeur = cle
    .split('.')
    .reduce<unknown>(
      (courant, segment) =>
        typeof courant === 'object' && courant !== null
          ? (courant as Record<string, unknown>)[segment]
          : undefined,
      resources[langue],
    );

  return typeof valeur === 'string' ? valeur : cle;
}
