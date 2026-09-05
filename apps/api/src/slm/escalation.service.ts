import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { sql } from '@tick/db';
import { Queue, Worker } from 'bullmq';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { emitEvent } from '../plugins/event-buffer.js';
import { SlaService } from './sla.service.js';

export const ESCALATION_QUEUE = 'tick.escalation';

/**
 * Période de balayage.
 *
 * Une minute : assez fin pour qu'un rappel « une heure avant l'échéance » soit
 * tenu à la minute près, assez large pour que la requête — indexée sur
 * `escalation_at` — reste négligeable même sur une grosse base.
 */
const PERIODE_MS = 60_000;

/**
 * Nombre de tickets traités par cycle.
 *
 * Borné pour qu'un retard accumulé — après un arrêt prolongé — se rattrape en
 * plusieurs cycles courts plutôt qu'en une transaction interminable.
 */
const PAR_CYCLE = 200;

interface DueRow extends Record<string, unknown> {
  ticketId: number;
  entityId: number;
  levelId: number;
  levelName: string;
  agreementName: string;
}

interface ActionRow extends Record<string, unknown> {
  action:
    'set_priority' | 'set_urgency' | 'assign_group' | 'assign_user' | 'add_observer' | 'notify';
  value: string | null;
}

/**
 * Exécution des niveaux d'escalade.
 *
 * Le déclenchement est piloté par la base — `tickets.escalation_at` — et non
 * par une minuterie en mémoire : un redémarrage ne perd donc aucune escalade,
 * et plusieurs instances de l'API peuvent tourner sans se marcher dessus, la
 * trace dans `ticket_escalations` empêchant tout rejeu.
 */
