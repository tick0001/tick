import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateTicket,
  ItilStatus,
  TicketActor,
  TicketActorInput,
  TicketDetail,
  TicketFilter,
  TicketPage,
  TicketSummary,
  UpdateTicket,
} from '@tick/contracts';
import { itilActors, sql, tickets, type Transaction } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { emitEvent } from '../plugins/event-buffer.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { HistoryService } from './history.service.js';
import { PriorityService } from './priority.service.js';
import { TicketScopeService } from './ticket-scope.service.js';
import {
  actorLabels,
  decodeCursor,
  encodeCursor,
  followupCount,
  SORTABLE,
  taskCount,
  toIso,
  toIsoRequired,
} from './ticket-sql.js';

/**
 * Transitions autorisées.
 *
 * Explicites plutôt que « tout est permis » : un ticket clos qui repasse en
 * « nouveau » sans réouverture explicite fausse toutes les statistiques. La
 * réouverture existe, elle passe par `solved` ou `closed` vers `assigned`.
 */
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

    const propose = await this.hooks.run('ticket.beforeCreate', {
      entityId: context.entityId,
      name: input.name,
      content: input.content,
      type: input.type,
      urgency: input.urgency,
      impact: input.impact,
      categoryId: input.categoryId ?? null,
    });

    const priority = await this.priority.compute(propose.entityId, propose.urgency, propose.impact);

    const id = await this.db.asUser(async (tx) => {
      const [ticket] = await tx
        .insert(tickets)
        .values({
          entityId: propose.entityId,
          entityPath: 'temporaire',
          name: propose.name,
          content: propose.content,
          type: propose.type,
          urgency: propose.urgency,
          impact: propose.impact,
          priority,
          categoryId: propose.categoryId,
          requestSourceId: input.requestSourceId ?? null,
          locationId: input.locationId ?? null,
          templateId: input.templateId ?? null,
          createdById: context.userId,
          updatedById: context.userId,
        })
        .returning({ id: tickets.id });

      if (!ticket) throw new BadRequestException('Creation impossible dans ce perimetre.');

      // Sans demandeur explicite, l'auteur le devient : un ticket sans demandeur
      // n'a personne a qui repondre.
      const acteurs: TicketActorInput[] = input.actors.some((acteur) => acteur.role === 'requester')
        ? input.actors
        : [...input.actors, { role: 'requester', actorType: 'user', actorId: context.userId }];

      await this.writeActors(tx, ticket.id, acteurs);
      await this.history.recordAction(
        tx,
        { type: 'ticket', id: ticket.id, entityId: propose.entityId },
        'creation',
        propose.name,
      );

      return ticket.id;
    });

    emitEvent('ticket.created', {
      id,
      entityId: propose.entityId,
      name: propose.name,
      type: propose.type,
      priority,
    });

    return this.findById(id);
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
          ${followupCount} AS "followupCount",
          ${taskCount} AS "taskCount"
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
      content: String(detail['content'] ?? ''),
      requestSource: detail['requestSourceId']
        ? { id: Number(detail['requestSourceId']), name: String(detail['requestSourceName']) }
        : null,
      location: detail['locationId']
        ? { id: Number(detail['locationId']), name: String(detail['locationName']) }
        : null,
      dateTakenIntoAccount: toIso(detail['dateTakenIntoAccount']),
      dateSolved: toIso(detail['dateSolved']),
      dateClosed: toIso(detail['dateClosed']),
      internalTime: Number(detail['internalTime'] ?? 0),
      waitingDuration: Number(detail['waitingDuration'] ?? 0),
      validationStatus: (detail['validationStatus'] as TicketDetail['validationStatus']) ?? null,
      actors: await this.actorsOf(id),
      createdBy: detail['createdById']
        ? { id: Number(detail['createdById']), name: String(detail['createdByName']) }
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
    const condition = await this.scopes.conditionFor('ticket', 'read');
    const context = requireContext();
    const colonne = SORTABLE[filter.sort];
    const descendant = filter.direction === 'desc';
    const curseur = decodeCursor(filter.cursor);

    const conditions = [
      filter.deleted ? sql`tickets.deleted_at IS NOT NULL` : sql`tickets.deleted_at IS NULL`,
    ];

    if (condition) conditions.push(condition);
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
          ${followupCount} AS "followupCount",
          ${taskCount} AS "taskCount",
          ${colonne} AS "sortValue"
        FROM tickets
        JOIN entities entites ON entites.id = tickets.entity_id
        LEFT JOIN itil_categories categories ON categories.id = tickets.category_id
        WHERE ${sql.join(conditions, sql` AND `)}
        ORDER BY ${colonne} ${descendant ? sql`DESC` : sql`ASC`},
                 tickets.id ${descendant ? sql`DESC` : sql`ASC`}
        LIMIT ${filter.limit + 1}
      `);

      return resultat.rows;
    });

    const complet = rows.length > filter.limit;
    const page = complet ? rows.slice(0, filter.limit) : rows;
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
    if (valeur instanceof Date) return valeur.toISOString();

    return String(valeur);
  }

  /** Les dates issues de SQL brut sont normalisees avant tout calcul. */
  private static asDate(valeur: unknown): Date {
    return valeur instanceof Date ? valeur : new Date(String(valeur));
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

    if (input.status && input.status !== avant.status) {
      const autorisees = TRANSITIONS[avant.status];

      if (!autorisees.includes(input.status)) {
        throw new BadRequestException(
          `Transition interdite : ${avant.status} vers ${input.status}.`,
        );
      }

      await this.hooks.run('ticket.beforeStatusChange', {
        id,
        from: avant.status,
        to: input.status,
      });
    }

    const propose = await this.hooks.run('ticket.beforeUpdate', {
      id,
      changes: { ...input } as Record<string, unknown>,
    });
    const changes = propose.changes as UpdateTicket;

    const patch: Record<string, unknown> = { ...changes, updatedById: context.userId };

    if (changes.urgency !== undefined || changes.impact !== undefined) {
      patch['priority'] = await this.priority.compute(
        avant.entityId,
        changes.urgency ?? avant.urgency,
        changes.impact ?? avant.impact,
      );
    }

    if (changes.status && changes.status !== avant.status) {
      Object.assign(patch, this.statusTransition(avant, changes.status));
    }

    const champs = await this.db.asUser(async (tx) => {
      await tx
        .update(tickets)
        .set(patch)
        .where(sql`${tickets.id} = ${id}`);

      return this.history.recordChanges(
        tx,
        { type: 'ticket', id, entityId: avant.entityId },
        avant as unknown as Record<string, unknown>,
        patch,
      );
    });

    emitEvent('ticket.updated', { id, entityId: avant.entityId, changedFields: champs });

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
   * Effets de bord d'un changement de statut.
   *
   * Le statut « en attente » suspend le décompte : on cumule le temps déjà
   * passé en attente, et les délais constatés le retranchent. Sans cela, un
   * ticket bloqué chez un fournisseur paraîtrait traité en retard par l'équipe.
   *
   * Les durées sont calculées en temps calendaire. Le calcul en heures ouvrées
   * arrive avec les calendriers, au jalon J4.
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

    if (!acteurs.some((acteur) => acteur.role === 'requester')) {
      throw new BadRequestException('Un ticket doit conserver au moins un demandeur.');
    }

    await this.db.asUser(async (tx) => {
      await tx
        .delete(itilActors)
        .where(sql`${itilActors.itilType} = 'ticket' AND ${itilActors.itilId} = ${id}`);
      await this.writeActors(tx, id, acteurs);
      await this.history.recordAction(
        tx,
        { type: 'ticket', id, entityId: avant.entityId },
        'acteurs',
        acteurs
          .map((acteur) => `${acteur.role}:${acteur.actorType}#${String(acteur.actorId)}`)
          .join(', '),
      );
    });

    emitEvent('ticket.updated', { id, entityId: avant.entityId, changedFields: ['actors'] });

    return this.actorsOf(id);
  }

  async actorsOf(id: number): Promise<TicketActor[]> {
    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TicketActor & Record<string, unknown>>(sql`
        SELECT
          acteur.role, acteur.actor_type AS "actorType", acteur.actor_id AS "actorId",
          acteur.alternative_email AS "alternativeEmail",
          coalesce(
            CASE acteur.actor_type
              WHEN 'user' THEN coalesce(
                nullif(trim(coalesce(u.first_name, '') || ' ' || coalesce(u.last_name, '')), ''),
                u.username::text
              )
              WHEN 'group' THEN g.name
              WHEN 'supplier' THEN f.name
            END,
            '(inconnu)'
          ) AS "label"
        FROM itil_actors acteur
        LEFT JOIN users u ON acteur.actor_type = 'user' AND u.id = acteur.actor_id
        LEFT JOIN groups g ON acteur.actor_type = 'group' AND g.id = acteur.actor_id
        LEFT JOIN suppliers f ON acteur.actor_type = 'supplier' AND f.id = acteur.actor_id
        WHERE acteur.itil_type = 'ticket' AND acteur.itil_id = ${id}
        ORDER BY acteur.role, "label"
      `);

      return resultat.rows;
    });
  }

  private async writeActors(
    tx: Transaction,
    ticketId: number,
    acteurs: readonly TicketActorInput[],
  ): Promise<void> {
    if (acteurs.length === 0) return;

    await tx
      .insert(itilActors)
      .values(
        acteurs.map((acteur) => ({
          itilType: 'ticket' as const,
          itilId: ticketId,
          role: acteur.role,
          actorType: acteur.actorType,
          actorId: acteur.actorId,
          alternativeEmail: acteur.alternativeEmail ?? null,
        })),
      )
      .onConflictDoNothing();
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
