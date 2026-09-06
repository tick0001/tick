import { randomBytes } from 'node:crypto';
import {
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type {
  AnswerSurvey,
  PublicSurvey,
  SatisfactionConfig,
  SatisfactionStats,
  UpsertSatisfactionConfig,
} from '@tick/contracts';
import { satisfactionConfigs, sql } from '@tick/db';
import { Queue, Worker } from 'bullmq';
import { entityNames } from '../common/entity-names.js';
import { requireContext } from '../common/request-context.js';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';
import { emitEvent } from '../plugins/event-buffer.js';
import { EventBus } from '../plugins/event-bus.service.js';

export const SATISFACTION_QUEUE = 'tick.satisfaction';

/**
 * Période de balayage.
 *
 * Un quart d'heure : une enquête se programme en jours, et la faire partir à la
 * minute près n'apporte rien. Une tâche rare vaut mieux qu'une tâche exacte
 * quand personne n'attend le résultat.
 */
const PERIODE_MS = 900_000;

/** Enquêtes traitées par cycle, pour qu'un retard se rattrape par paliers. */
const PAR_CYCLE = 200;

interface ConfigRow extends Record<string, unknown> {
  id: number;
  entityId: number;
  isRecursive: boolean;
  isActive: boolean;
  percentage: number;
  delayDays: number;
  durationDays: number;
  reminderDays: number | null;
}

/**
 * Enquêtes de satisfaction.
 *
 * Une enquête n'est pas envoyée à la clôture mais **programmée** : le délai
 * laisse au demandeur le temps de constater que le problème ne revient pas, et
 * une enquête reçue dans la seconde qui suit la clôture mesure surtout la
 * vitesse du serveur de messagerie.
 */
@Injectable()
export class SatisfactionService implements OnApplicationBootstrap, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SatisfactionService.name);
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly db: DatabaseService,
    private readonly events: EventBus,
  ) {}

  onApplicationBootstrap(): void {
    this.events.registerCore('ticket.closed', async (payload) => {
      await this.schedule(payload.id, payload.entityId);
    });
  }

  async onModuleInit(): Promise<void> {
    const env = loadEnv();

    if (!env.RUN_EVENT_WORKER) return;

    const connection = { url: env.REDIS_URL };

    this.queue = new Queue(SATISFACTION_QUEUE, {
      connection,
      defaultJobOptions: { removeOnComplete: 20, removeOnFail: 100 },
    });

    await this.queue.upsertJobScheduler(
      'envoi',
      { every: PERIODE_MS },
      { name: 'enquetes', data: {} },
    );

    this.worker = new Worker(
      SATISFACTION_QUEUE,
      async () => {
        await this.sweep();
      },
      { connection },
    );

    this.worker.on('error', (erreur) => {
      this.logger.error(`File des enquetes : ${erreur.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }

  /**
   * Programme une enquête à la clôture, si le tirage la retient.
   *
   * Le tirage a lieu **une fois**, au moment de la clôture, et le résultat est
   * enregistré. Le rejouer à chaque balayage ferait qu'un ticket finirait
   * toujours par être tiré, et le taux ne voudrait plus rien dire.
   */
  private async schedule(ticketId: number, entityId: number): Promise<void> {
    try {
      const config = await this.resolveConfig(entityId);

      if (!config?.isActive) return;
      if (Math.random() * 100 >= config.percentage) return;

      const token = randomBytes(24).toString('base64url');

      await this.db.asOwner((tx) =>
        tx.execute(sql`
          INSERT INTO satisfactions
            (ticket_id, entity_id, entity_path, token, scheduled_at, expires_at)
          VALUES (
            ${ticketId}, ${entityId}, 'temporaire'::ltree, ${token},
            now() + make_interval(days => ${config.delayDays}),
            now() + make_interval(days => ${config.delayDays + config.durationDays})
          )
          ON CONFLICT (ticket_id) DO NOTHING
        `),
      );
    } catch (erreur) {
      this.logger.error(`Enquete non programmee pour ${String(ticketId)} : ${String(erreur)}`);
    }
  }

  /**
   * Envoie les enquêtes dues, et relance celles restées sans réponse.
   *
   * L'envoi passe par un événement : c'est un modèle de notification qui décide
   * du texte et de la langue, comme pour tout le reste. Écrire le courriel ici
   * en ferait le seul message de l'application que l'on ne peut pas modifier.
   */
  async sweep(): Promise<number> {
    const dues = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{
        id: number;
        ticketId: number;
        entityId: number;
        token: string;
      }>(sql`
        UPDATE satisfactions
           SET requested_at = now()
         WHERE id IN (
           SELECT s.id FROM satisfactions s
             JOIN tickets t ON t.id = s.ticket_id AND t.deleted_at IS NULL
            WHERE s.requested_at IS NULL AND s.scheduled_at <= now()
            ORDER BY s.scheduled_at
            LIMIT ${PAR_CYCLE}
         )
        RETURNING id, ticket_id AS "ticketId", entity_id AS "entityId", token
      `);

      return resultat.rows;
    });

    for (const enquete of dues) {
      emitEvent('satisfaction.requested', {
        id: enquete.ticketId,
        entityId: enquete.entityId,
        token: enquete.token,
        url: this.urlFor(enquete.token),
      });
    }

    await this.relancer();

    return dues.length;
  }

  /** Relance unique des enquêtes sans réponse, quand la configuration le prévoit. */
  private async relancer(): Promise<void> {
    const relances = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ ticketId: number; entityId: number; token: string }>(sql`
        UPDATE satisfactions s
           SET reminder_sent_at = now()
          FROM satisfaction_configs c
         WHERE s.answered_at IS NULL
           AND s.reminder_sent_at IS NULL
           AND s.requested_at IS NOT NULL
           AND (s.expires_at IS NULL OR s.expires_at > now())
           AND c.reminder_days IS NOT NULL
           AND c.is_active
           AND (c.entity_path = s.entity_path
                OR (c.is_recursive AND c.entity_path @> s.entity_path))
           AND s.requested_at + make_interval(days => c.reminder_days) <= now()
        RETURNING s.ticket_id AS "ticketId", s.entity_id AS "entityId", s.token
      `);

      return resultat.rows;
    });

    for (const enquete of relances) {
      emitEvent('satisfaction.requested', {
        id: enquete.ticketId,
        entityId: enquete.entityId,
        token: enquete.token,
        url: this.urlFor(enquete.token),
      });
    }
  }

  // --- Formulaire public -----------------------------------------------------

  /**
   * Enquête désignée par un jeton.
   *
   * Lue avec le rôle propriétaire : le répondant n'a pas de session, et c'est
   * précisément le propos. Le jeton fait office d'autorisation, et n'ouvre
   * l'accès qu'à cette seule enquête.
   */
  async byToken(token: string): Promise<PublicSurvey> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<PublicSurvey & Record<string, unknown>>(sql`
        SELECT s.ticket_id AS "ticketId", t.name AS "ticketName",
               t.date_closed AS "closedAt",
               (s.answered_at IS NOT NULL) AS answered,
               s.rating, s.comment
          FROM satisfactions s
          JOIN tickets t ON t.id = s.ticket_id
         WHERE s.token = ${token}
           AND s.requested_at IS NOT NULL
           AND (s.expires_at IS NULL OR s.expires_at > now())
           AND t.deleted_at IS NULL
      `);

      return resultat.rows;
    });

    const enquete = rows[0];

    if (!enquete) throw new NotFoundException('Enquete introuvable ou expiree.');

    return {
      ...enquete,
      closedAt: enquete.closedAt === null ? null : new Date(String(enquete.closedAt)).toISOString(),
    };
  }

  /**
   * Enregistre une réponse.
   *
   * Une seule fois : autoriser la modification transformerait le jeton, qui
   * circule en clair dans un courriel, en droit permanent de réécrire une
   * statistique.
   */
  async answer(token: string, reponse: AnswerSurvey): Promise<void> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ ticketId: number; entityId: number }>(sql`
        UPDATE satisfactions
           SET answered_at = now(), rating = ${reponse.rating},
               comment = ${reponse.comment ?? null}
         WHERE token = ${token}
           AND answered_at IS NULL
           AND requested_at IS NOT NULL
           AND (expires_at IS NULL OR expires_at > now())
        RETURNING ticket_id AS "ticketId", entity_id AS "entityId"
      `);

      return resultat.rows;
    });

    const enquete = rows[0];

    if (!enquete) throw new NotFoundException('Enquete introuvable, expiree ou deja repondue.');

    emitEvent('satisfaction.answered', {
      id: enquete.ticketId,
      entityId: enquete.entityId,
      rating: reponse.rating,
    });
  }

  // --- Configuration et statistiques -----------------------------------------

  async list(): Promise<SatisfactionConfig[]> {
    const rows = await this.db.asUser(async (tx) => {
      const resultat = await tx.execute<ConfigRow>(sql`
        SELECT id, entity_id AS "entityId", is_recursive AS "isRecursive",
               is_active AS "isActive", percentage, delay_days AS "delayDays",
               duration_days AS "durationDays", reminder_days AS "reminderDays"
          FROM satisfaction_configs ORDER BY id
      `);

      return resultat.rows;
    });

    const noms = await entityNames(
      this.db,
      rows.map((row) => row.entityId),
    );

    return rows.map((row) => ({
      id: row.id,
      entityId: row.entityId,
      entityName: noms.get(row.entityId) ?? '',
      isRecursive: row.isRecursive,
      isActive: row.isActive,
      percentage: row.percentage,
      delayDays: row.delayDays,
      durationDays: row.durationDays,
      reminderDays: row.reminderDays,
    }));
  }

  /** Enregistre la configuration de l'entité active, une par entité. */
  async save(input: UpsertSatisfactionConfig): Promise<SatisfactionConfig> {
    const context = requireContext();

    await this.db.asUser(async (tx) => {
      const resultat = await tx.execute(sql`
        UPDATE satisfaction_configs
           SET is_recursive = ${input.isRecursive}, is_active = ${input.isActive},
               percentage = ${input.percentage}, delay_days = ${input.delayDays},
               duration_days = ${input.durationDays},
               reminder_days = ${input.reminderDays ?? null}, updated_at = now()
         WHERE entity_id = ${context.entityId}
      `);

      if (resultat.rowCount === 0) {
        await tx.insert(satisfactionConfigs).values({
          entityId: context.entityId,
          entityPath: 'temporaire',
          isRecursive: input.isRecursive,
          isActive: input.isActive,
          percentage: input.percentage,
          delayDays: input.delayDays,
          durationDays: input.durationDays,
          reminderDays: input.reminderDays ?? null,
        });
      }
    });

    const configs = await this.list();
    const config = configs.find((ligne) => ligne.entityId === context.entityId);

    if (!config) throw new NotFoundException('Configuration introuvable apres enregistrement.');

    return config;
  }

  /** Statistiques du périmètre de travail courant. */
  async stats(): Promise<SatisfactionStats> {
    return this.db.asUser(async (tx) => {
      const global = await tx.execute<{
        requested: number;
        answered: number;
        moyenne: string | null;
      }>(
        sql`
          SELECT count(*) FILTER (WHERE requested_at IS NOT NULL)::int AS requested,
                 count(*) FILTER (WHERE answered_at IS NOT NULL)::int AS answered,
                 avg(rating) AS moyenne
            FROM satisfactions
        `,
      );

      const detail = await tx.execute<{ rating: number; count: number }>(sql`
        SELECT rating, count(*)::int AS count
          FROM satisfactions WHERE rating IS NOT NULL
         GROUP BY rating ORDER BY rating
      `);

      const ligne = global.rows[0];

      return {
        requested: ligne?.requested ?? 0,
        answered: ligne?.answered ?? 0,
        // La moyenne revient en `numeric`, donc en chaine : la convertir ici
        // evite de propager le type du pilote jusqu'a l'interface.
        averageRating:
          ligne?.moyenne === null || ligne?.moyenne === undefined
            ? null
            : Math.round(Number(ligne.moyenne) * 100) / 100,
        distribution: detail.rows,
      };
    });
  }

  /**
   * Configuration applicable à une entité, héritée d'un ancêtre récursif.
   *
   * Résolue en propriétaire : la clôture d'un ticket déclenche l'enquête depuis
   * un gestionnaire d'événement, hors de toute session.
   */
  private async resolveConfig(entityId: number): Promise<ConfigRow | null> {
    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<ConfigRow>(sql`
        SELECT c.id, c.entity_id AS "entityId", c.is_recursive AS "isRecursive",
               c.is_active AS "isActive", c.percentage, c.delay_days AS "delayDays",
               c.duration_days AS "durationDays", c.reminder_days AS "reminderDays"
          FROM satisfaction_configs c
          JOIN entities origine ON origine.id = c.entity_id
          JOIN entities cible ON cible.id = ${entityId}
         WHERE origine.path = cible.path
            OR (c.is_recursive AND origine.path @> cible.path)
         ORDER BY nlevel(origine.path) DESC
         LIMIT 1
      `);

      return resultat.rows;
    });

    return rows[0] ?? null;
  }

  private urlFor(token: string): string {
    return `${loadEnv().WEB_URL}/satisfaction/${token}`;
  }
}
