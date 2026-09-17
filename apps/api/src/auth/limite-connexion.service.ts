import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { loadEnv } from '../config/env.js';

/**
 * Limite des tentatives de connexion.
 *
 * Deux compteurs, parce qu'ils arrêtent deux attaques différentes :
 *
 * - **par adresse** : une machine qui essaie des mots de passe sur des
 *   centaines de comptes, un par un, ne déclenche jamais le verrou d'un
 *   compte. Au-delà de {@link ECHECS_PAR_ADRESSE} échecs en
 *   {@link FENETRE_ADRESSE_MS}, elle est refusée jusqu'à la fin de la fenêtre ;
 * - **par compte** : des tentatives venues de nombreuses adresses sur un même
 *   compte. Après {@link ECHECS_AVANT_BLOCAGE} échecs, chaque échec bloque le
 *   compte un temps qui double, de une à quinze minutes.
 *
 * Un refus est prononcé **avant** de vérifier le mot de passe. C'est ce qui
 * désarme le déni de service : chaque vérification Argon2 coûte volontairement
 * cher au serveur, et une rafale de tentatives anonymes l'aurait saturé.
 *
 * Le compte est bloqué, pas désactivé : le blocage expire seul, et une
 * connexion réussie remet le compteur à zéro. Un inconnu peut donc retarder la
 * connexion d'un compte dont il connaît l'identifiant — pas la lui retirer.
 *
 * L'identifiant est compté qu'il existe ou non : ne compter que les comptes
 * existants dirait lesquels existent.
 *
 * L'état vit dans Redis, partagé entre les instances de l'API. Redis
 * injoignable, il passe en mémoire, par instance : une limite approximative
 * vaut mieux qu'aucune, et mieux qu'un écran de connexion en panne.
 */

export const ECHECS_AVANT_BLOCAGE = 5;
export const BLOCAGE_MINIMAL_MS = 60_000;
export const BLOCAGE_MAXIMAL_MS = 15 * 60_000;
/** Un compte oublie ses échecs un quart d'heure après le dernier. */
export const OUBLI_COMPTE_MS = 15 * 60_000;
export const ECHECS_PAR_ADRESSE = 20;
export const FENETRE_ADRESSE_MS = 15 * 60_000;

const PREFIXE = 'tick:connexion:';
const ATTENTE_CONNEXION_MS = 500;

/** Ce que le limiteur attend d'un stockage. Les durées sont en millisecondes. */
export interface MagasinDeCompteurs {
  /** Incrémente, pose l'expiration à la première écriture, rend la valeur. */
  incrementer(cle: string, dureeMs: number, prolonger: boolean): Promise<number>;
  /** Valeur et durée de vie restante, ou `null`. */
  lire(cle: string): Promise<{ valeur: number; resteMs: number } | null>;
  ecrire(cle: string, valeur: number, dureeMs: number): Promise<void>;
  supprimer(cles: string[]): Promise<void>;
}

/** Stockage de repli, propre à l'instance. */
export class MagasinEnMemoire implements MagasinDeCompteurs {
  private readonly entrees = new Map<string, { valeur: number; expire: number }>();

  constructor(private readonly maintenant: () => number = Date.now) {}

  private vivante(cle: string) {
    const entree = this.entrees.get(cle);

    if (entree && entree.expire <= this.maintenant()) {
      this.entrees.delete(cle);

      return undefined;
    }

    return entree;
  }

  incrementer(cle: string, dureeMs: number, prolonger: boolean): Promise<number> {
    const entree = this.vivante(cle);
    const expire = entree && !prolonger ? entree.expire : this.maintenant() + dureeMs;
    const valeur = (entree?.valeur ?? 0) + 1;

    this.entrees.set(cle, { valeur, expire });
    this.borner();

    return Promise.resolve(valeur);
  }

  lire(cle: string): Promise<{ valeur: number; resteMs: number } | null> {
    const entree = this.vivante(cle);

    return Promise.resolve(
      entree ? { valeur: entree.valeur, resteMs: entree.expire - this.maintenant() } : null,
    );
  }

