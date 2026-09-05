import { Injectable, Logger } from '@nestjs/common';
import type { RuleActionType, RuleCollection, RuleFieldType, RuleOperator } from '@tick/contracts';

/**
 * Champ manipulable par une règle.
 *
 * Même principe que le registre de recherche : l'utilisateur nomme une **clé**,
 * jamais une colonne. Sans ce catalogue, une règle pourrait désigner n'importe
 * quel attribut de l'objet, et une action « affecter » deviendrait une écriture
 * arbitraire en base.
 */
export interface RuleFieldDefinition {
  key: string;
  /** Clé de traduction, résolue au moment de servir le catalogue. */
  labelKey: string;
  type: RuleFieldType;
  /** Opérateurs autorisés en critère. Vide : le champ ne sert qu'en action. */
  operators: readonly RuleOperator[];
  /** Types d'action autorisés. Vide : le champ ne sert qu'en critère. */
  actions: readonly RuleActionType[];
  options?: readonly { value: string; labelKey: string }[];
  /** Plugin déclarant, pour retirer ses champs à la désactivation. */
  pluginId?: string;
}

const TEXTE: readonly RuleOperator[] = [
  'is',
  'is_not',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'regex',
  'not_regex',
  'is_empty',
  'is_not_empty',
];
const EXACT: readonly RuleOperator[] = ['is', 'is_not', 'is_empty', 'is_not_empty'];
const ARBRE: readonly RuleOperator[] = ['is', 'is_not', 'under', 'not_under'];

const TEXTE_ACTIONS: readonly RuleActionType[] = ['assign', 'append', 'regex_result', 'clear'];
const VALEUR_ACTIONS: readonly RuleActionType[] = ['assign', 'clear'];
const AFFECTER: readonly RuleActionType[] = ['assign'];

function champ(
  key: string,
  labelKey: string,
  type: RuleFieldType,
  operators: readonly RuleOperator[],
  actions: readonly RuleActionType[],
  options?: readonly { value: string; labelKey: string }[],
): RuleFieldDefinition {
  return { key, labelKey, type, operators, actions, ...(options ? { options } : {}) };
}

const echelle = [1, 2, 3, 4, 5].map((niveau) => ({
  value: String(niveau),
  labelKey: `tickets.priorites.p${String(niveau)}`,
}));

/**
 * Champs des collections de tickets.
 *
 * Identiques à la création et à la modification : ce qui change, c'est le
 * moment de l'évaluation, pas le vocabulaire. Les dupliquer inviterait à ce
 * que les deux listes divergent.
 */
function champsTicket(): RuleFieldDefinition[] {
  return [
    champ('name', 'regles.champs.titre', 'text', TEXTE, TEXTE_ACTIONS),
    champ('content', 'regles.champs.description', 'text', TEXTE, TEXTE_ACTIONS),
    champ('type', 'regles.champs.type', 'enum', EXACT, AFFECTER, [
      { value: 'incident', labelKey: 'tickets.types.incident' },
      { value: 'request', labelKey: 'tickets.types.request' },
    ]),
    champ('status', 'regles.champs.statut', 'enum', EXACT, AFFECTER, [
      { value: 'new', labelKey: 'tickets.statuts.new' },
      { value: 'assigned', labelKey: 'tickets.statuts.assigned' },
      { value: 'planned', labelKey: 'tickets.statuts.planned' },
      { value: 'waiting', labelKey: 'tickets.statuts.waiting' },
      { value: 'solved', labelKey: 'tickets.statuts.solved' },
      { value: 'closed', labelKey: 'tickets.statuts.closed' },
    ]),
    champ('urgency', 'regles.champs.urgence', 'number', EXACT, AFFECTER, echelle),
    champ('impact', 'regles.champs.impact', 'number', EXACT, AFFECTER, echelle),
    // La priorité est dérivée de l'urgence et de l'impact, mais reste
    // affectable : une règle « incident sur le SI de paie » doit pouvoir passer
    // outre la matrice sans avoir à mentir sur l'urgence.
    champ('priority', 'regles.champs.priorite', 'number', EXACT, AFFECTER, echelle),
    champ('categoryId', 'regles.champs.categorie', 'reference', EXACT, VALEUR_ACTIONS),
    champ('categoryPath', 'regles.champs.arborescenceCategorie', 'tree', ARBRE, []),
    champ('requestSourceId', 'regles.champs.source', 'reference', EXACT, VALEUR_ACTIONS),
    champ('locationId', 'regles.champs.lieu', 'reference', EXACT, VALEUR_ACTIONS),
    champ('entityId', 'regles.champs.entite', 'reference', EXACT, []),
    champ('entityPath', 'regles.champs.arborescenceEntite', 'tree', ARBRE, []),
    champ('requesterId', 'regles.champs.demandeur', 'reference', EXACT, []),
    champ('requesterEmail', 'regles.champs.courrielDemandeur', 'text', TEXTE, []),
    champ('requesterGroups', 'regles.champs.groupesDemandeur', 'text', TEXTE, []),
    champ('assignedGroupId', 'regles.champs.groupeAttribue', 'reference', EXACT, VALEUR_ACTIONS),
    champ('assignedUserId', 'regles.champs.technicien', 'reference', EXACT, VALEUR_ACTIONS),
    champ('observerUserId', 'regles.champs.observateur', 'reference', [], AFFECTER),
    champ('slaTtoId', 'regles.champs.slaPriseEnCompte', 'reference', EXACT, VALEUR_ACTIONS),
    champ('slaTtrId', 'regles.champs.slaResolution', 'reference', EXACT, VALEUR_ACTIONS),
    champ('olaTtoId', 'regles.champs.olaPriseEnCompte', 'reference', EXACT, VALEUR_ACTIONS),
    champ('olaTtrId', 'regles.champs.olaResolution', 'reference', EXACT, VALEUR_ACTIONS),
  ];
}

