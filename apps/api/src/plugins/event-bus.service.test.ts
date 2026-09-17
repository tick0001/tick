import type { PluginContext } from '@tick/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { PendingEvent } from './event-buffer.js';
import { EventBus } from './event-bus.service.js';

/**
 * La distribution des événements, tentative après tentative.
 *
 * La file réessaie un travail entier quand un abonné échoue. Ce qui compte ici
 * est que les abonnés qui avaient réussi **ne soient pas rappelés** : les
 * notifications du cœur repartiraient sinon à chaque tentative, parce qu'un
 * plugin n'a pas pu joindre son webhook.
 *
 * Le bus n'est pas démarré : sans Redis, on appelle directement ce que la file
 * appellerait, avec un travail factice dont les données survivent d'une
 * tentative à l'autre.
 */

const contexte = {} as PluginContext;

type Distribuer = (job: {
  data: PendingEvent;
  updateData: (d: PendingEvent) => Promise<void>;
}) => Promise<void>;

function travail(): { data: PendingEvent; updateData: (d: PendingEvent) => Promise<void> } {
  const job = {
    data: {
      name: 'ticket.created',
      payload: { id: 42, entityId: 1, name: 'Panne', type: 'incident', priority: 3 },
    } as PendingEvent,
    updateData: vi.fn((donnees: PendingEvent) => {
      job.data = donnees;

      return Promise.resolve();
    }),
  };

  return job;
}

function distribuer(bus: EventBus): Distribuer {
  return (bus as unknown as { dispatch: Distribuer }).dispatch.bind(bus);
}

describe('EventBus', () => {
  it('ne rappelle pas les abonnes qui ont deja reussi', async () => {
    const bus = new EventBus();
    const coeur = vi.fn().mockResolvedValue(undefined);
    const fiable = vi.fn().mockResolvedValue(undefined);
    const capricieux = vi
      .fn()
      .mockRejectedValueOnce(new Error('webhook injoignable'))
      .mockResolvedValue(undefined);

    bus.registerCore('ticket.created', coeur);
    bus.register('fiable', contexte, 'ticket.created', fiable);
    bus.register('capricieux', contexte, 'ticket.created', capricieux);

    const job = travail();

    await expect(distribuer(bus)(job)).rejects.toThrow(/capricieux : Error: webhook injoignable/);
    expect(job.data.traites).toEqual(['@core#0', 'fiable#0']);

    await distribuer(bus)(job);

    expect(coeur).toHaveBeenCalledTimes(1);
    expect(fiable).toHaveBeenCalledTimes(1);
    expect(capricieux).toHaveBeenCalledTimes(2);
  });

  it('distingue deux abonnements d un meme plugin au meme evenement', async () => {
    const bus = new EventBus();
    const premier = vi.fn().mockResolvedValue(undefined);
    const second = vi.fn().mockRejectedValueOnce(new Error('non')).mockResolvedValue(undefined);

    bus.register('double', contexte, 'ticket.created', premier);
    bus.register('double', contexte, 'ticket.created', second);

    const job = travail();

    await expect(distribuer(bus)(job)).rejects.toThrow();
    await distribuer(bus)(job);

    expect(premier).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('ne touche pas aux donnees du travail quand tout reussit', async () => {
    const bus = new EventBus();

    bus.register('fiable', contexte, 'ticket.created', vi.fn().mockResolvedValue(undefined));

    const job = travail();

    await distribuer(bus)(job);

    expect(job.updateData).not.toHaveBeenCalled();
  });
});
