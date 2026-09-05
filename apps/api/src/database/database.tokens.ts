/**
 * Jetons d'injection de la couche donnees.
 *
 * Isoles du module qui les fournit : le service les consomme, le module les
 * declare, et les deux s'importeraient mutuellement s'ils vivaient ensemble.
 */

/** Connexion proprietaire : migrations et amorcage. Non soumise au RLS. */
export const OWNER_DB = Symbol('OWNER_DB');

/** Connexion applicative : tout le trafic normal. Soumise au RLS. */
export const APP_DB = Symbol('APP_DB');

/** Les deux connexions, pour la fermeture propre a l'arret. */
export const DB_CONNECTIONS = Symbol('DB_CONNECTIONS');
