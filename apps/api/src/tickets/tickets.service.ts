import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTicket,
  ItilStatus,
  RuleCollection,
  TicketActor,
  TicketActorInput,
  TicketDetail,
  TicketFilter,
  TicketPage,
  TicketSummary,
  UpdateTicket,
} from '@tick/contracts';
import { sql, tickets, type SQL } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { emitEvent } from '../plugins/event-buffer.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { RulesService } from '../rules/rules.service.js';
import { SlaService } from '../slm/sla.service.js';
import { ActorsService } from './actors.service.js';
import { HistoryService } from './history.service.js';
import { PriorityService } from './priority.service.js';
import { applyRuleOutput, borne, choix, reference, texte } from './ticket-rules.js';
import { TicketScopeService } from './ticket-scope.service.js';
import { TicketTemplatesService } from './ticket-templates.service.js';
import {
  actorLabels,
  decodeCursor,
  encodeCursor,
  followupCount,
  SORTABLE,
  taskCount,
} from './ticket-sql.js';
import { toIso, toIsoRequired, toText } from '../common/sql.js';

/**
 * Transitions autorisées.
 *
 * Explicites plutôt que « tout est permis » : un ticket clos qui repasse en
 * « nouveau » sans réouverture explicite fausse toutes les statistiques. La
 * réouverture existe, elle passe par `solved` ou `closed` vers `assigned`.
 */
/** Types de ticket, pour valider ce qu'une regle propose. */
const TYPES = ['incident', 'request'] as const;

const TRANSITIONS: Record<ItilStatus, readonly ItilStatus[]> = {
  new: ['assigned', 'planned', 'waiting', 'solved', 'closed'],
  assigned: ['new', 'planned', 'waiting', 'solved', 'closed'],
  planned: ['new', 'assigned', 'waiting', 'solved', 'closed'],
  waiting: ['new', 'assigned', 'planned', 'solved', 'closed'],
  solved: ['assigned', 'planned', 'closed'],
  closed: ['assigned'],
};

interface TicketRow {
  id: number;
  name: string;
  type: 'incident' | 'request';
  status: ItilStatus;
  urgency: number;
  impact: number;
  priority: number;
  entityId: number;
  entityName: string;
  categoryId: number | null;
  categoryName: string | null;
  dateOpened: unknown;
  dateDue: unknown;
  requesters: string[] | null;
  assignees: string[] | null;
  followupCount: number;
  taskCount: number;
}

