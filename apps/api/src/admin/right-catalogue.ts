import type { RightScope } from '@tick/contracts';

/**
 * Catalogue des droits configurables.
 *
 * Liste explicite, et non déduite de ce que le code exige : un droit qui
 * n'apparaît pas ici resterait invisible dans l'écran des profils, donc
 * impossible à accorder. Chaque entrée ajoutée au cœur doit y figurer, et c'est
 * précisément ce que le test d'intégration vérifie — il compare cette liste aux
 * droits que la graine distribue.
 *
 * Les portées sont restreintes par objet. Un modèle de notification
 * n'appartient à personne : lui proposer « les miens » enverrait
 * l'administrateur chercher pendant un quart d'heure pourquoi le choix ne
 * change rien.
 */
export interface CatalogueEntry {
  object: string;
  labelKey: string;
  group: 'itil' | 'connaissance' | 'configuration' | 'administration';
  actions: readonly string[];
  scopes: readonly RightScope[];
}

/** Portées d'un objet dont les lignes appartiennent à quelqu'un. */
const PORTEES_ITIL: readonly RightScope[] = ['own', 'group', 'entity', 'recursive', 'all'];

/** Portées d'un objet de configuration : seul le périmètre compte. */
const PORTEES_CONFIG: readonly RightScope[] = ['entity', 'recursive', 'all'];

export const RIGHT_CATALOGUE: readonly CatalogueEntry[] = [
  {
    object: 'ticket',
    labelKey: 'tickets.titre',
    group: 'itil',
    actions: ['read', 'create', 'update', 'delete'],
    scopes: PORTEES_ITIL,
  },
  {
    object: 'problem',
    labelKey: 'itil.problemes.titre',
    group: 'itil',
    actions: ['read', 'create', 'update', 'delete'],
    scopes: PORTEES_ITIL,
  },
  {
    object: 'change',
    labelKey: 'itil.changements.titre',
    group: 'itil',
    actions: ['read', 'create', 'update', 'delete'],
    scopes: PORTEES_ITIL,
  },
  {
    object: 'planning',
    labelKey: 'planning.titre',
    group: 'itil',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'recurrence',
    labelKey: 'recurrence.titre',
    group: 'itil',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'stats',
    labelKey: 'statistiques.titre',
    group: 'itil',
    actions: ['read'],
    scopes: PORTEES_CONFIG,
  },

  {
    object: 'kb',
    labelKey: 'connaissance.titre',
    group: 'connaissance',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'form',
    labelKey: 'formulaires.titre',
    group: 'connaissance',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },

  {
    object: 'slm',
    labelKey: 'engagements.titre',
    group: 'configuration',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'rule',
    labelKey: 'regles.titre',
    group: 'configuration',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'notification',
    labelKey: 'notifications.titre',
    group: 'configuration',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'mailcollector',
    labelKey: 'courriel.titre',
    group: 'configuration',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'satisfaction',
    labelKey: 'enquetes.titre',
    group: 'configuration',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },

  {
    object: 'entity',
    labelKey: 'entites.titre',
    group: 'administration',
    actions: ['read', 'create', 'update', 'delete'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'user',
    labelKey: 'administration.utilisateurs.titre',
    group: 'administration',
    actions: ['read', 'create', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'group',
    labelKey: 'administration.groupes.titre',
    group: 'administration',
    actions: ['read', 'create', 'update', 'delete'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'profile',
    labelKey: 'administration.profils.titre',
    group: 'administration',
    actions: ['read', 'update'],
    scopes: PORTEES_CONFIG,
  },
  {
    object: 'plugin',
    labelKey: 'administration.plugins',
    group: 'administration',
    actions: ['read', 'update', 'delete'],
    scopes: PORTEES_CONFIG,
  },
];

/** Vrai si le couple objet/action est configurable, plugins compris. */
export function estConnu(object: string, action: string): boolean {
  // Les plugins nomment leurs objets `plugin:<id>:<objet>`. Les valider un par
  // un supposerait de connaitre les extensions installees au moment ou le droit
  // est enregistre ; le prefixe suffit a distinguer une saisie d'une erreur.
  if (object.startsWith('plugin:')) return /^[a-z][a-z0-9_-]*$/.test(action);

  return RIGHT_CATALOGUE.some(
    (entree) => entree.object === object && entree.actions.includes(action),
  );
}