@Injectable()
export class EscalationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EscalationService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly db: DatabaseService,
    private readonly sla: SlaService,
  ) {}

  async onModuleInit(): Promise<void> {
    const env = loadEnv();

    if (!env.RUN_EVENT_WORKER) return;

    const connection = { url: env.REDIS_URL };

    this.queue = new Queue(ESCALATION_QUEUE, {
      connection,
      defaultJobOptions: { removeOnComplete: 50, removeOnFail: 200 },
    });

    // Une tâche répétable nommée : BullMQ dédoublonne sur ce nom, donc plusieurs
    // instances de l'API ne produisent qu'un seul balayage par période.
    await this.queue.upsertJobScheduler(
      'balayage',
      { every: PERIODE_MS },
      { name: 'escalade', data: {} },
    );

    this.worker = new Worker(
      ESCALATION_QUEUE,
      async () => {
        await this.sweep();
      },
      { connection },
    );

    this.worker.on('error', (erreur) => {
      this.logger.error(`File d'escalade : ${erreur.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Traite les niveaux échus.
   *
   * Les tickets clos sont exclus : escalader un ticket fermé n'aurait aucun
   * destinataire utile, et rouvrirait une conversation terminée.
   */
  async sweep(maintenant = new Date()): Promise<number> {
    const echus = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<DueRow>(sql`
        SELECT t.id AS "ticketId", t.entity_id AS "entityId",
               n.id AS "levelId", n.name AS "levelName", a.name AS "agreementName"
          FROM tickets t
          JOIN agreement_levels n ON n.id = t.escalation_level_id
          JOIN agreements a ON a.id = n.agreement_id
         WHERE t.escalation_at IS NOT NULL
           AND t.escalation_at <= ${maintenant}
           AND t.deleted_at IS NULL
           AND t.status <> 'closed'
         ORDER BY t.escalation_at
         LIMIT ${PAR_CYCLE}
      `);

      return resultat.rows;
    });

    let executes = 0;

    for (const echu of echus) {
      try {
        if (await this.execute(echu)) executes += 1;
      } catch (error) {
        this.logger.error(
          `Escalade impossible sur le ticket ${String(echu.ticketId)} : ${String(error)}`,
        );
      }

      // Replanifie dans tous les cas, y compris après un échec : laisser
      // `escalation_at` dans le passé ferait retenter le même niveau à chaque
      // cycle, indéfiniment.
      await this.sla.refreshQuietly(echu.ticketId);
    }

    if (executes > 0) {
      this.logger.log(`${String(executes)} niveau(x) d'escalade execute(s).`);
    }

    return executes;
  }

  /**
   * Applique un niveau, une seule fois.
   *
   * La trace est écrite **avant** les actions, et son insertion sert de verrou :
   * si deux balayages concurrents attrapent le même ticket, le second voit le
   * conflit et n'applique rien.
   */
  private async execute(echu: DueRow): Promise<boolean> {
    const applique = await this.db.asOwner(async (tx) => {
      const trace = await tx.execute(sql`
        INSERT INTO ticket_escalations (ticket_id, level_id)
        VALUES (${echu.ticketId}, ${echu.levelId})
        ON CONFLICT DO NOTHING
      `);

      if (trace.rowCount === 0) return false;

      const actions = await tx.execute<ActionRow>(sql`
        SELECT action, value FROM agreement_level_actions
         WHERE level_id = ${echu.levelId} ORDER BY id
      `);

      for (const action of actions.rows) {
        await this.applyAction(tx, echu.ticketId, action);
      }

      await tx.execute(sql`
        INSERT INTO logs (entity_id, entity_path, item_type, item_id, field, new_value)
        SELECT t.entity_id, t.entity_path, 'ticket', t.id, 'escalade', ${echu.levelName}
          FROM tickets t WHERE t.id = ${echu.ticketId}
      `);

      return true;
    });

    if (applique) {
      emitEvent('ticket.escalated', {
        id: echu.ticketId,
        entityId: echu.entityId,
        levelId: echu.levelId,
        levelName: echu.levelName,
        agreementName: echu.agreementName,
      });
    }

    return applique;
  }

  private async applyAction(
    tx: Parameters<Parameters<DatabaseService['asOwner']>[0]>[0],
    ticketId: number,
    action: ActionRow,
  ): Promise<void> {
    const nombre = Number(action.value);
    const valide = Number.isInteger(nombre) && nombre > 0;

    switch (action.action) {
      case 'set_priority':
        if (valide && nombre <= 5) {
          await tx.execute(sql`UPDATE tickets SET priority = ${nombre} WHERE id = ${ticketId}`);
        }
        break;

      // Relever l'urgence ne peut qu'augmenter la priorité, jamais la baisser :
      // une escalade est un signal de gravité, et la recalculer par la matrice
      // pourrait paradoxalement rétrograder un ticket dont l'impact est faible.
      case 'set_urgency':
        if (valide && nombre <= 5) {
          await tx.execute(sql`
            UPDATE tickets t
               SET urgency = ${nombre},
                   priority = LEAST(5, GREATEST(1, GREATEST(t.priority, ${nombre})))
             WHERE t.id = ${ticketId}
          `);
        }
        break;

      case 'assign_group':
        if (valide) await this.addActor(tx, ticketId, 'assigned', 'group', nombre);
        break;

      case 'assign_user':
        if (valide) await this.addActor(tx, ticketId, 'assigned', 'user', nombre);
        break;

      case 'add_observer':
        if (valide) await this.addActor(tx, ticketId, 'observer', 'user', nombre);
        break;

      // La notification est portée par l'événement publié après coup : ce sont
      // les modèles de notification qui décident du contenu et des destinataires.
      case 'notify':
        break;
    }
  }

  private async addActor(
    tx: Parameters<Parameters<DatabaseService['asOwner']>[0]>[0],
    ticketId: number,
    role: 'assigned' | 'observer',
    actorType: 'user' | 'group',
    actorId: number,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO itil_actors (itil_type, itil_id, role, actor_type, actor_id)
      VALUES ('ticket', ${ticketId}, ${role}, ${actorType}, ${actorId})
      ON CONFLICT DO NOTHING
    `);
  }
}
