import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eq, notificationQueue, sql } from '@tick/db';
import { withSubjectToken } from '../mail/mail-message.js';
import { Queue, Worker, type Job } from 'bullmq';
import { createTransport, type Transporter } from 'nodemailer';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';

export const MAIL_QUEUE = 'tick.mail';

/** Au-delà, le message est marqué en échec définitif plutôt que réessayé sans fin. */
const MAX_ATTEMPTS = 5;

/**
 * Envoi des messages de la file.
 *
 * L'état vit en base et la file BullMQ ne sert qu'à cadencer les tentatives :
 * si Redis est vidé, aucun message n'est perdu, ils restent simplement en
 * attente jusqu'à la prochaine relance. L'inverse — l'état dans Redis seul —
 * perdrait la trace des envois au premier redémarrage.
 */
@Injectable()
export class MailerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MailerService.name);
  private queue?: Queue;
  private worker?: Worker;
  private transport?: Transporter;

  constructor(private readonly db: DatabaseService) {}

  onModuleInit(): void {
    const env = loadEnv();
    const connection = { url: env.REDIS_URL };

    this.queue = new Queue(MAIL_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: MAX_ATTEMPTS,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 500,
        removeOnFail: 2_000,
      },
    });

    if (!env.RUN_EVENT_WORKER) return;

    this.transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
    });

    this.worker = new Worker(
      MAIL_QUEUE,
      async (job: Job<{ id: number }>) => {
        await this.send(job.data.id);
      },
      { connection },
    );

    this.worker.on('error', (erreur) => {
      this.logger.error(`File de messages : ${erreur.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.transport?.close();
  }

  async enqueue(id: number): Promise<void> {
    await this.queue?.add('mail', { id });
  }

  /**
   * Adresses d'expedition et de reponse applicables a une entite.
   *
   * Heritees de l'ancetre le plus proche qui en declare, comme toute
   * configuration. Resolues avec le role proprietaire : l'envoi a lieu hors de
   * toute session, et le parametre lu ne revele rien d'autre qu'une adresse
   * deja portee par chaque message envoye.
   */
  private async adressesDe(
    entityId: number | null,
  ): Promise<{ from: string; replyTo: string | null }> {
    const env = loadEnv();

    if (!entityId) return { from: env.SMTP_FROM, replyTo: null };

    const rows = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{
        mailFrom: string | null;
        mailReplyTo: string | null;
      }>(sql`
        SELECT s.mail_from AS "mailFrom", s.mail_reply_to AS "mailReplyTo"
          FROM entity_settings s
          JOIN entities origine ON origine.id = s.entity_id
          JOIN entities cible ON cible.id = ${entityId}
         WHERE origine.path @> cible.path
           AND (s.mail_from IS NOT NULL OR s.mail_reply_to IS NOT NULL)
         ORDER BY nlevel(origine.path) DESC
         LIMIT 1
      `);

      return resultat.rows;
    });

    return {
      from: rows[0]?.mailFrom ?? env.SMTP_FROM,
      replyTo: rows[0]?.mailReplyTo ?? null,
    };
  }

  /**
   * Envoie un message de la file.
   *
   * Relit l'état en base avant d'envoyer : un message déjà parti ne doit pas
   * l'être une seconde fois si la tâche est rejouée.
   */
  private async send(id: number): Promise<void> {
    const [ligne] = await this.db.asOwner((tx) =>
      tx.select().from(notificationQueue).where(eq(notificationQueue.id, id)),
    );

    if (!ligne || ligne.state !== 'pending') return;

    // Le sujet porte le marqueur du ticket, et l'identifiant du message est
    // conserve : ce sont les deux fils par lesquels une reponse retrouvera son
    // ticket, le second etant le seul fiable quand le sujet a ete reecrit.
    const sujet =
      ligne.itemType === 'ticket' && ligne.itemId
        ? withSubjectToken(ligne.subject, ligne.itemId)
        : ligne.subject;

    const adresses = await this.adressesDe(ligne.entityId);

    try {
      const envoi = await this.transport?.sendMail({
        from: adresses.from,
        to: ligne.recipientEmail,
        subject: sujet,
        text: ligne.bodyText,
        ...(adresses.replyTo ? { replyTo: adresses.replyTo } : {}),
        ...(ligne.bodyHtml ? { html: ligne.bodyHtml } : {}),
      });

      await this.db.asOwner((tx) =>
        tx
          .update(notificationQueue)
          .set({
            state: 'sent',
            sentAt: new Date(),
            attempts: ligne.attempts + 1,
            messageId: envoi?.messageId ?? null,
          })
          .where(eq(notificationQueue.id, id)),
      );
    } catch (erreur) {
      const tentatives = ligne.attempts + 1;
      const definitif = tentatives >= MAX_ATTEMPTS;

      await this.db.asOwner((tx) =>
        tx
          .update(notificationQueue)
          .set({
            attempts: tentatives,
            lastError: String(erreur),
            ...(definitif ? { state: 'failed' as const } : {}),
          })
          .where(eq(notificationQueue.id, id)),
      );

      // Propagée pour que BullMQ réessaie, tant que la limite n'est pas atteinte.
      if (!definitif) throw erreur;

      this.logger.warn(`Message ${String(id)} abandonne apres ${String(tentatives)} tentatives.`);
    }
  }

  /**
   * Remet en file les messages restés en attente.
   *
   * Utile après un redémarrage : la file Redis peut avoir été vidée alors que
   * les messages, eux, sont toujours en base.
   */
  async requeuePending(): Promise<number> {
    const lignes = await this.db.asOwner(async (tx) => {
      const resultat = await tx.execute<{ id: number } & Record<string, unknown>>(
        sql`SELECT id FROM notification_queue WHERE state = 'pending' ORDER BY created_at LIMIT 500`,
      );

      return resultat.rows;
    });

    for (const ligne of lignes) await this.enqueue(ligne.id);

    return lignes.length;
  }
}
