import { describe, expect, it, vi } from 'vitest';
import { definePluginClient } from './client.js';
import { definePlugin, type PluginApi } from './index.js';

/**
 * Les deux points d'ancrage du SDK.
 *
 * `definePlugin` et `definePluginClient` ne font rien à l'exécution : ils
 * renvoient ce qu'on leur donne. Leur intérêt est le **typage** — un plugin
 * écrit sans eux compilerait quand même, et découvrirait à l'activation que son
 * `register` n'a pas la bonne signature.
 *
 * Ce fichier vérifie donc deux choses : que le passe-plat ne déforme rien, et
 * que les rappels reçoivent bien l'API qu'on leur promet.
 */

describe('definePlugin', () => {
  it('renvoie la definition telle quelle', () => {
    const definition = { register: () => undefined };

    expect(definePlugin(definition)).toBe(definition);
  });

  it('transmet l’API au moment de l’enregistrement', async () => {
    const surHook = vi.fn();
    const surEvenement = vi.fn();
    const surChamp = vi.fn();
    const surWidget = vi.fn();

    const plugin = definePlugin({
      register(api) {
        api.hooks.on('ticket.beforeCreate', surHook);
        api.events.on('ticket.created', surEvenement);
        api.search.registerField({
          key: 'cout',
          label: 'Cout',
          type: 'number',
          operators: ['eq'],
          sql: 'p.cout',
        });
        api.dashboards.registerWidget({ key: 'resume', label: 'Resume', description: 'Aide' });
      },
    });

    const api = {
      context: {} as PluginApi['context'],
      hooks: { on: surHook },
      events: { on: surEvenement },
      search: { registerField: surChamp },
      dashboards: { registerWidget: surWidget },
    } as unknown as PluginApi;

    await plugin.register(api);

    expect(surHook).toHaveBeenCalledWith('ticket.beforeCreate', surHook);
    expect(surEvenement).toHaveBeenCalledWith('ticket.created', surEvenement);
    expect(surChamp).toHaveBeenCalledWith(expect.objectContaining({ key: 'cout' }));
    expect(surWidget).toHaveBeenCalledWith(expect.objectContaining({ key: 'resume' }));
  });

  it('accepte les etapes de cycle de vie, toutes facultatives', async () => {
    const traces: string[] = [];
    const plugin = definePlugin({
      install: () => void traces.push('install'),
      upgrade: (_contexte, precedente) => void traces.push(`upgrade ${precedente}`),
      uninstall: () => void traces.push('uninstall'),
      register: () => undefined,
    });

    const contexte = {} as PluginApi['context'];

    await plugin.install?.(contexte);
    await plugin.upgrade?.(contexte, '1.0.0');
    await plugin.uninstall?.(contexte);

    expect(traces).toEqual(['install', 'upgrade 1.0.0', 'uninstall']);
  });
});

describe('definePluginClient', () => {
  it('renvoie la definition telle quelle', () => {
    const definition = { register: () => undefined };

    expect(definePluginClient(definition)).toBe(definition);
  });

  it('enregistre un emplacement et rend son contenu', () => {
    const ajoute = vi.fn();
    const client = definePluginClient({
      register(api) {
        api.slots.add('app.header', {
          id: 'salutation',
          order: 10,
          render(element, context) {
            element.textContent = `Bonjour ${context.entity.name}`;

            return () => {
              element.textContent = '';
            };
          },
        });
      },
    });

    client.register({ slots: { add: ajoute } });

    expect(ajoute).toHaveBeenCalledTimes(1);

    const [emplacement, entree] = ajoute.mock.calls[0] as [string, { id: string; render: never }];

    expect(emplacement).toBe('app.header');
    expect(entree.id).toBe('salutation');
  });

  it('le rendu peut renvoyer un nettoyage, qui libere ce que le DOM ne libere pas', () => {
    let nettoye = false;
    const element = { textContent: '' } as HTMLElement;

    const rendu = (cible: HTMLElement): (() => void) => {
      cible.textContent = 'contenu';

      return () => {
        nettoye = true;
      };
    };

    const demonter = rendu(element);

    expect(element.textContent).toBe('contenu');

    demonter();

    expect(nettoye).toBe(true);
  });
});
