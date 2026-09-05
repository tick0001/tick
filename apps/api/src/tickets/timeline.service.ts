import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  AddFollowup,
  AddSolution,
  AddTask,
  AnswerSolution,
  AnswerValidation,
  RequestValidation,
  TimelineEntry,
  UpdateTask,
} from '@tick/contracts';
import { itilFollowups, itilSolutions, itilTasks, itilValidations, sql, tickets } from '@tick/db';
import { requireContext } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { emitEvent } from '../plugins/event-buffer.js';
import { HookBus } from '../plugins/hook-bus.service.js';
import { HistoryService } from './history.service.js';
import { TicketScopeService } from './ticket-scope.service.js';
import { toIso, toIsoRequired, toText } from './ticket-sql.js';

interface TicketRef {
  id: number;
  entityId: number;
}

/**
 * Chronologie du ticket : suivis, tâches, solutions, validations, historique.
 *
 * Un seul flux ordonné plutôt que des onglets séparés. C'est ce que l'on lit
 * pour comprendre ce qui s'est passé, et découper en onglets oblige le lecteur
 * à recomposer l'enchaînement de tête.
 */
@Injectable()
export class TimelineService {
  constructor(
    private readonly db: DatabaseService,
    private readonly hooks: HookBus,
    private readonly history: HistoryService,
    private readonly scopes: TicketScopeService,
  ) {}

  /**
   * Le lecteur voit-il les éléments privés ?
   *
   * La portée `own` désigne un demandeur : il ne voit que ses propres tickets,
   * et c'est exactement de lui que les éléments privés doivent être cachés.
   * Toute portée plus large désigne un intervenant.
   */
  private async seesPrivate(): Promise<boolean> {
    return (await this.scopes.scopeOf('ticket', 'read')) !== 'own';
  }

