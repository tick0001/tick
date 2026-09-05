import { customType } from 'drizzle-orm/pg-core';

/**
 * Chemin hierarchique PostgreSQL (extension ltree).
 *
 * Represente la position d'une entite dans l'arbre, par exemple
 * `racine.filiale_nord.site_a`. L'operateur `<@` teste l'appartenance a un
 * sous-arbre en une comparaison indexable, la ou GLPI maintient des caches
 * d'ancetres et de descendants a invalider a chaque deplacement.
 */
export const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'ltree';
  },
});

/** Texte insensible a la casse (extension citext) : identifiants et adresses. */
export const citext = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'citext';
  },
});
