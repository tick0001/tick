import { Injectable, Logger } from '@nestjs/common';
import type { SearchFieldType, SearchOperator } from '@tick/contracts';
import { sql, type SQL } from '@tick/db';

export interface SearchableField {
  key: string;
  /** Clé de traduction, résolue au moment de servir la liste. */
  labelKey: string;
  type: SearchFieldType;
  operators: readonly SearchOperator[];
  /**
   * Expression SQL de la colonne.
   *
   * Fournie par le déclarant, **jamais** construite à partir de la requête :
   * c'est ce qui rend le moteur sûr. Un critère ne peut nommer qu'une clé
   * enregistrée, et l'expression associée est du SQL écrit à l'avance.
   */
  column: SQL;
  options?: readonly string[];
  /** Plugin déclarant, pour retirer ses champs à la désactivation. */
  pluginId?: string;
}

const TEXTE: readonly SearchOperator[] = [
  'eq',
  'ne',
  'contains',
  'startsWith',
  'isNull',
  'isNotNull',
];
const NOMBRE: readonly SearchOperator[] = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'in'];
const ENUM: readonly SearchOperator[] = ['eq', 'ne', 'in'];
const DATE: readonly SearchOperator[] = ['lt', 'lte', 'gt', 'gte', 'isNull', 'isNotNull'];
const REFERENCE: readonly SearchOperator[] = ['eq', 'ne', 'in', 'isNull', 'isNotNull'];

/**
 * Registre des champs interrogeables.
 *
 * Sépare ce que l'utilisateur nomme — une clé — de ce que la base exécute — une
 * expression SQL écrite par le développeur. Sans cette séparation, un moteur de
 * recherche multi-critères revient à laisser l'utilisateur composer la clause
 * `WHERE`.
 *
 * Les plugins alimentent ce registre : c'est ainsi qu'un champ additionnel
 * devient cherchable et exportable sans toucher au cœur.
 */
@Injectable()
export class SearchRegistry {
  private readonly logger = new Logger(SearchRegistry.name);
  private readonly champs = new Map<string, SearchableField>();

  constructor() {
    this.registerCoreFields();
  }

  register(champ: SearchableField): void {
    if (this.champs.has(champ.key)) {
      this.logger.warn(`Champ de recherche deja declare, ignore : ${champ.key}`);

      return;
    }

    this.champs.set(champ.key, champ);
  }

  unregisterPlugin(pluginId: string): void {
    for (const [cle, champ] of this.champs) {
      if (champ.pluginId === pluginId) this.champs.delete(cle);
    }
  }

  get(key: string): SearchableField | undefined {
    return this.champs.get(key);
  }

  list(): SearchableField[] {
    return [...this.champs.values()].sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Champs du cœur pour le ticket.
   *
   * Les jointures sont exprimées en sous-requêtes plutôt qu'en `JOIN` : le
   * compilateur produit une clause `WHERE` seule, sans avoir à réécrire le
   * `FROM` selon les critères choisis.
   */
  private registerCoreFields(): void {
    const champs: SearchableField[] = [
      {
        key: 'ticket.name',
        labelKey: 'recherche.champs.titre',
        type: 'text',
        operators: TEXTE,
        column: sql`tickets.name`,
      },
      {
        key: 'ticket.content',
        labelKey: 'recherche.champs.description',
        type: 'text',
        operators: TEXTE,
        column: sql`tickets.content`,
      },
      {
        key: 'ticket.status',
        labelKey: 'recherche.champs.statut',
        type: 'enum',
        operators: ENUM,
        column: sql`tickets.status::text`,
        options: ['new', 'assigned', 'planned', 'waiting', 'solved', 'closed'],
      },
      {
        key: 'ticket.type',
        labelKey: 'recherche.champs.type',
        type: 'enum',
        operators: ENUM,
        column: sql`tickets.type::text`,
        options: ['incident', 'request'],
      },
      {
        key: 'ticket.priority',
        labelKey: 'recherche.champs.priorite',
        type: 'number',
        operators: NOMBRE,
        column: sql`tickets.priority`,
      },
      {
        key: 'ticket.urgency',
        labelKey: 'recherche.champs.urgence',
        type: 'number',
        operators: NOMBRE,
        column: sql`tickets.urgency`,
      },
      {
        key: 'ticket.impact',
        labelKey: 'recherche.champs.impact',
        type: 'number',
        operators: NOMBRE,
        column: sql`tickets.impact`,
      },
      {
        key: 'ticket.category',
        labelKey: 'recherche.champs.categorie',
        type: 'reference',
        operators: REFERENCE,
        column: sql`tickets.category_id`,
      },
      {
        key: 'ticket.entity',
        labelKey: 'recherche.champs.entite',
        type: 'reference',
        operators: REFERENCE,
        column: sql`tickets.entity_id`,
      },
      {
        key: 'ticket.dateOpened',
        labelKey: 'recherche.champs.ouvertLe',
        type: 'date',
        operators: DATE,
        column: sql`tickets.date_opened`,
      },
      {
        key: 'ticket.dateDue',
        labelKey: 'recherche.champs.echeance',
        type: 'date',
        operators: DATE,
        column: sql`tickets.date_due`,
      },
      {
        key: 'ticket.internalTime',
        labelKey: 'recherche.champs.tempsInterne',
        type: 'number',
        operators: NOMBRE,
        column: sql`tickets.internal_time`,
      },
      {
        // Le demandeur n'est pas une colonne : c'est une ligne de la table des
        // acteurs. La sous-requête garde le critère utilisable comme un champ
        // ordinaire du point de vue de l'utilisateur.
        key: 'ticket.requester',
        labelKey: 'recherche.champs.demandeur',
        type: 'reference',
        operators: ['eq', 'ne', 'in'],
        column: sql`(
          SELECT a.actor_id FROM itil_actors a
           WHERE a.itil_type = 'ticket' AND a.itil_id = tickets.id
             AND a.role = 'requester' AND a.actor_type = 'user'
           LIMIT 1
        )`,
      },
      {
        key: 'ticket.assignee',
        labelKey: 'recherche.champs.attribue',
        type: 'reference',
        operators: ['eq', 'ne', 'in'],
        column: sql`(
          SELECT a.actor_id FROM itil_actors a
           WHERE a.itil_type = 'ticket' AND a.itil_id = tickets.id
             AND a.role = 'assigned' AND a.actor_type = 'user'
           LIMIT 1
        )`,
      },
    ];

    for (const champ of champs) this.register(champ);
  }
}
