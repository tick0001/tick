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
        await this.dispatch(job);
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
        // Un module du coeur a ses propres services : ces acces-la sont ceux
        // d'un plugin, et n'ont pas a lui servir.
        settings: {
          get: () => Promise.reject(new Error('Reglages de plugin inaccessibles au coeur.')),
        },
        http: {
          request: () => Promise.reject(new Error('Sortie de plugin inaccessible au coeur.')),
        },
        instance: { webUrl: '' },
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
  /**
   * Distribue un evenement a ses abonnes.
   *
   * **Un abonne qui a reussi n'est pas rappele quand un autre echoue.** La
   * file reessaie le travail entier : sans cette memoire, un seul abonne en
   * echec rejouait tous les autres a chaque tentative. Les notifications du
   * coeur, qui s'interdisent d'echouer precisement pour ne pas produire de
   * doublons, repartaient alors cinq fois — il suffisait qu'un plugin joigne
   * un webhook momentanement injoignable.
   *
   * Un abonne se reconnait a son plugin et a son rang parmi les abonnements de
   * ce plugin a cet evenement. L'ordre d'enregistrement est celui de
   * l'activation, stable d'un demarrage a l'autre.
   */
  private async dispatch(job: Pick<Job<PendingEvent>, 'data' | 'updateData'>): Promise<void> {
    const event = job.data;
    const liste = this.registrations.get(event.name);

    this.logger.debug(
      `${event.name} -> ${String(liste?.length ?? 0)} abonne(s) : ` +
        `${(liste ?? []).map((r) => r.pluginId).join(', ') || 'aucun'}`,
    );

    if (!liste || liste.length === 0) return;

    const echecs: string[] = [];
    const traites = new Set(event.traites ?? []);
    const rangs = new Map<string, number>();

    for (const registration of liste) {
      const rang = rangs.get(registration.pluginId) ?? 0;
      const cle = `${registration.pluginId}#${String(rang)}`;

      rangs.set(registration.pluginId, rang + 1);

      if (traites.has(cle)) continue;

      try {
        await registration.handler(event.payload, registration.context);
        traites.add(cle);
      } catch (error) {
        echecs.push(`${registration.pluginId} : ${String(error)}`);
      }
    }

    if (echecs.length > 0) {
      // Retenu avant de lever : la tentative suivante lira ces donnees.
      await job.updateData({ ...event, traites: [...traites] });

      throw new Error(`Traitement partiel de ${event.name} — ${echecs.join(' ; ')}`);
    }
  }

  /** Nombre d'abonnements. Utile aux tests. */
  count(name?: EventName): number {
    if (name) return this.registrations.get(name)?.length ?? 0;

    return [...this.registrations.values()].reduce((total, liste) => total + liste.length, 0);
  }
}
