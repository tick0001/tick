import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PluginRefusal, type PluginContext } from '@tick/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HookBus } from './hook-bus.service.js';

/**
 * Refus et pannes.
 *
 * Un hook qui refuse fait son travail ; un hook qui plante ne le fait pas. Les
 * deux annulent l'opération, mais seules les pannes consécutives désactivent
 * un plugin — sinon le plugin qui refuse un titre trop court serait éteint au
 * troisième titre refusé.
 */

const CONTEXTE = {} as PluginContext;

const TICKET = {
  entityId: 1,
  name: 'Imprimante',
  content: '',
  type: 'incident' as const,
  urgency: 3,
  impact: 3,
  categoryId: null,
};

describe('HookBus', () => {
  let bus: HookBus;
  let echecs: number[];

  beforeEach(() => {
    bus = new HookBus();
    echecs = [];
    bus.setFailureListener((_plugin, _erreur, compte) => echecs.push(compte));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rend un refus comme une erreur de saisie, sans le compter', async () => {
    bus.register('filtre', CONTEXTE, 'ticket.beforeCreate', () => {
      throw new PluginRefusal('titre trop court');
    });

    for (let essai = 0; essai < 5; essai += 1) {
      const erreur = await bus.run('ticket.beforeCreate', TICKET).catch((e: unknown) => e);

      expect(erreur).toBeInstanceOf(BadRequestException);
      expect((erreur as Error).message).toBe(
        "Le plugin « filtre » a refusé l'opération : titre trop court",
      );
    }

    expect(echecs).toEqual([]);
  });

  it('reconnait le refus leve par une autre copie du SDK', async () => {
    // Un plugin embarque sa propre copie : sa classe n'est pas celle de l'hote,
    // seule la marque partagee compte.
    class AutreRefus extends Error {
      constructor(message: string) {
        super(message);
        Object.defineProperty(this, Symbol.for('tick.plugin.refusal'), { value: true });
      }
    }

    bus.register('filtre', CONTEXTE, 'ticket.beforeCreate', () => {
      throw new AutreRefus('non');
    });

    await expect(bus.run('ticket.beforeCreate', TICKET)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(echecs).toEqual([]);
  });

  it('compte une panne, et la nomme comme telle', async () => {
    bus.register('fragile', CONTEXTE, 'ticket.beforeCreate', () => {
      throw new TypeError('lecture de undefined');
    });

    const erreur = await bus.run('ticket.beforeCreate', TICKET).catch((e: unknown) => e);

    expect(erreur).toBeInstanceOf(InternalServerErrorException);
    expect((erreur as Error).message).toMatch(/« fragile » a échoué sur ticket\.beforeCreate/);
    expect(echecs).toEqual([1]);
  });

  it('ne retient que les pannes consecutives', async () => {
    let enPanne = true;

    bus.register('intermittent', CONTEXTE, 'ticket.beforeCreate', () => {
      if (enPanne) throw new Error('indisponible');
    });

    await bus.run('ticket.beforeCreate', TICKET).catch(() => undefined);
    await bus.run('ticket.beforeCreate', TICKET).catch(() => undefined);

    enPanne = false;
    await bus.run('ticket.beforeCreate', TICKET);

    enPanne = true;
    await bus.run('ticket.beforeCreate', TICKET).catch(() => undefined);

    expect(echecs).toEqual([1, 2, 1]);
  });

  it('compte un depassement de delai comme une panne', async () => {
    vi.useFakeTimers();
    bus.register('lent', CONTEXTE, 'ticket.beforeCreate', () => new Promise<void>(() => undefined));

    const resultat = bus.run('ticket.beforeCreate', TICKET).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(2_000);

    expect(await resultat).toBeInstanceOf(InternalServerErrorException);
    expect(echecs).toEqual([1]);
  });

  it('fait passer la charge d un hook au suivant, dans l ordre des priorites', async () => {
    bus.register('second', CONTEXTE, 'ticket.beforeCreate', (charge) => ({
      ...charge,
      name: `${charge.name} B`,
    }));
    bus.register(
      'premier',
      CONTEXTE,
      'ticket.beforeCreate',
      (charge) => ({ ...charge, name: `${charge.name} A` }),
      10,
    );

    const resultat = await bus.run('ticket.beforeCreate', TICKET);

    expect(resultat.name).toBe('Imprimante A B');
  });
});
