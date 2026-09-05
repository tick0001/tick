import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import type { HookHandler, HookName, HookPayloads, PluginContext } from '@tick/plugin-sdk';

/**
 * Délai maximal accordé à un hook, en millisecondes.
 *
 * Un hook s'exécute dans la transaction : le laisser durer bloque une
 * connexion, tient des verrous et dégrade toute l'instance. Mieux vaut annuler
 * l'écriture avec une erreur nommée qu'accumuler des transactions ouvertes.
 */
const HOOK_TIMEOUT_MS = 2_000;

interface Registration {
  pluginId: string;
  priority: number;
  /**
   * Volontairement non typee ici : le registre melange des hooks de charges
   * utiles differentes, que seul l'appelant de `run` peut relier. Le typage
   * strict vit sur les methodes publiques, la ou il sert au plugin.
   */
  handler: (payload: unknown, context: PluginContext) => unknown;
  context: PluginContext;
}

/**
 * Bus des hooks : synchrones, dans la transaction, capables de modifier la
 * charge utile ou d'annuler l'opération.
 *
 * C'est la moitié « bloquante » du contrat d'extension. L'autre moitié, les
 * événements, est asynchrone et ne peut rien annuler. Confondre les deux est
 * l'erreur qui rend un système de plugins ingérable : soit les notifications
 * partent pour des écritures annulées, soit une règle métier ne peut pas
 * refuser une écriture.
 */
@Injectable()
export class HookBus {
  private readonly logger = new Logger(HookBus.name);
  private readonly registrations = new Map<string, Registration[]>();
  private readonly failures = new Map<string, number>();
  private onFailure?: (pluginId: string, error: unknown, count: number) => void;

  /** Prévient le cycle de vie qu'un plugin défaille, pour qu'il le désactive. */
  setFailureListener(listener: (pluginId: string, error: unknown, count: number) => void): void {
    this.onFailure = listener;
  }

  register<K extends HookName>(
    pluginId: string,
    context: PluginContext,
    name: K,
    handler: HookHandler<K>,
    priority = 100,
  ): void {
    const liste = this.registrations.get(name) ?? [];

    liste.push({
      pluginId,
      priority,
      handler: handler as (payload: unknown, context: PluginContext) => unknown,
      context,
    });
    liste.sort((a, b) => a.priority - b.priority);
    this.registrations.set(name, liste);
  }

  /** Retire tous les hooks d'un plugin. Appelé à la désactivation. */
  unregisterPlugin(pluginId: string): void {
    for (const [name, liste] of this.registrations) {
      this.registrations.set(
        name,
        liste.filter((registration) => registration.pluginId !== pluginId),
      );
    }

    this.failures.delete(pluginId);
  }

  /**
   * Exécute la chaîne de hooks et renvoie la charge utile éventuellement
   * transformée.
   *
   * Chaque hook reçoit le résultat du précédent, dans l'ordre des priorités.
   * Une exception interrompt la chaîne et remonte : l'écriture est annulée, et
   * l'erreur nomme le plugin fautif pour que le diagnostic ne soit pas une
   * enquête.
   */
  async run<K extends HookName>(name: K, payload: HookPayloads[K]): Promise<HookPayloads[K]> {
    const liste = this.registrations.get(name);

    if (!liste || liste.length === 0) return payload;

    let courant = payload;

    for (const registration of liste) {
      try {
        const resultat = await this.withTimeout(
          registration,
          name,
          Promise.resolve(registration.handler(courant, registration.context)),
        );

        if (resultat !== undefined && resultat !== null) {
          courant = resultat as HookPayloads[K];
        }
      } catch (error) {
        this.recordFailure(registration.pluginId, error);

        throw new InternalServerErrorException(
          `Le plugin « ${registration.pluginId} » a refusé l'opération sur ${name} : ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return courant;
  }

  private async withTimeout<T>(
    registration: Registration,
    name: string,
    work: Promise<T>,
  ): Promise<T> {
    let minuterie: NodeJS.Timeout | undefined;

    const echeance = new Promise<never>((_resolve, reject) => {
      minuterie = setTimeout(() => {
        reject(new Error(`délai de ${String(HOOK_TIMEOUT_MS)} ms dépassé sur ${name}`));
      }, HOOK_TIMEOUT_MS);
    });

    try {
      return await Promise.race([work, echeance]);
    } finally {
      if (minuterie) clearTimeout(minuterie);
    }
  }

  private recordFailure(pluginId: string, error: unknown): void {
    const count = (this.failures.get(pluginId) ?? 0) + 1;

    this.failures.set(pluginId, count);
    this.logger.warn(`Hook en echec pour ${pluginId} (${String(count)}) : ${String(error)}`);
    this.onFailure?.(pluginId, error, count);
  }

  /** Nombre de hooks enregistrés, tous plugins confondus. Utile aux tests. */
  count(name?: HookName): number {
    if (name) return this.registrations.get(name)?.length ?? 0;

    return [...this.registrations.values()].reduce((total, liste) => total + liste.length, 0);
  }
}
