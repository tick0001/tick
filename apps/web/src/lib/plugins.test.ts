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
 * Enfin, la liste des interfaces à charger est **ouverte à tout utilisateur
 * connecté**. Elle passait par la liste d'administration, et un technicien ne
 * voyait jamais l'interface d'aucun plugin.
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
    // Une session expiree repond 401. Traiter cela comme une panne afficherait
    // une erreur au lieu de la page de connexion.
    const fetch = vi.fn().mockResolvedValue(reponse([], false));

    vi.stubGlobal('fetch', fetch);

    await expect(loadPluginClients()).resolves.toBeUndefined();
    expect(entriesFor(AUCUN)).toHaveLength(0);
  });

  it('isole un plugin dont l interface ne se charge pas', async () => {
    // L'import dynamique echoue ici, faute de serveur : c'est exactement le cas
    // d'un bundle absent ou casse. Il ne doit rien emporter.
    const fetch = vi.fn().mockResolvedValue(reponse(['introuvable']));
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    vi.stubGlobal('fetch', fetch);

    await expect(loadPluginClients()).resolves.toBeUndefined();
    expect(entriesFor(AUCUN)).toHaveLength(0);
    expect(console_).toHaveBeenCalled();
    console_.mockRestore();
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
    expect(fetch).toHaveBeenCalledWith('/api/plugins/clients', { credentials: 'include' });
  });
});
