import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { entriesFor, loadPluginClients, resetPluginClients, subscribeToSlots } from './plugins';

/**
 * Chargement des bundles d'interface des plugins.
 *
 * Trois exigences se croisent ici, et chacune se paie cher si elle tombe.
 *
 * L'échec d'un plugin est **isolé** : une extension cassée ne doit pas emporter
 * l'application, faute de quoi installer un plugin devient un pari.
 *
 * L'instantané doit **changer d'identité** quand il change de contenu :
 * `useSyncExternalStore` compare par référence, et une mutation en place ne
 * redessinerait rien — le plugin serait chargé sans jamais s'afficher.
 *
 * Enfin, l'absence de droit `plugin:read` n'est **pas une erreur** : il n'y a
 * simplement rien à charger.
 */

const AUCUN = 'app.header' as never;

function reponse(corps: unknown, ok = true): Response {
  return { ok, json: () => Promise.resolve(corps) } as Response;
}

describe('loadPluginClients', () => {
  beforeEach(() => {
    resetPluginClients();
  });

  afterEach(() => {
    resetPluginClients();
    vi.unstubAllGlobals();
  });

  it('ne charge rien quand la liste est refusée', async () => {
    // Sans le droit `plugin:read`, la liste repond 403. Traiter cela comme une
    // panne afficherait une erreur a chaque connexion d'un utilisateur ordinaire.
    const fetch = vi.fn().mockResolvedValue(reponse([], false));

    vi.stubGlobal('fetch', fetch);

    await expect(loadPluginClients()).resolves.toBeUndefined();
    expect(entriesFor(AUCUN)).toHaveLength(0);
  });

  it('ignore les plugins inactifs ou sans partie interface', async () => {
    const fetch = vi.fn().mockResolvedValue(
      reponse([
        { id: 'eteint', state: 'installe', hasClient: true },
        { id: 'sans-interface', state: 'actif', hasClient: false },
      ]),
    );

    vi.stubGlobal('fetch', fetch);

    await loadPluginClients();

    expect(entriesFor(AUCUN)).toHaveLength(0);
  });

  it('rend le même tableau vide à chaque lecture', () => {
    // `useSyncExternalStore` compare les instantanes par identite : un tableau
    // vide neuf a chaque appel provoquerait un rendu en boucle.
    expect(entriesFor(AUCUN)).toBe(entriesFor(AUCUN));
  });

  it('prévient ses abonnés, puis les oublie sur désabonnement', () => {
    const abonne = vi.fn();
    const desabonner = subscribeToSlots(abonne);

    resetPluginClients();
    expect(abonne).toHaveBeenCalledTimes(1);

    desabonner();
    resetPluginClients();
    expect(abonne).toHaveBeenCalledTimes(1);
  });

  it('vide les emplacements à la déconnexion', async () => {
    const fetch = vi.fn().mockResolvedValue(reponse([]));

    vi.stubGlobal('fetch', fetch);
    await loadPluginClients();

    resetPluginClients();

    expect(entriesFor(AUCUN)).toHaveLength(0);
  });

  it('interroge l’API avec les cookies de session', async () => {
    const fetch = vi.fn().mockResolvedValue(reponse([]));

    vi.stubGlobal('fetch', fetch);
    await loadPluginClients();

    // Sans `credentials`, la requete part anonyme et le serveur repond 401 :
    // aucun plugin ne se chargerait, sans message.
    expect(fetch).toHaveBeenCalledWith('/api/plugins', { credentials: 'include' });
  });
});
