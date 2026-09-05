import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { EventHandler, EventName, PluginContext } from '@tick/plugin-sdk';
import { Queue, Worker, type Job } from 'bullmq';
import { loadEnv } from '../config/env.js';
import { setEventPublisher, type PendingEvent } from './event-buffer.js';

export const EVENT_QUEUE = 'tick.events';

/** Identifiant conventionnel des abonnements du coeur. */
const CORE = '@core';

interface Registration {
  pluginId: string;
  /** Non typee dans le registre, pour la meme raison que dans le bus de hooks. */
  handler: (payload: unknown, context: PluginContext) => unknown;
  context: PluginContext;
}

/**
 * Bus des événements : asynchrones, publiés après le commit, réessayables.
 *
 * Ils ne peuvent ni modifier la donnée ni annuler l'opération. En contrepartie,
 * un gestionnaire lent ou en échec n'a aucun effet sur l'écriture métier, et
 * peut être rejoué sans risque de double écriture.
 */
@Injectable()
export class EventBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBus.name);
  private readonly registrations = new Map<EventName, Registration[]>();
  private queue?: Queue;
  private worker?: Worker;

  onModuleInit(): void {
    const env = loadEnv();
    const connection = { url: env.REDIS_URL };

    this.queue = new Queue(EVENT_QUEUE, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    });

    // Publier reste toujours possible ; consommer est reserve aux processus
    // qui le declarent. Un outil en ligne de commande depilerait sinon des
    // evenements destines a l'API.
    if (!env.RUN_EVENT_WORKER) {
      setEventPublisher((events) => this.publish(events));

      return;
    }

    this.worker = new Worker(
      EVENT_QUEUE,
      async (job: Job<PendingEvent>) => {
        await this.dispatch(job.data);
      },
      { connection },
    );

    this.worker.on('failed', (job: Job<PendingEvent> | undefined, error: Error) => {
      this.logger.warn(`Evenement ${job?.data.name ?? '?'} en echec : ${error.message}`);
    });

    // Sans ecouteur, une erreur de connexion emise par le worker remonte en
    // exception non gouvernee et fait tomber le processus.
    this.worker.on('error', (error) => {
      this.logger.error(`File d'evenements : ${error.message}`);
    });

    setEventPublisher((events) => this.publish(events));
  }

  async onModuleDestroy(): Promise<void> {
    setEventPublisher(undefined);
    await this.worker?.close();
    await this.queue?.close();
  }

  register<K extends EventName>(
    pluginId: string,
    context: PluginContext,
    name: K,
    handler: EventHandler<K>,
  ): void {
    const liste = this.registrations.get(name) ?? [];

    liste.push({
      pluginId,
      handler: handler as (payload: unknown, context: PluginContext) => unknown,
      context,
    });
    this.registrations.set(name, liste);
  }

  /**
   * Abonnement d'un module du coeur.
   *
   * Distinct de `register` : un module du coeur n'a ni manifeste ni permission
   * a declarer, et ne doit pas etre retire quand on desactive un plugin. Le
   * faire passer pour un plugin le rendrait desactivable par accident.
   */
  registerCore<K extends EventName>(name: K, handler: EventHandler<K>): void {
    const liste = this.registrations.get(name) ?? [];

    liste.push({
      pluginId: CORE,
      handler: handler as (payload: unknown, context: PluginContext) => unknown,
      context: {
        id: CORE,
        version: '0',
        schema: 'public',
        logger: {
          debug: () => undefined,
          log: () => undefined,
          warn: () => undefined,
          error: () => undefined,
        },
        db: { query: () => Promise.resolve([]) },
      },
    });
    this.registrations.set(name, liste);
  }

  unregisterPlugin(pluginId: string): void {
    if (pluginId === CORE) return;

    for (const [name, liste] of this.registrations) {
      this.registrations.set(
        name,
        liste.filter((registration) => registration.pluginId !== pluginId),
      );
    }
  }

  /** Publie les événements retenus. Appelé après le commit. */
  async publish(events: readonly PendingEvent[]): Promise<void> {
    if (events.length === 0 || !this.queue) return;

    await this.queue.addBulk(events.map((event) => ({ name: event.name, data: event })));
  }

  /**
   * Remet un événement à ses abonnés.
   *
   * Une exception d'un gestionnaire est propagée pour que BullMQ réessaie, mais
   * les autres gestionnaires ont déjà été servis : un plugin défaillant ne prive
   * pas les autres de l'événement.
   */
  private async dispatch(event: PendingEvent): Promise<void> {
    const liste = this.registrations.get(event.name);

    this.logger.debug(
      `${event.name} -> ${String(liste?.length ?? 0)} abonne(s) : ` +
        `${(liste ?? []).map((r) => r.pluginId).join(', ') || 'aucun'}`,
    );

    if (!liste || liste.length === 0) return;

    const echecs: string[] = [];

    for (const registration of liste) {
      try {
        await registration.handler(event.payload, registration.context);
      } catch (error) {
        echecs.push(`${registration.pluginId} : ${String(error)}`);
      }
    }

    if (echecs.length > 0) {
      throw new Error(`Traitement partiel de ${event.name} — ${echecs.join(' ; ')}`);
    }
  }

  /** Nombre d'abonnements. Utile aux tests. */
  count(name?: EventName): number {
    if (name) return this.registrations.get(name)?.length ?? 0;

    return [...this.registrations.values()].reduce((total, liste) => total + liste.length, 0);
  }
}
