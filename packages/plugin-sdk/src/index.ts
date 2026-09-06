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

  /**
   * Avant création d'un ticket. Le hook peut normaliser le titre, imposer une
   * catégorie, forcer une urgence — ou refuser en levant une exception.
   *
   * La priorité n'y figure pas : elle est dérivée de l'urgence et de l'impact
   * après passage des hooks, précisément pour qu'elle ne puisse pas contredire
   * ses propres termes.
   */
  'ticket.beforeCreate': {
    entityId: number;
    name: string;
    content: string;
    type: 'incident' | 'request';
    urgency: number;
    impact: number;
    categoryId: number | null;
  };

  'ticket.beforeUpdate': {
    id: number;
    changes: Record<string, unknown>;
  };

  /**
   * Avant changement de statut. C'est le point d'accroche des règles de
   * workflow : refuser une résolution sans solution, exiger une validation
   * avant clôture.
   */
  'ticket.beforeStatusChange': {
    id: number;
    from: ItilStatus;
    to: ItilStatus;
  };

  /** Avant ajout d'un suivi. Permet de filtrer ou d'enrichir le contenu. */
  'followup.beforeAdd': {
    ticketId: number;
    content: string;
    isPrivate: boolean;
  };
}

/** Statuts d'un objet ITIL, repris tels quels du cœur. */
export type ItilStatus = 'new' | 'assigned' | 'planned' | 'waiting' | 'solved' | 'closed';

/**
 * Événements : asynchrones, publiés **après** le commit.
 *
 * Ils ne peuvent ni modifier ni annuler quoi que ce soit, et sont réessayés en
 * cas d'échec. C'est la voie des notifications, des statistiques et des
 * synchronisations — tout ce qui ne doit pas se produire si la transaction
 * échoue, ni faire échouer la transaction.
 */
/** Les trois objets ITIL partageant le socle commun. */
export type ItilObjectType = 'ticket' | 'problem' | 'change';

export interface EventPayloads {
  'entity.created': { id: number; name: string; path: string };
  'entity.updated': { id: number; name: string };
  'entity.deleted': { id: number };
  'plugin.activated': { pluginId: string };

  'ticket.created': {
    id: number;
    entityId: number;
    name: string;
    type: 'incident' | 'request';
    priority: number;
  };
  'ticket.updated': { id: number; entityId: number; changedFields: string[] };
  'ticket.statusChanged': { id: number; entityId: number; from: ItilStatus; to: ItilStatus };
  'ticket.solved': { id: number; entityId: number };
  'ticket.closed': { id: number; entityId: number };
  'ticket.deleted': { id: number; entityId: number };
  /**
   * Un niveau d'escalade vient d'etre execute sur un ticket.
   *
   * Publie apres l'application des actions du niveau, pas avant : un abonne qui
   * relit le ticket doit y voir le groupe reaffecte, la priorite relevee.
   */
  'ticket.escalated': {
    id: number;
    entityId: number;
    levelId: number;
    levelName: string;
    agreementName: string;
  };

  /**
   * `authorId` fait partie de la charge utile, et non d'une relecture ulterieure.
   *
   * Un abonne qui veut notifier « l'auteur du suivi » ne peut pas le deviner :
   * le relire en base supposerait qu'il connaisse le schema du coeur, ce que le
   * contrat de plugin lui refuse justement.
   */
  'followup.added': {
    ticketId: number;
    followupId: number;
    isPrivate: boolean;
    authorId: number | null;
  };
  'task.added': { ticketId: number; taskId: number; authorId: number | null };
  'solution.proposed': { ticketId: number; solutionId: number; authorId: number | null };
  'solution.answered': { ticketId: number; solutionId: number; accepted: boolean };
  'validation.requested': { ticketId: number; validationId: number };
  'validation.answered': { ticketId: number; validationId: number; granted: boolean };

  /**
   * Une enquete de satisfaction vient d'etre envoyee.
   *
   * `url` porte le jeton : c'est la seule facon pour un modele de notification
   * de composer un lien utilisable sans compte, et pour un plugin de relayer
   * l'enquete ailleurs que par courriel.
   */
  /**
   * Problemes et changements.
   *
   * Volontairement absents du catalogue des notifications : les modeles
   * resolvent leurs destinataires dans `tickets`, et un identifiant de probleme
   * y designerait le ticket portant le meme numero. Les plugins, eux, savent de
   * quel objet on leur parle.
   */
  'problem.created': { id: number; entityId: number; name: string };
  'problem.updated': { id: number; entityId: number };
  'problem.deleted': { id: number; entityId: number };
  'change.created': { id: number; entityId: number; name: string };
  'change.updated': { id: number; entityId: number };
  'change.deleted': { id: number; entityId: number };

  'itil.linked': {
    sourceType: ItilObjectType;
    sourceId: number;
    targetType: ItilObjectType;
    targetId: number;
    linkType: 'linked' | 'duplicate' | 'child';
  };
  'itil.unlinked': { sourceType: ItilObjectType; sourceId: number; linkId: number };
  /** Un objet vient d'en engendrer un autre. L'original reste ouvert. */
  'itil.promoted': {
    fromType: ItilObjectType;
    fromId: number;
    toType: 'problem' | 'change';
    toId: number;
  };

  'satisfaction.requested': { id: number; entityId: number; token: string; url: string };
  'satisfaction.answered': { id: number; entityId: number; rating: number };
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

/** Opérateurs applicables à un champ de recherche. */
export type PluginSearchOperator =
  | 'eq'
  | 'ne'
  | 'contains'
  | 'startsWith'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'in'
  | 'isNull'
  | 'isNotNull';

export interface PluginSearchField {
  /** Clé exposée à l'interface. Préfixée par l'identifiant du plugin. */
  key: string;
  /** Libellé déjà traduit, ou clé de traduction du cœur. */
  label: string;
  type: 'text' | 'number' | 'enum' | 'date' | 'boolean' | 'reference';
  operators: PluginSearchOperator[];
  /**
   * Expression SQL de la colonne, évaluée dans le contexte d'une requête sur
   * `tickets`.
   *
   * C'est du SQL écrit par l'auteur du plugin, donc du code au même titre que
   * le reste de son extension — pas une valeur venue d'un utilisateur. Le
   * moteur n'y injecte jamais de saisie : les valeurs comparées passent en
   * paramètres liés.
   */
  sql: string;
  /** Valeurs possibles, pour un champ énuméré. */
  options?: string[];
}

export interface PluginApi {
  readonly context: PluginContext;

  hooks: {
    on<K extends HookName>(name: K, handler: HookHandler<K>, options?: HookOptions): void;
  };

  events: {
    on<K extends EventName>(name: K, handler: EventHandler<K>): void;
  };

  search: {
    /** Rend un champ interrogeable depuis la recherche multi-critères. */
    registerField(field: PluginSearchField): void;
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