/** Champs issus de l'annuaire, communs aux deux collections d'affectation. */
function champsAnnuaire(): RuleFieldDefinition[] {
  return [
    champ('uid', 'regles.champs.identifiant', 'text', TEXTE, []),
    champ('mail', 'regles.champs.courriel', 'text', TEXTE, []),
    champ('domain', 'regles.champs.domaine', 'text', TEXTE, []),
    champ('dn', 'regles.champs.dn', 'text', TEXTE, []),
    champ('commonName', 'regles.champs.nomComplet', 'text', TEXTE, []),
    champ('department', 'regles.champs.service', 'text', TEXTE, []),
    // Les groupes arrivent aplatis en une chaîne séparée par des barres
    // verticales : `contient` y répond correctement, et le format reste lisible
    // dans le simulateur.
    champ('groups', 'regles.champs.groupes', 'text', TEXTE, []),
  ];
}

const CATALOGUE: Record<RuleCollection, RuleFieldDefinition[]> = {
  'ticket.create': champsTicket(),
  'ticket.update': champsTicket(),
  'authorization.assign': [
    ...champsAnnuaire(),
    champ('profileId', 'regles.champs.profil', 'reference', EXACT, AFFECTER),
    champ('entityId', 'regles.champs.entite', 'reference', EXACT, AFFECTER),
    champ('isRecursive', 'regles.champs.recursif', 'boolean', EXACT, AFFECTER),
  ],
  'entity.assign': [
    ...champsAnnuaire(),
    champ('entityId', 'regles.champs.entite', 'reference', EXACT, AFFECTER),
    champ('isRecursive', 'regles.champs.recursif', 'boolean', EXACT, AFFECTER),
  ],
  // Le dictionnaire normalise le texte avant tout le reste : il ne décide rien,
  // il réécrit. D'où un catalogue volontairement réduit aux champs libres.
  'dictionary.ticket': [
    champ('name', 'regles.champs.titre', 'text', TEXTE, TEXTE_ACTIONS),
    champ('content', 'regles.champs.description', 'text', TEXTE, TEXTE_ACTIONS),
  ],
};

/**
 * Catalogue des champs, par collection.
 *
 * Ouvert aux plugins par `register` : un plugin qui ajoute un champ au ticket
 * doit pouvoir l'utiliser dans les règles, sinon son champ reste décoratif.
 */
@Injectable()
export class RuleCatalogService {
  private readonly logger = new Logger(RuleCatalogService.name);
  private readonly ajouts = new Map<RuleCollection, RuleFieldDefinition[]>();

  register(collection: RuleCollection, definition: RuleFieldDefinition): void {
    if (this.get(collection, definition.key)) {
      this.logger.warn(`Champ de regle deja declare, ignore : ${collection}/${definition.key}`);

      return;
    }

    const existants = this.ajouts.get(collection) ?? [];

    existants.push(definition);
    this.ajouts.set(collection, existants);
  }

  unregisterPlugin(pluginId: string): void {
    for (const [collection, champs] of this.ajouts) {
      this.ajouts.set(
        collection,
        champs.filter((definition) => definition.pluginId !== pluginId),
      );
    }
  }

  list(collection: RuleCollection): RuleFieldDefinition[] {
    return [...(CATALOGUE[collection] ?? []), ...(this.ajouts.get(collection) ?? [])];
  }

  get(collection: RuleCollection, key: string): RuleFieldDefinition | undefined {
    return this.list(collection).find((definition) => definition.key === key);
  }

  /**
   * Vérifie qu'un critère est exprimable.
   *
   * Refuser à l'enregistrement plutôt qu'ignorer silencieusement à l'exécution :
   * une règle qui ne se déclenche jamais parce qu'un critère est invalide est
   * autrement impossible à diagnostiquer.
   */
  assertCriterion(collection: RuleCollection, field: string, operator: RuleOperator): void {
    const definition = this.get(collection, field);

    if (!definition) {
      throw new Error(`Champ inconnu dans ${collection} : ${field}`);
    }

    if (!definition.operators.includes(operator)) {
      throw new Error(`Operateur ${operator} inapplicable au champ ${field}`);
    }
  }

  assertAction(collection: RuleCollection, field: string, action: RuleActionType): void {
    const definition = this.get(collection, field);

    if (!definition) {
      throw new Error(`Champ inconnu dans ${collection} : ${field}`);
    }

    if (!definition.actions.includes(action)) {
      throw new Error(`Action ${action} inapplicable au champ ${field}`);
    }
  }
}