  /** Vérifie l'accès au ticket et renvoie ses références. */
  private async requireTicket(ticketId: number, action: 'read' | 'update'): Promise<TicketRef> {
    const condition = await this.scopes.conditionFor('ticket', action);

    const [row] = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<TicketRef & Record<string, unknown>>(sql`
        SELECT tickets.id, tickets.entity_id AS "entityId"
          FROM tickets
         WHERE tickets.id = ${ticketId}
           AND tickets.deleted_at IS NULL
           ${condition ? sql`AND ${condition}` : sql``}
      `);

      return resultat.rows;
    });

    if (!row) throw new NotFoundException('Ticket introuvable ou hors de votre perimetre.');

    return row;
  }

  async timelineFor(ticketId: number): Promise<TimelineEntry[]> {
    await this.requireTicket(ticketId, 'read');

    const prive = await this.seesPrivate();
    const filtrePrive = prive ? sql`TRUE` : sql`is_private = false`;

    return this.db.asUser(async (tx) => {
      const resultat = await tx.execute<Record<string, unknown>>(sql`
        SELECT * FROM (
          SELECT 'followup' AS kind, s.id, s.created_at AS at, s.author_id AS "authorId",
                 s.content, s.is_private AS "isPrivate", s.source::text AS source,
                 NULL::text AS state, NULL::text AS status, 0 AS "actionTime",
                 NULL::timestamptz AS "beginAt", NULL::timestamptz AS "endAt",
                 NULL::bigint AS "technicianId", NULL::bigint AS "groupId",
                 NULL::bigint AS "categoryId", NULL::bigint AS "solutionTypeId",
                 NULL::text AS "approvalComment", NULL::bigint AS "validatorId",
                 NULL::text AS "requestComment", NULL::text AS "responseComment",
                 NULL::text AS field, NULL::text AS "oldValue", NULL::text AS "newValue"
            FROM itil_followups s
           WHERE s.itil_type = 'ticket' AND s.itil_id = ${ticketId}
             AND s.deleted_at IS NULL AND ${filtrePrive}

          UNION ALL

          SELECT 'task', k.id, k.created_at, k.author_id,
                 k.content, k.is_private, NULL,
                 k.state::text, NULL, k.action_time,
                 k.begin_at, k.end_at, k.technician_id, k.group_id,
                 k.category_id, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
            FROM itil_tasks k
           WHERE k.itil_type = 'ticket' AND k.itil_id = ${ticketId}
             AND k.deleted_at IS NULL AND ${filtrePrive}

          UNION ALL

          SELECT 'solution', o.id, o.created_at, o.author_id,
                 o.content, false, NULL,
                 NULL, o.status::text, 0,
                 NULL, NULL, NULL, NULL,
                 NULL, o.solution_type_id, o.approval_comment, NULL, NULL, NULL, NULL, NULL, NULL
            FROM itil_solutions o
           WHERE o.itil_type = 'ticket' AND o.itil_id = ${ticketId}

          UNION ALL

          SELECT 'validation', v.id, v.requested_at, v.requester_id,
                 NULL, false, NULL,
                 NULL, v.status::text, 0,
                 NULL, NULL, NULL, NULL,
                 NULL, NULL, NULL, v.validator_id, v.request_comment, v.response_comment,
                 NULL, NULL, NULL
            FROM itil_validations v
           WHERE v.itil_type = 'ticket' AND v.itil_id = ${ticketId}

          UNION ALL

          SELECT 'log', l.id, l.created_at, l.user_id,
                 NULL, false, NULL,
                 NULL, NULL, 0,
                 NULL, NULL, NULL, NULL,
                 NULL, NULL, NULL, NULL, NULL, NULL,
                 l.field, l.old_value, l.new_value
            FROM logs l
           WHERE l.item_type = 'ticket' AND l.item_id = ${ticketId}
        ) chronologie
        ORDER BY at ASC, id ASC
      `);

      return this.hydrate(tx, resultat.rows);
    });
  }

  /** Complète les entrées avec les libellés des personnes et référentiels cités. */
  private async hydrate(
    tx: Parameters<Parameters<DatabaseService['asUser']>[0]>[0],
    rows: readonly Record<string, unknown>[],
  ): Promise<TimelineEntry[]> {
    const identifiants = new Set<number>();

    for (const row of rows) {
      for (const cle of ['authorId', 'technicianId', 'validatorId']) {
        const valeur = row[cle];
        if (typeof valeur === 'number') identifiants.add(valeur);
      }
    }

    const noms = new Map<number, string>();

    if (identifiants.size > 0) {
      const resultat = await tx.execute<
        { id: number; label: string } & Record<string, unknown>
      >(sql`
        SELECT id, coalesce(
          nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''),
          username::text
        ) AS label
        FROM users WHERE id IN (${sql.join(
          [...identifiants].map((id) => sql`${id}`),
          sql`, `,
        )})
      `);

      for (const ligne of resultat.rows) noms.set(ligne.id, ligne.label);
    }

    const reference = (id: unknown): { id: number; name: string } | null =>
      typeof id === 'number' ? { id, name: noms.get(id) ?? '(inconnu)' } : null;

    return rows.map((row) => {
      const base = {
        id: Number(row['id']),
        at: toIsoRequired(row['at']),
        author: reference(row['authorId']),
      };

      switch (row['kind']) {
        case 'task':
          return {
            ...base,
            kind: 'task' as const,
            content: toText(row['content']),
            state: row['state'] as 'information' | 'todo' | 'done',
            isPrivate: Boolean(row['isPrivate']),
            actionTime: Number(row['actionTime'] ?? 0),
            beginAt: toIso(row['beginAt']),
            endAt: toIso(row['endAt']),
            technician: reference(row['technicianId']),
            group: null,
            category: null,
          };

        case 'solution':
          return {
            ...base,
            kind: 'solution' as const,
            content: toText(row['content']),
            status: row['status'] as 'proposed' | 'accepted' | 'refused',
            solutionType: null,
            approvalComment: (row['approvalComment'] as string | null) ?? null,
          };

        case 'validation':
          return {
            ...base,
            kind: 'validation' as const,
            status: row['status'] as 'waiting' | 'granted' | 'refused',
            validator: reference(row['validatorId']),
            requestComment: (row['requestComment'] as string | null) ?? null,
            responseComment: (row['responseComment'] as string | null) ?? null,
          };

        case 'log':
          return {
            ...base,
            kind: 'log' as const,
            field: toText(row['field']),
            oldValue: (row['oldValue'] as string | null) ?? null,
            newValue: (row['newValue'] as string | null) ?? null,
          };

        default:
          return {
            ...base,
            kind: 'followup' as const,
            content: toText(row['content']),
            isPrivate: Boolean(row['isPrivate']),
            source: row['source'] as 'interface' | 'email' | 'phone' | 'other',
          };
      }
    });
  }

  async addFollowup(ticketId: number, input: AddFollowup): Promise<void> {
    const ticket = await this.requireTicket(ticketId, 'update');
    const context = requireContext();

    const propose = await this.hooks.run('followup.beforeAdd', {
      ticketId,
      content: input.content,
      isPrivate: input.isPrivate,
    });

    const id = await this.db.asUser(async (tx) => {
      const [ligne] = await tx
        .insert(itilFollowups)
        .values({
          itilType: 'ticket',
          itilId: ticketId,
          entityId: ticket.entityId,
          entityPath: 'temporaire',
          content: propose.content,
          isPrivate: propose.isPrivate,
          source: input.source,
          authorId: context.userId,
        })
        .returning({ id: itilFollowups.id });

      return ligne?.id ?? 0;
    });

    emitEvent('followup.added', { ticketId, followupId: id, isPrivate: propose.isPrivate });
  }

  async addTask(ticketId: number, input: AddTask): Promise<void> {
    const ticket = await this.requireTicket(ticketId, 'update');
    const context = requireContext();

    const id = await this.db.asUser(async (tx) => {
      const [ligne] = await tx
        .insert(itilTasks)
        .values({
          itilType: 'ticket',
          itilId: ticketId,
          entityId: ticket.entityId,
          entityPath: 'temporaire',
          content: input.content,
          state: input.state,
          isPrivate: input.isPrivate,
          categoryId: input.categoryId ?? null,
          actionTime: input.actionTime,
          beginAt: input.beginAt ? new Date(input.beginAt) : null,
          endAt: input.endAt ? new Date(input.endAt) : null,
          technicianId: input.technicianId ?? null,
          groupId: input.groupId ?? null,
          authorId: context.userId,
        })
        .returning({ id: itilTasks.id });

      await this.recomputeInternalTime(tx, ticketId);

      return ligne?.id ?? 0;
    });

    emitEvent('task.added', { ticketId, taskId: id });
  }

  async updateTask(ticketId: number, taskId: number, input: UpdateTask): Promise<void> {
    await this.requireTicket(ticketId, 'update');

    await this.db.asUser(async (tx) => {
      const patch: Record<string, unknown> = { ...input, updatedAt: new Date() };

      if (input.beginAt !== undefined) {
        patch['beginAt'] = input.beginAt ? new Date(input.beginAt) : null;
      }
      if (input.endAt !== undefined) {
        patch['endAt'] = input.endAt ? new Date(input.endAt) : null;
      }

      await tx
        .update(itilTasks)
        .set(patch)
        .where(sql`${itilTasks.id} = ${taskId} AND ${itilTasks.itilId} = ${ticketId}`);

      await this.recomputeInternalTime(tx, ticketId);
    });
  }

  /**
   * Recalcule le temps interne du ticket.
   *
   * Recalculé plutôt qu'incrémenté : modifier ou supprimer une tâche laisserait
   * sinon un total faux, et l'écart ne se verrait que dans les statistiques,
   * bien plus tard.
   */
  private async recomputeInternalTime(
    tx: Parameters<Parameters<DatabaseService['asUser']>[0]>[0],
    ticketId: number,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE tickets SET internal_time = (
        SELECT coalesce(sum(action_time), 0) FROM itil_tasks
         WHERE itil_type = 'ticket' AND itil_id = ${ticketId} AND deleted_at IS NULL
      )
      WHERE id = ${ticketId}
    `);
  }

  async addSolution(ticketId: number, input: AddSolution): Promise<void> {
    const ticket = await this.requireTicket(ticketId, 'update');
    const context = requireContext();

    const id = await this.db.asUser(async (tx) => {
      const [ligne] = await tx
        .insert(itilSolutions)
        .values({
          itilType: 'ticket',
          itilId: ticketId,
          entityId: ticket.entityId,
          entityPath: 'temporaire',
          content: input.content,
          solutionTypeId: input.solutionTypeId ?? null,
          authorId: context.userId,
        })
        .returning({ id: itilSolutions.id });

      return ligne?.id ?? 0;
    });

    emitEvent('solution.proposed', { ticketId, solutionId: id });
  }

  /**
   * Réponse du demandeur à une solution.
   *
   * Un refus rouvre le ticket : laisser un ticket « résolu » avec une solution
   * refusée le ferait disparaître des listes de travail alors que le problème
   * persiste.
   */
  async answerSolution(ticketId: number, input: AnswerSolution): Promise<void> {
    const ticket = await this.requireTicket(ticketId, 'read');
    const context = requireContext();

    const solutionId = await this.db.asUser(async (tx) => {
      const [derniere] = await tx
        .select({ id: itilSolutions.id })
        .from(itilSolutions)
        .where(
          sql`${itilSolutions.itilType} = 'ticket' AND ${itilSolutions.itilId} = ${ticketId}
              AND ${itilSolutions.status} = 'proposed'`,
        )
        .orderBy(sql`${itilSolutions.createdAt} DESC`)
        .limit(1);

      if (!derniere) throw new BadRequestException('Aucune solution en attente de reponse.');

      await tx
        .update(itilSolutions)
        .set({
          status: input.accepted ? 'accepted' : 'refused',
          approverId: context.userId,
          approvalComment: input.comment ?? null,
          answeredAt: new Date(),
        })
        .where(sql`${itilSolutions.id} = ${derniere.id}`);

      await tx
        .update(tickets)
        .set(
          input.accepted
            ? { status: 'closed', dateClosed: new Date() }
            : { status: 'assigned', dateSolved: null },
        )
        .where(sql`${tickets.id} = ${ticketId}`);

      await this.history.recordAction(
        tx,
        { type: 'ticket', id: ticketId, entityId: ticket.entityId },
        input.accepted ? 'solution acceptee' : 'solution refusee',
        input.comment ?? null,
      );

      return derniere.id;
    });

    emitEvent('solution.answered', { ticketId, solutionId, accepted: input.accepted });

    if (input.accepted) emitEvent('ticket.closed', { id: ticketId, entityId: ticket.entityId });
  }

  async requestValidation(ticketId: number, input: RequestValidation): Promise<void> {
    const ticket = await this.requireTicket(ticketId, 'update');
    const context = requireContext();

    const id = await this.db.asUser(async (tx) => {
      const [ligne] = await tx
        .insert(itilValidations)
        .values({
          itilType: 'ticket',
          itilId: ticketId,
          entityId: ticket.entityId,
          entityPath: 'temporaire',
          requesterId: context.userId,
          validatorType: input.validatorType,
          validatorId: input.validatorId,
          requestComment: input.comment ?? null,
        })
        .returning({ id: itilValidations.id });

      await tx
        .update(tickets)
        .set({ validationStatus: 'waiting' })
        .where(sql`${tickets.id} = ${ticketId}`);

      return ligne?.id ?? 0;
    });

    emitEvent('validation.requested', { ticketId, validationId: id });
  }

  async answerValidation(
    ticketId: number,
    validationId: number,
    input: AnswerValidation,
  ): Promise<void> {
    const ticket = await this.requireTicket(ticketId, 'read');
    const context = requireContext();

    await this.db.asUser(async (tx) => {
      const misesAJour = await tx
        .update(itilValidations)
        .set({
          status: input.granted ? 'granted' : 'refused',
          responseComment: input.comment ?? null,
          answeredById: context.userId,
          answeredAt: new Date(),
        })
        .where(
          sql`${itilValidations.id} = ${validationId}
              AND ${itilValidations.itilId} = ${ticketId}
              AND ${itilValidations.status} = 'waiting'`,
        )
        .returning({ id: itilValidations.id });

      if (misesAJour.length === 0) {
        throw new BadRequestException('Validation introuvable ou deja repondue.');
      }

      // L'etat agrege du ticket : refuse s'il existe un refus, accorde si tout
      // est accorde, en attente sinon.
      await tx.execute(sql`
        UPDATE tickets SET validation_status = (
          SELECT CASE
            WHEN bool_or(status = 'refused') THEN 'refused'::validation_state
            WHEN bool_and(status = 'granted') THEN 'granted'::validation_state
            ELSE 'waiting'::validation_state
          END
          FROM itil_validations
          WHERE itil_type = 'ticket' AND itil_id = ${ticketId}
        )
        WHERE id = ${ticketId}
      `);

      await this.history.recordAction(
        tx,
        { type: 'ticket', id: ticketId, entityId: ticket.entityId },
        input.granted ? 'validation accordee' : 'validation refusee',
        input.comment ?? null,
      );
    });

    emitEvent('validation.answered', { ticketId, validationId, granted: input.granted });
  }
}