function toSummary(row: TicketRow): TicketSummary {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    urgency: row.urgency,
    impact: row.impact,
    priority: row.priority,
    entity: { id: row.entityId, name: row.entityName },
    category: row.categoryId ? { id: row.categoryId, name: row.categoryName ?? '' } : null,
    dateOpened: toIsoRequired(row.dateOpened),
    dateDue: toIso(row.dateDue),
    requesters: row.requesters ?? [],
    assignees: row.assignees ?? [],
    followupCount: Number(row.followupCount),
    taskCount: Number(row.taskCount),
  };
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly hooks: HookBus,
    private readonly history: HistoryService,
    private readonly priority: PriorityService,
    private readonly scopes: TicketScopeService,
    private readonly templates: TicketTemplatesService,
    private readonly rules: RulesService,
    private readonly sla: SlaService,
    private readonly actors: ActorsService,
  ) {}

  /**
   * Crée un ticket.
   *
   * Ordre volontaire : les hooks passent **avant** le calcul de la priorité, de
   * sorte qu'un plugin qui modifie l'urgence voie la priorité s'ajuster. Poser
   * la priorité d'abord la rendrait incohérente avec ses propres termes.
   */
  async create(input: CreateTicket): Promise<TicketDetail> {
    const context = requireContext();

    await this.scopes.conditionFor('ticket', 'create');

    // Le gabarit s'applique avant les hooks : il exprime une regle de saisie,
    // les hooks une regle metier. Inverser laisserait un gabarit ecraser ce
    // qu'un plugin vient de decider.
    const gabarit = await this.templates.resolve(input.templateId);
    const rempli = this.templates.applyDefaults(gabarit, input);

    this.templates.assertMandatory(gabarit, rempli);

    const propose = await this.hooks.run('ticket.beforeCreate', {
      entityId: context.entityId,
      name: rempli.name,
      content: rempli.content,
      type: rempli.type,
      urgency: rempli.urgency,
      impact: rempli.impact,
      categoryId: rempli.categoryId ?? null,
    });

    // Trois passes, dans cet ordre. Le dictionnaire normalise le texte en
    // premier, pour que les criteres des regles portent sur un titre deja
    // nettoye. Les hooks ont deja parle : ce sont des regles de code, celles du
    // developpeur. Les regles metier passent en dernier parce qu'elles
    // expriment la configuration de l'organisation, qui doit avoir le dernier
    // mot sur l'aiguillage.
    const champs: Record<string, unknown> = {
      name: propose.name,
      content: propose.content,
      type: propose.type,
      urgency: propose.urgency,
      impact: propose.impact,
      categoryId: propose.categoryId,
      requestSourceId: rempli.requestSourceId ?? null,
      locationId: rempli.locationId ?? null,
      slaTtoId: null,
      slaTtrId: null,
      olaTtoId: null,
      olaTtrId: null,
    };

    const decides = await this.runRules('dictionary.ticket', champs, {});
    const demandeur = rempli.actors.find((acteur) => acteur.role === 'requester');

    decides.push(
      ...(await this.runRules('ticket.create', champs, {
        entityId: context.entityId,
        entityPath: context.entityPath,
        requesterId: demandeur?.actorId ?? context.userId,
        categoryPath: await this.categoryPath(champs['categoryId']),
      })),
    );

    // La priorite se recalcule apres les regles, sauf si l'une d'elles l'a
    // fixee explicitement : forcer une priorite est une decision assumee, la
    // matrice ne doit pas la reprendre aussitot.
    const priority =
      champs['priority'] === undefined || champs['priority'] === null
        ? await this.priority.compute(
            propose.entityId,
            borne(champs['urgency'], propose.urgency),
            borne(champs['impact'], propose.impact),
          )
        : borne(champs['priority'], 3);

    const titre = texte(champs, 'name', propose.name);
    const genre = choix(champs, 'type', TYPES, propose.type);

    const id = await this.db.asUser(async (tx) => {
      const [ticket] = await tx
        .insert(tickets)
        .values({
          entityId: propose.entityId,
          entityPath: 'temporaire',
          name: titre,
          content: texte(champs, 'content', propose.content),
          type: genre,
          urgency: borne(champs['urgency'], propose.urgency),
          impact: borne(champs['impact'], propose.impact),
          priority,
          categoryId: reference(champs, 'categoryId'),
          requestSourceId: reference(champs, 'requestSourceId'),
          locationId: reference(champs, 'locationId'),
          slaTtoId: reference(champs, 'slaTtoId'),
          slaTtrId: reference(champs, 'slaTtrId'),
          olaTtoId: reference(champs, 'olaTtoId'),
          olaTtrId: reference(champs, 'olaTtrId'),
          templateId: gabarit?.id ?? null,
          createdById: context.userId,
          updatedById: context.userId,
        })
        .returning({ id: tickets.id });

      if (!ticket) throw new BadRequestException('Creation impossible dans ce perimetre.');

      // Sans demandeur explicite, l'auteur le devient : un ticket sans demandeur
      // n'a personne a qui repondre.
      const acteurs: TicketActorInput[] = rempli.actors.some(
        (acteur) => acteur.role === 'requester',
      )
        ? [...rempli.actors, ...decides]
        : [
            ...rempli.actors,
            { role: 'requester', actorType: 'user', actorId: context.userId },
            ...decides,
          ];

      await this.actors.write(tx, 'ticket', ticket.id, acteurs);
      await this.history.recordAction(
        tx,
        { type: 'ticket', id: ticket.id, entityId: propose.entityId },
        'creation',
        titre,
      );

      return ticket.id;
    });

    // Les echeances se calculent une fois le ticket ecrit : leur point de
    // depart est sa date d'ouverture, que la base vient de poser.
    await this.sla.refreshQuietly(id);

    emitEvent('ticket.created', {
      id,
      entityId: propose.entityId,
      name: titre,
      type: genre,
      priority,
    });

    return this.findById(id);
  }

  /**
   * Execute une collection de regles et reporte son resultat sur les champs.
   *
   * Renvoie les acteurs decides par les regles : ils ne sont pas des colonnes
   * du ticket et s'ecrivent separement, une fois son identifiant connu.
   */
  private async runRules(
    collection: RuleCollection,
    champs: Record<string, unknown>,
    contexte: Record<string, unknown>,
  ): Promise<TicketActorInput[]> {
    const { output } = await this.rules.run(collection, { ...contexte, ...champs });

    return applyRuleOutput(champs, output);
  }

  /**
   * Chemin materialise d'une categorie, pour l'operateur « est sous ».
   *
   * Sans lui, une regle ne pourrait viser qu'une categorie exacte, et il
   * faudrait la dupliquer pour chacune de ses sous-categories.
   */
  private async categoryPath(categoryId: unknown): Promise<string | null> {
    if (typeof categoryId !== 'number') return null;

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<{ path: string }>(
        sql`SELECT path::text AS path FROM itil_categories WHERE id = ${categoryId}`,
      );

      return resultat.rows;
    });

    return rows[0]?.path ?? null;
  }

  async findById(id: number): Promise<TicketDetail> {
    const condition = await this.scopes.conditionFor('ticket', 'read');

    const [row] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TicketRow & Record<string, unknown>>(sql`
        SELECT
          tickets.id, tickets.name, tickets.type, tickets.status,
          tickets.urgency, tickets.impact, tickets.priority,
          tickets.content, tickets.entity_id AS "entityId",
          entites.name AS "entityName",
          tickets.category_id AS "categoryId", categories.complete_name AS "categoryName",
          tickets.request_source_id AS "requestSourceId", sources.name AS "requestSourceName",
          tickets.location_id AS "locationId", lieux.complete_name AS "locationName",
          tickets.date_opened AS "dateOpened", tickets.date_due AS "dateDue",
          tickets.date_taken_into_account AS "dateTakenIntoAccount",
          tickets.date_solved AS "dateSolved", tickets.date_closed AS "dateClosed",
          tickets.internal_time AS "internalTime",
          tickets.waiting_duration AS "waitingDuration",
          tickets.validation_status AS "validationStatus",
          tickets.created_by_id AS "createdById", auteur.username AS "createdByName",
          tickets.created_at AS "createdAt", tickets.updated_at AS "updatedAt",
          ${actorLabels('requester')} AS "requesters",
          ${actorLabels('assigned')} AS "assignees",
          ${followupCount()} AS "followupCount",
          ${taskCount()} AS "taskCount"
        FROM tickets
        JOIN entities entites ON entites.id = tickets.entity_id
        LEFT JOIN itil_categories categories ON categories.id = tickets.category_id
        LEFT JOIN request_sources sources ON sources.id = tickets.request_source_id
        LEFT JOIN locations lieux ON lieux.id = tickets.location_id
        LEFT JOIN users auteur ON auteur.id = tickets.created_by_id
        WHERE tickets.id = ${id}
          AND tickets.deleted_at IS NULL
          ${condition ? sql`AND ${condition}` : sql``}
      `);

      return resultat.rows;
    });

    if (!row) throw new NotFoundException('Ticket introuvable ou hors de votre perimetre.');

    const detail = row as unknown as Record<string, unknown>;

    return {
      ...toSummary(row),
      content: toText(detail['content']),
      requestSource: detail['requestSourceId']
        ? { id: Number(detail['requestSourceId']), name: toText(detail['requestSourceName']) }
        : null,
      location: detail['locationId']
        ? { id: Number(detail['locationId']), name: toText(detail['locationName']) }
        : null,
      dateTakenIntoAccount: toIso(detail['dateTakenIntoAccount']),
      dateSolved: toIso(detail['dateSolved']),
      dateClosed: toIso(detail['dateClosed']),
      internalTime: Number(detail['internalTime'] ?? 0),
      waitingDuration: Number(detail['waitingDuration'] ?? 0),
      validationStatus: (detail['validationStatus'] as TicketDetail['validationStatus']) ?? null,
      actors: await this.actorsOf(id),
      createdBy: detail['createdById']
        ? { id: Number(detail['createdById']), name: toText(detail['createdByName']) }
        : null,
      createdAt: toIsoRequired(detail['createdAt']),
      updatedAt: toIsoRequired(detail['updatedAt']),
    };
  }

  /**
   * Liste paginée par curseur.
   *
   * Pas d'`OFFSET` : il s'effondre au-delà de quelques centaines de milliers de
   * lignes, et c'est exactement la volumétrie d'un outil de ticketing après
   * deux ans d'exploitation.
   */
  async list(filter: TicketFilter): Promise<TicketPage> {
    const context = requireContext();
    const conditions = await this.baseConditions(filter.deleted);

    if (filter.type) conditions.push(sql`tickets.type = ${filter.type}`);
    if (filter.categoryId) conditions.push(sql`tickets.category_id = ${filter.categoryId}`);

    if (filter.status && filter.status.length > 0) {
      conditions.push(
        sql`tickets.status IN (${sql.join(
          filter.status.map((statut) => sql`${statut}`),
          sql`, `,
        )})`,
      );
    }

    if (filter.priority && filter.priority.length > 0) {
      conditions.push(
        sql`tickets.priority IN (${sql.join(
          filter.priority.map((niveau) => sql`${niveau}`),
          sql`, `,
        )})`,
      );
    }

    if (filter.search) {
      const motif = `%${filter.search}%`;

      conditions.push(sql`(tickets.name ILIKE ${motif} OR tickets.content ILIKE ${motif})`);
    }

    if (filter.mine) {
      conditions.push(sql`EXISTS (
        SELECT 1 FROM itil_actors a
         WHERE a.itil_type = 'ticket' AND a.itil_id = tickets.id
           AND a.actor_type = 'user' AND a.actor_id = ${context.userId}
      )`);
    }

    return this.paginate(conditions, filter);
  }

  /**
   * Recherche multi-criteres.
   *
   * La clause vient du compilateur, qui n'accepte que des champs enregistres.
   * Elle s'ajoute au perimetre et a la portee du droit : une recherche ne peut
   * pas elargir ce que l'utilisateur a le droit de voir, seulement le restreindre.
   */
  async search(
    clause: SQL | undefined,
    options: {
      sort: TicketFilter['sort'];
      direction: TicketFilter['direction'];
      limit: number;
      cursor?: string | undefined;
      deleted: boolean;
    },
  ): Promise<TicketPage> {
    const conditions = await this.baseConditions(options.deleted);

    if (clause) conditions.push(clause);

    return this.paginate(conditions, options);
  }

  /** Corbeille et perimetre : le socle commun a toute liste de tickets. */
  private async baseConditions(deleted: boolean): Promise<SQL[]> {
    const condition = await this.scopes.conditionFor('ticket', 'read');
    const conditions: SQL[] = [
      deleted ? sql`tickets.deleted_at IS NOT NULL` : sql`tickets.deleted_at IS NULL`,
    ];

    if (condition) conditions.push(condition);

    return conditions;
  }

  /**
   * Execute la requete paginee.
   *
   * Pas d'`OFFSET` : il s'effondre au-dela de quelques centaines de milliers de
   * lignes, et c'est exactement la volumetrie d'un outil de ticketing apres
   * deux ans d'exploitation.
   */
  private async paginate(
    conditions: SQL[],
    options: {
      sort: TicketFilter['sort'];
      direction: TicketFilter['direction'];
      limit: number;
      cursor?: string | undefined;
    },
  ): Promise<TicketPage> {
    const colonne = SORTABLE[options.sort];
    const descendant = options.direction === 'desc';
    const curseur = decodeCursor(options.cursor);

    if (curseur) {
      // Comparaison lexicographique sur (valeur de tri, identifiant) : deux
      // tickets ouverts a la meme seconde restent departages.
      const comparaison = descendant ? sql`<` : sql`>`;

      conditions.push(
        sql`(${colonne}, tickets.id) ${comparaison} (${curseur.value}, ${curseur.id})`,
      );
    }

    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TicketRow & Record<string, unknown>>(sql`
        SELECT
          tickets.id, tickets.name, tickets.type, tickets.status,
          tickets.urgency, tickets.impact, tickets.priority,
          tickets.entity_id AS "entityId", entites.name AS "entityName",
          tickets.category_id AS "categoryId", categories.complete_name AS "categoryName",
          tickets.date_opened AS "dateOpened", tickets.date_due AS "dateDue",
          ${actorLabels('requester')} AS "requesters",
          ${actorLabels('assigned')} AS "assignees",
          ${followupCount()} AS "followupCount",
          ${taskCount()} AS "taskCount",
          ${colonne} AS "sortValue"
        FROM tickets
        JOIN entities entites ON entites.id = tickets.entity_id
        LEFT JOIN itil_categories categories ON categories.id = tickets.category_id
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY ${colonne} ${descendant ? sql`DESC` : sql`ASC`},
                 tickets.id ${descendant ? sql`DESC` : sql`ASC`}
        LIMIT ${options.limit + 1}
      `);

      return resultat.rows;
    });

    const complet = rows.length > options.limit;
    const page = complet ? rows.slice(0, options.limit) : rows;
    const dernier = page.at(-1);

    return {
      items: page.map(toSummary),
      nextCursor:
        complet && dernier
          ? encodeCursor({
              value: this.cursorValue((dernier as Record<string, unknown>)['sortValue']),
              id: dernier.id,
            })
          : null,
    };
  }

  private cursorValue(valeur: unknown): string | null {
    if (valeur === null || valeur === undefined) return null;

    return toText(valeur);
  }

  /** Les dates issues de SQL brut sont normalisees avant tout calcul. */
  private static asDate(valeur: unknown): Date {
    return valeur instanceof Date ? valeur : new Date(toText(valeur));
  }

  /**
   * Met à jour un ticket.
   *
   * Un changement de statut passe par un hook dédié : c'est le point d'accroche
   * naturel des règles de workflow, et il doit pouvoir refuser indépendamment
   * des autres champs.
   */
  async update(id: number, input: UpdateTicket): Promise<TicketDetail> {
    const condition = await this.scopes.conditionFor('ticket', 'update');
    const context = requireContext();

    const avant = await this.rawById(id, condition);

    const propose = await this.hooks.run('ticket.beforeUpdate', {
      id,
      changes: { ...input },
    });
    const demande = propose.changes as UpdateTicket;

    // Les regles voient l'etat **resultant**, pas l'etat precedent : un critere
    // « urgence = 5 » doit porter sur l'urgence qui va etre ecrite. Elles
    // passent donc apres les hooks et avant la validation de transition, de
    // sorte que le statut controle soit celui qui sera reellement enregistre.
    const champs: Record<string, unknown> = {
      name: demande.name ?? avant.name,
      content: demande.content ?? avant.content,
      type: demande.type ?? avant.type,
      status: demande.status ?? avant.status,
      urgency: demande.urgency ?? avant.urgency,
      impact: demande.impact ?? avant.impact,
      categoryId: demande.categoryId ?? avant.categoryId,
      requestSourceId: demande.requestSourceId ?? avant.requestSourceId,
      locationId: demande.locationId ?? avant.locationId,
      slaTtoId: avant.slaTtoId,
      slaTtrId: avant.slaTtrId,
      olaTtoId: avant.olaTtoId,
      olaTtrId: avant.olaTtrId,
    };

    const decides = await this.runRules('ticket.update', champs, {
      entityId: avant.entityId,
      entityPath: String(avant.entityPath),
      categoryPath: await this.categoryPath(champs['categoryId']),
    });

    const changes = this.differences(avant, champs, demande);

    if (changes.status && changes.status !== avant.status) {
      const autorisees = TRANSITIONS[avant.status];

      if (!autorisees.includes(changes.status)) {
        throw new BadRequestException(
          `Transition interdite : ${avant.status} vers ${changes.status}.`,
        );
      }

      await this.hooks.run('ticket.beforeStatusChange', {
        id,
        from: avant.status,
        to: changes.status,
      });
    }

    const patch: Record<string, unknown> = { ...changes, updatedById: context.userId };

    if (changes.urgency !== undefined || changes.impact !== undefined) {
      patch['priority'] =
        champs['priority'] === undefined || champs['priority'] === null
          ? await this.priority.compute(
              avant.entityId,
              changes.urgency ?? avant.urgency,
              changes.impact ?? avant.impact,
            )
          : borne(champs['priority'], avant.priority);
    } else if (champs['priority'] !== undefined && champs['priority'] !== null) {
      patch['priority'] = borne(champs['priority'], avant.priority);
    }

    if (changes.status && changes.status !== avant.status) {
      Object.assign(patch, this.statusTransition(avant, changes.status));
    }

    const modifies = await this.db.asUser(async (tx) => {
      await tx
        .update(tickets)
        .set(patch)
        .where(sql`${tickets.id} = ${id}`);

      if (decides.length > 0) await this.actors.write(tx, 'ticket', id, decides);

      return this.history.recordChanges(
        tx,
        { type: 'ticket', id, entityId: avant.entityId },
        avant,
        patch,
      );
    });

    // Le temps d'attente et les engagements ont pu changer : les echeances se
    // recalculent a partir de la date d'ouverture, jamais par decalage.
    await this.sla.refreshQuietly(id);

    emitEvent('ticket.updated', { id, entityId: avant.entityId, changedFields: modifies });

    if (changes.status && changes.status !== avant.status) {
      emitEvent('ticket.statusChanged', {
        id,
        entityId: avant.entityId,
        from: avant.status,
        to: changes.status,
      });

      if (changes.status === 'solved') emitEvent('ticket.solved', { id, entityId: avant.entityId });
      if (changes.status === 'closed') emitEvent('ticket.closed', { id, entityId: avant.entityId });
    }

    return this.findById(id);
  }

  /**
   * Ne retient que ce qui change reellement.
   *
   * Les regles reconstruisent l'etat complet du ticket ; ecrire tel quel
   * remplirait l'historique de lignes « urgence : 3 vers 3 ». La saisie
   * explicite est conservee meme si elle egale l'etat precedent, parce qu'elle
   * exprime une intention et non un calcul.
   */
  private differences(
    avant: typeof tickets.$inferSelect,
    champs: Record<string, unknown>,
    demande: UpdateTicket,
  ): UpdateTicket {
    const changes: UpdateTicket & Record<string, unknown> = { ...demande };
    const precedent = avant as unknown as Record<string, unknown>;

    for (const [cle, valeur] of Object.entries(champs)) {
      if (cle === 'priority') continue;
      if (valeur === precedent[cle]) continue;

      changes[cle] = valeur;
    }

    return changes;
  }

  /**
   * Effets de bord d'un changement de statut.
   *
   * Le statut « en attente » suspend le décompte : on cumule le temps déjà
   * passé en attente, et les délais constatés le retranchent. Sans cela, un
   * ticket bloqué chez un fournisseur paraîtrait traité en retard par l'équipe.
   *
   * Les délais constatés restent en temps calendaire : ils décrivent ce qui
   * s'est passé, pas ce qui était promis. Le temps ouvré, lui, sert au calcul
   * des échéances, que `SlaService` reprend à partir du temps d'attente cumulé
   * mis à jour ici.
   */
  private statusTransition(
    avant: {
      status: ItilStatus;
      dateOpened: unknown;
      waitingDuration: number;
      waitingSince: unknown;
    },
    versStatut: ItilStatus,
  ): Record<string, unknown> {
    const maintenant = new Date();
    const patch: Record<string, unknown> = {};

    let attente = avant.waitingDuration;

    if (avant.status === 'waiting' && avant.waitingSince) {
      const depuis = TicketsService.asDate(avant.waitingSince);

      attente += Math.round((maintenant.getTime() - depuis.getTime()) / 1000);
      patch['waitingDuration'] = attente;
      patch['waitingSince'] = null;
    }

    if (versStatut === 'waiting') {
      patch['waitingSince'] = maintenant;
    }

    const ecoule = (): number =>
      Math.max(
        0,
        Math.round(
          (maintenant.getTime() - TicketsService.asDate(avant.dateOpened).getTime()) / 1000,
        ) - attente,
      );

    if (avant.status === 'new' && versStatut !== 'new') {
      patch['dateTakenIntoAccount'] = maintenant;
      patch['takeIntoAccountDelay'] = ecoule();
    }

    if (versStatut === 'solved') {
      patch['dateSolved'] = maintenant;
      patch['solveDelay'] = ecoule();
    }

    if (versStatut === 'closed') {
      patch['dateClosed'] = maintenant;
      patch['closeDelay'] = ecoule();
    }

    // Reouvrir efface les dates de sortie : les conserver ferait apparaitre le
    // ticket comme resolu dans les statistiques alors qu'il ne l'est plus.
    if (['new', 'assigned', 'planned', 'waiting'].includes(versStatut)) {
      patch['dateSolved'] = null;
      patch['dateClosed'] = null;
    }

    return patch;
  }

  /** Suppression logique : la corbeille. */
  async softDelete(id: number): Promise<void> {
    const condition = await this.scopes.conditionFor('ticket', 'delete');
    const avant = await this.rawById(id, condition);

    await this.db.asUser(async (tx) => {
      await tx
        .update(tickets)
        .set({ deletedAt: new Date() })
        .where(sql`${tickets.id} = ${id}`);

      await this.history.recordAction(
        tx,
        { type: 'ticket', id, entityId: avant.entityId },
        'suppression',
      );
    });

    emitEvent('ticket.deleted', { id, entityId: avant.entityId });
  }

  async restore(id: number): Promise<void> {
    const condition = await this.scopes.conditionFor('ticket', 'delete');
    const avant = await this.rawById(id, condition, true);

    await this.db.asUser(async (tx) => {
      await tx
        .update(tickets)
        .set({ deletedAt: null })
        .where(sql`${tickets.id} = ${id}`);

      await this.history.recordAction(
        tx,
        { type: 'ticket', id, entityId: avant.entityId },
        'restauration',
      );
    });
  }

  /** Remplace l'ensemble des acteurs. */
  async setActors(id: number, acteurs: readonly TicketActorInput[]): Promise<TicketActor[]> {
    const condition = await this.scopes.conditionFor('ticket', 'update');
    const avant = await this.rawById(id, condition);

    this.actors.assertDemandeur(acteurs, 'ticket');

    await this.db.asUser((tx) =>
      this.actors.replace(tx, { type: 'ticket', id, entityId: avant.entityId }, acteurs),
    );

    emitEvent('ticket.updated', { id, entityId: avant.entityId, changedFields: ['actors'] });

    return this.actorsOf(id);
  }

  async actorsOf(id: number): Promise<TicketActor[]> {
    return this.actors.listOf('ticket', id);
  }

  /** Ligne brute du ticket, servant de point de comparaison pour l'historique. */
  private async rawById(
    id: number,
    condition: ReturnType<typeof sql> | undefined,
    supprime = false,
  ): Promise<typeof tickets.$inferSelect> {
    const [row] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<typeof tickets.$inferSelect & Record<string, unknown>>(sql`
        SELECT tickets.*, tickets.entity_id AS "entityId",
               tickets.date_opened AS "dateOpened",
               tickets.waiting_duration AS "waitingDuration",
               tickets.waiting_since AS "waitingSince"
          FROM tickets
         WHERE tickets.id = ${id}
           AND tickets.deleted_at IS ${supprime ? sql`NOT NULL` : sql`NULL`}
           ${condition ? sql`AND ${condition}` : sql``}
      `);

      return resultat.rows;
    });

    if (!row) throw new NotFoundException('Ticket introuvable ou hors de votre perimetre.');

    return row;
  }
}
