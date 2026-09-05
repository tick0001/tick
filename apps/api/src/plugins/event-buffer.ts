import { AsyncLocalStorage } from 'node:async_hooks';
import type { EventName, EventPayloads } from '@tick/plugin-sdk';

export interface PendingEvent {
  name: EventName;
  payload: EventPayloads[EventName];
}

/**
 * Tampon des événements de la transaction en cours.
 *
 * Volontairement hors du conteneur d'injection : la couche données doit pouvoir
 * ouvrir un tampon et le vider après le commit, sans dépendre du bus, qui lui
 * dépend de la configuration et de Redis. Les faire se connaître produirait un
 * cycle entre deux briques qui n'ont rien à se dire.
 */
const buffer = new AsyncLocalStorage<PendingEvent[]>();

type Publisher = (events: readonly PendingEvent[]) => Promise<void>;

let publisher: Publisher | undefined;

/** Installé par le bus au démarrage. */
export function setEventPublisher(next: Publisher | undefined): void {
  publisher = next;
}

/**
 * Signale un événement.
 *
 * Dans une transaction, il est retenu jusqu'au commit : aucune notification ne
 * part pour une écriture annulée. En dehors, il est publié immédiatement.
 */
export function emitEvent<K extends EventName>(name: K, payload: EventPayloads[K]): void {
  const collected = buffer.getStore();

  if (collected) {
    collected.push({ name, payload });

    return;
  }

  void publisher?.([{ name, payload }]);
}

/** Exécute le travail avec un tampon, et renvoie ce qu'il a reçu. */
export async function withEventBuffer<T>(
  work: () => Promise<T>,
): Promise<{ result: T; events: PendingEvent[] }> {
  const collected: PendingEvent[] = [];
  const result = await buffer.run(collected, work);

  return { result, events: collected };
}

/** Publie les événements retenus. Appelé une fois la transaction validée. */
export async function flushEvents(events: readonly PendingEvent[]): Promise<void> {
  if (events.length === 0) return;

  await publisher?.(events);
}