  ecrire(cle: string, valeur: number, dureeMs: number): Promise<void> {
    this.entrees.set(cle, { valeur, expire: this.maintenant() + dureeMs });
    this.borner();

    return Promise.resolve();
  }

  supprimer(cles: string[]): Promise<void> {
    for (const cle of cles) this.entrees.delete(cle);

    return Promise.resolve();
  }

  /**
   * Une mémoire qui ne se vide jamais serait le déni de service suivant : une
   * adresse par tentative suffirait à la remplir. Au-delà de la limite, les
   * entrées les plus anciennes partent — une `Map` garde l'ordre d'insertion.
   */
  private borner(): void {
    if (this.entrees.size <= MagasinEnMemoire.LIMITE) return;

    for (const cle of this.entrees.keys()) {
      this.entrees.delete(cle);
      if (this.entrees.size <= MagasinEnMemoire.LIMITE * 0.9) break;
    }
  }

  static readonly LIMITE = 100_000;
}

class MagasinRedis implements MagasinDeCompteurs {
  constructor(private readonly redis: Redis) {}

  async incrementer(cle: string, dureeMs: number, prolonger: boolean): Promise<number> {
    // Sans prolongation, la fenêtre part de la première tentative : un
    // attaquant ne la repousse pas en insistant. `SET … NX` puis `INCR`, qui
    // conserve l'expiration, plutôt que `PEXPIRE … NX`, réservé à Redis 7.
    const transaction = prolonger
      ? this.redis.multi().incr(cle).pexpire(cle, dureeMs)
      : this.redis.multi().set(cle, 0, 'PX', dureeMs, 'NX').incr(cle);
    const resultats = await transaction.exec();
    const increment = resultats?.[prolonger ? 0 : 1];

    if (!increment || increment[0]) throw increment?.[0] ?? new Error('Transaction Redis vide.');

    return Number(increment[1]);
  }

  async lire(cle: string): Promise<{ valeur: number; resteMs: number } | null> {
    const [valeur, reste] = await Promise.all([this.redis.get(cle), this.redis.pttl(cle)]);

    return valeur === null ? null : { valeur: Number(valeur), resteMs: Math.max(reste, 0) };
  }

  async ecrire(cle: string, valeur: number, dureeMs: number): Promise<void> {
    await this.redis.set(cle, String(valeur), 'PX', dureeMs);
  }

  async supprimer(cles: string[]): Promise<void> {
    if (cles.length > 0) await this.redis.del(...cles);
  }
}

/** Durée du blocage après le n-ième échec consécutif d'un compte, ou 0. */
export function dureeDeBlocage(echecs: number): number {
  if (echecs < ECHECS_AVANT_BLOCAGE) return 0;

  return Math.min(BLOCAGE_MINIMAL_MS * 2 ** (echecs - ECHECS_AVANT_BLOCAGE), BLOCAGE_MAXIMAL_MS);
}

@Injectable()
export class LimiteConnexionService implements OnModuleDestroy {
  private readonly logger = new Logger(LimiteConnexionService.name);
  private readonly memoire = new MagasinEnMemoire();
  private redis?: Redis;
  private magasinImpose?: MagasinDeCompteurs;
  private degradeSignale = false;

  /** Pour les tests : un stockage choisi plutôt que Redis. */
  static avec(magasin: MagasinDeCompteurs): LimiteConnexionService {
    const service = new LimiteConnexionService();

    service.magasinImpose = magasin;

    return service;
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis?.quit().catch(() => undefined);
  }

  /**
   * Temps d'attente avant qu'une tentative soit examinée, en millisecondes.
   * 0 : la tentative peut être vérifiée.
   */
  async attente(identifiant: string, adresse: string | undefined): Promise<number> {
    return this.avecRepli(async (magasin) => {
      const [compte, parAdresse] = await Promise.all([
        magasin.lire(this.cleBlocage(identifiant)),
        adresse ? magasin.lire(this.cleAdresse(adresse)) : Promise.resolve(null),
      ]);

      const attenteCompte = compte ? compte.resteMs : 0;
      const attenteAdresse =
        parAdresse && parAdresse.valeur >= ECHECS_PAR_ADRESSE ? parAdresse.resteMs : 0;

      return Math.max(attenteCompte, attenteAdresse);
    });
  }

