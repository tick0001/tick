/**
 * Le schema de manifeste n'est volontairement pas reexporte ici : il repose sur
 * Zod, que l'hote embarque deja et qu'un plugin n'a aucune raison d'emporter.
 * Il vit dans `@tick/plugin-sdk/manifest`.
 */

/**
 * Surface serveur offerte aux plugins.
 *
 * **Phase `0.x`.** La mécanique d'extension est construite avant le métier,
 * mais ce qu'elle expose est dérivé du domaine réel au fur et à mesure : cette
 * surface peut donc rompre sans cérémonie jusqu'au gel en `1.0`, qui n'aura
 * lieu que lorsque chaque point d'extension sera exercé par un usage véritable.
 */

/** Journal préfixé par l'identifiant du plugin. */
export interface PluginLogger {
  debug(message: string): void;
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/**
 * Accès aux données du plugin.
 *
 * Le `search_path` de la connexion est restreint au schéma du plugin : une
 * requête sans préfixe de schéma ne peut atteindre que ses propres tables. Le
 * cœur reste accessible en le nommant explicitement, et reste protégé par le
 * Row-Level Security.
 */
export interface PluginDatabase {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface PluginContext {
  readonly id: string;
  readonly version: string;
  readonly schema: string;
  readonly logger: PluginLogger;
  readonly db: PluginDatabase;
}

/**
 * Hooks : synchrones, dans la transaction, capables de modifier la donnée ou
 * d'annuler l'opération en levant une exception.
 *
 * Un hook reçoit la charge utile et renvoie soit une version modifiée, soit
 * rien pour la laisser inchangée.
 */
export interface HookPayloads {
  'entity.beforeCreate': { name: string; parentId: number; comment: string | null };
  'entity.beforeUpdate': {
    id: number;
    changes: { name?: string; comment?: string | null; parentId?: number };
  };
}

/**
 * Événements : asynchrones, publiés **après** le commit.
 *
 * Ils ne peuvent ni modifier ni annuler quoi que ce soit, et sont réessayés en
 * cas d'échec. C'est la voie des notifications, des statistiques et des
 * synchronisations — tout ce qui ne doit pas se produire si la transaction
 * échoue, ni faire échouer la transaction.
 */
export interface EventPayloads {
  'entity.created': { id: number; name: string; path: string };
  'entity.updated': { id: number; name: string };
  'entity.deleted': { id: number };
  'plugin.activated': { pluginId: string };
}

export type HookName = keyof HookPayloads;
export type EventName = keyof EventPayloads;

export type HookHandler<K extends HookName> = (
  payload: HookPayloads[K],
  context: PluginContext,
) => HookPayloads[K] | void | Promise<HookPayloads[K] | void>;

export type EventHandler<K extends EventName> = (
  payload: EventPayloads[K],
  context: PluginContext,
) => void | Promise<void>;

export interface HookOptions {
  /** Ordre d'exécution croissant. Défaut : 100. */
  priority?: number;
}

export interface PluginApi {
  readonly context: PluginContext;

  hooks: {
    on<K extends HookName>(name: K, handler: HookHandler<K>, options?: HookOptions): void;
  };

  events: {
    on<K extends EventName>(name: K, handler: EventHandler<K>): void;
  };
}

export interface PluginDefinition {
  /** Appelé une fois, après création du schéma et application des migrations. */
  install?(context: PluginContext): void | Promise<void>;
  /** Appelé lors d'une montée de version, avec la version précédente. */
  upgrade?(context: PluginContext, previousVersion: string): void | Promise<void>;
  /** Appelé avant la suppression du schéma. */
  uninstall?(context: PluginContext): void | Promise<void>;
  /** Appelé à chaque activation : c'est ici que tout s'enregistre. */
  register(api: PluginApi): void | Promise<void>;
}

/** Déclare un plugin serveur. Sert de point d'ancrage au typage. */
export function definePlugin(definition: PluginDefinition): PluginDefinition {
  return definition;
}
