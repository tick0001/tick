import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { sql } from '@tick/db';
import { Redis } from 'ioredis';
import { loadEnv } from '../config/env.js';
import { DatabaseService } from '../database/database.service.js';

/** Au-dela, la dependance est consideree comme injoignable. */
const DELAI_MS = 2_000;

/**
 * Interroge reellement les dependances.
 *
 * La sonde se contentait de repondre `ok` : un conteneur dont la base etait
 * tombee restait marque « healthy », Compose ne redemarrait rien, et la
 * supervision restait au vert pendant que le service ne servait plus. Une sonde
 * qui ne verifie rien est pire qu'une absence de sonde, parce qu'on lui fait
 * confiance.
 *
 * Les deux verifications sont bornees dans le temps : une base qui ne repond
 * pas est indiscernable d'une base absente, et une sonde qui attend indefiniment
 * ne repond jamais — donc echoue par expiration du client, mais bien plus tard
 * et sans dire pourquoi.
 */
@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly logger = new Logger(HealthService.name);
  private redis?: Redis;

  constructor(private readonly db: DatabaseService) {}

  /**
   * Connexion propre a la sonde.
   *
   * Les files BullMQ ouvrent les leurs, mais elles ne sont pas exposees, et
   * emprunter la connexion d'une file ferait dependre la sonde de l'etat
   * interne d'un service qu'elle n'a pas a connaitre.
   *
   * `enableOfflineQueue: false` et une seule tentative : sans cela, `ping()`
   * est mis en attente jusqu'au retour de Redis au lieu d'echouer, et la sonde
   * expire au lieu de repondre « degrade ».
   */
  private get client(): Redis {
    this.redis ??= new Redis(loadEnv().REDIS_URL, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: DELAI_MS,
      retryStrategy: () => null,
    });

    return this.redis;
  }

  private async borne<T>(travail: Promise<T>): Promise<boolean> {
    let minuterie: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        travail,
        new Promise((_, rejeter) => {
          minuterie = setTimeout(() => {
            rejeter(new Error(`Pas de reponse en ${String(DELAI_MS)} ms.`));
          }, DELAI_MS);
        }),
      ]);

      return true;
    } catch (erreur) {
      this.logger.warn(`Dependance injoignable : ${String(erreur)}`);

      return false;
    } finally {
      if (minuterie) clearTimeout(minuterie);
    }
  }

  async base(): Promise<boolean> {
    return this.borne(this.db.asOwner((tx) => tx.execute(sql`SELECT 1`)));
  }

  async files(): Promise<boolean> {
    return this.borne(
      (async () => {
        if (this.client.status !== 'ready') await this.client.connect();

        return this.client.ping();
      })(),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }
}
