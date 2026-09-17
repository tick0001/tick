import type {
  PluginContext,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginSettingValue,
} from '@tick/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import type { Annonce } from './messages.js';
import { annoncer } from './server.js';

/**
 * Décider s'il faut annoncer, puis journaliser ce qui s'est passé.
 *
 * Le contexte est factice : les réglages sont un simple dictionnaire, la sortie
 * HTTP un simulacre. L'héritage entre entités et la politique réseau sont
 * éprouvés côté cœur ; ici, on éprouve les décisions du plugin.
 */

const WEBHOOK = 'https://hooks.exemple.fr/services/T000/B000/jeton-tres-secret';

const CREATION: Annonce = {
  genre: 'creation',
  ticketId: 42,
  titre: 'Imprimante bloquée',
  priorite: 3,
  type: 'incident',
};

function contexte(
  reglages: Record<string, PluginSettingValue | null>,
  reponse: PluginHttpResponse | Error = { status: 200, headers: {}, body: 'ok' },
) {
  const requetes: { url: string; init: PluginHttpRequest | undefined }[] = [];
  const journal: unknown[][] = [];
  const avertissements: string[] = [];

  const ctx = {
    id: 'messagerie',
    version: '1.0.0',
    schema: 'plugin_messagerie',
    logger: {
      debug: vi.fn(),
      log: vi.fn(),
      warn: (message: string) => avertissements.push(message),
      error: vi.fn(),
    },
    db: {
      query: (texte: string, params: unknown[] = []) => {
        if (texte.startsWith('INSERT')) journal.push(params);

        return Promise.resolve([]);
      },
    },
    settings: {
      get: (cle: string) => Promise.resolve(reglages[cle] ?? null),
    },
    http: {
      request: (url: string, init?: PluginHttpRequest) => {
        requetes.push({ url, init });

        return reponse instanceof Error ? Promise.reject(reponse) : Promise.resolve(reponse);
      },
    },
    instance: { webUrl: 'https://support.exemple.fr' },
  } as unknown as PluginContext;

  return { ctx, requetes, journal, avertissements };
}

const ACTIF = {
  webhook: WEBHOOK,
  format: 'slack',
  creation: true,
  escalade: true,
  resolution: false,
  priorite_minimale: 1,
  langue: 'fr',
};

describe('annoncer', () => {
  it('ne fait rien sans webhook, ici ou plus haut', async () => {
    const { ctx, requetes, journal } = contexte({ ...ACTIF, webhook: null });

    await annoncer(ctx, 1, CREATION);

    expect(requetes).toHaveLength(0);
    expect(journal).toHaveLength(0);
  });

  it('respecte la bascule de chaque genre d annonce', async () => {
    const { ctx, requetes } = contexte(ACTIF);

    await annoncer(ctx, 1, { genre: 'resolution', ticketId: 42 });

    expect(requetes).toHaveLength(0);
  });

  it('ecarte un nouveau ticket sous la priorite minimale', async () => {
    const { ctx, requetes } = contexte({ ...ACTIF, priorite_minimale: 4 });

    await annoncer(ctx, 1, CREATION);

    expect(requetes).toHaveLength(0);
  });

  it('annonce, puis journalise la reponse', async () => {
    const { ctx, requetes, journal } = contexte(ACTIF);

    await annoncer(ctx, 5, CREATION);

    expect(requetes).toHaveLength(1);
    expect(requetes[0]?.url).toBe(WEBHOOK);
    expect(requetes[0]?.init?.method).toBe('POST');
    expect(requetes[0]?.init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(requetes[0]?.init?.body ?? '{}')).toEqual({
      text:
        'Nouvel incident #42 — Imprimante bloquée (priorité 3)\n' +
        'https://support.exemple.fr/tickets/42',
    });
    expect(journal).toEqual([['creation', 42, 5, 200, null]]);
  });

  it('retente une messagerie indisponible', async () => {
    const { ctx, journal } = contexte(ACTIF, { status: 503, headers: {}, body: 'maintenance' });

    await expect(annoncer(ctx, 5, CREATION)).rejects.toThrow(/HTTP 503/);
    expect(journal).toEqual([['creation', 42, 5, 503, 'maintenance']]);
  });

  it('retente une messagerie injoignable', async () => {
    const { ctx, journal } = contexte(ACTIF, new Error('Pas de reponse de hooks.exemple.fr'));

    await expect(annoncer(ctx, 5, CREATION)).rejects.toThrow(/sans réponse/);
    expect(journal[0]?.[3]).toBeNull();
  });

  it('ne retente pas une adresse refusee, mais le dit', async () => {
    const { ctx, journal, avertissements } = contexte(ACTIF, {
      status: 404,
      headers: {},
      body: 'no_service',
    });

    await expect(annoncer(ctx, 5, CREATION)).resolves.toBeUndefined();
    expect(journal).toEqual([['creation', 42, 5, 404, 'no_service']]);
    expect(avertissements[0]).toMatch(/HTTP 404/);
  });

  it('ne recopie jamais l adresse du webhook, qui porte le jeton', async () => {
    const { ctx, journal, avertissements } = contexte(ACTIF, {
      status: 400,
      headers: {},
      body: '',
    });

    await annoncer(ctx, 5, CREATION);

    expect(JSON.stringify([journal, avertissements])).not.toContain('jeton-tres-secret');
  });

  it('ecrit pour Teams quand l entite le demande', async () => {
    const { ctx, requetes } = contexte({ ...ACTIF, format: 'teams', langue: 'en' });

    await annoncer(ctx, 5, {
      genre: 'escalade',
      ticketId: 42,
      niveau: 'N2',
      engagement: 'Standard',
    });

    const envoye = JSON.parse(requetes[0]?.init?.body ?? '{}') as { type: string };

    expect(envoye.type).toBe('message');
    expect(requetes[0]?.init?.body).toContain('Escalation on ticket #42');
  });
});