  /** Consigne un échec ; rend le blocage qu'il déclenche, en millisecondes. */
  async echec(identifiant: string, adresse: string | undefined): Promise<number> {
    return this.avecRepli(async (magasin) => {
      if (adresse) {
        await magasin.incrementer(this.cleAdresse(adresse), FENETRE_ADRESSE_MS, false);
      }

      const echecs = await magasin.incrementer(this.cleEchecs(identifiant), OUBLI_COMPTE_MS, true);
      const blocage = dureeDeBlocage(echecs);

      if (blocage > 0) {
        await magasin.ecrire(this.cleBlocage(identifiant), 1, blocage);
      }

      return blocage;
    });
  }

  /** Une connexion réussie efface l'historique du compte, pas celui de l'adresse. */
  async succes(identifiant: string): Promise<void> {
    await this.avecRepli((magasin) =>
      magasin.supprimer([this.cleEchecs(identifiant), this.cleBlocage(identifiant)]),
    );
  }

  private async avecRepli<T>(travail: (magasin: MagasinDeCompteurs) => Promise<T>): Promise<T> {
    if (this.magasinImpose) return travail(this.magasinImpose);

    try {
      const resultat = await travail(new MagasinRedis(await this.redisPret()));

      this.degradeSignale = false;

      return resultat;
    } catch (erreur) {
      if (!this.degradeSignale) {
        this.logger.warn(
          `Redis injoignable, limite des connexions tenue en memoire : ${String(erreur)}`,
        );
        this.degradeSignale = true;
      }

      return travail(this.memoire);
    }
  }

  /**
   * Le client, une fois connecté.
   *
   * Au démarrage, la connexion s'établit en quelques millisecondes : sans cette
   * attente, les premières tentatives passeraient en mémoire, et leurs
   * compteurs seraient perdus pour Redis. Une connexion perdue, elle, n'est
   * pas attendue — la tentative bascule aussitôt en mémoire.
   */
  private async redisPret(): Promise<Redis> {
    const client = this.client;

    if (client.status === 'ready') return client;
    if (!['wait', 'connecting', 'connect'].includes(client.status)) {
      throw new Error(`Redis indisponible (${client.status}).`);
    }

    await new Promise<void>((resoudre, rejeter) => {
      const pret = () => {
        clearTimeout(minuterie);
        resoudre();
      };
      const minuterie = setTimeout(() => {
        client.off('ready', pret);
        rejeter(new Error('Redis ne repond pas.'));
      }, ATTENTE_CONNEXION_MS);

      client.once('ready', pret);
    });

    return client;
  }

  private get client(): Redis {
    this.redis ??= new Redis(loadEnv().REDIS_URL, {
      lazyConnect: true,
      // Échouer tout de suite plutôt que d'attendre Redis : la connexion d'un
      // utilisateur ne doit pas rester suspendue à une dépendance tombée.
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
    });

    // Les échecs remontent par les commandes, qui basculent en mémoire.
    // L'écouteur évite seulement qu'ioredis ne les répète dans le journal.
    this.redis.on('error', () => undefined);

    if (this.redis.status === 'wait') {
      this.redis.connect().catch(() => undefined);
    }

    return this.redis;
  }

  /** L'identifiant est condensé : Redis n'a pas à conserver des noms de comptes. */
  private cleCompte(identifiant: string): string {
    return createHash('sha256').update(identifiant.trim().toLowerCase()).digest('hex');
  }

  private cleEchecs(identifiant: string): string {
    return `${PREFIXE}echecs:${this.cleCompte(identifiant)}`;
  }

  private cleBlocage(identifiant: string): string {
    return `${PREFIXE}blocage:${this.cleCompte(identifiant)}`;
  }

  private cleAdresse(adresse: string): string {
    return `${PREFIXE}adresse:${adresse}`;
  }
}
