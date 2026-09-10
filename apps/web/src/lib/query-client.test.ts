import { QueryObserver } from '@tanstack/react-query';
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api';
import { CLE_SESSION, creerQueryClient } from './query-client';

/**
 * Le client de requêtes, et sa politique de refus.
 *
 * Deux décisions y sont prises, toutes deux mal placées ailleurs.
 *
 * Un 4xx n'est **pas** une panne passagère : le droit ne s'ouvre pas entre deux
 * tentatives. Réessayer ne fait que retarder l'écran de connexion, en laissant
 * l'utilisateur devant une page qui semble charger alors qu'elle est refusée.
 *
 * Un 401 sur n'importe quelle requête signifie que la session est perdue. Sans
 * cette règle, seule la requête de session le remarque, et elle ne repart qu'au
 * retour sur l'onglet : l'écran ouvert accumule entre-temps des erreurs
 * formulées comme des pannes, alors que le compte est simplement déconnecté.
 */

describe('politique de réessai', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ne réessaie jamais un refus', async () => {
    const client = creerQueryClient();
    const requete = vi.fn().mockRejectedValue(new ApiError(403, 'Droit manquant.'));

    await client.fetchQuery({ queryKey: ['droits'], queryFn: requete }).catch(() => undefined);

    expect(requete).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 409])('ne réessaie pas un %i', async (status) => {
    const client = creerQueryClient();
    const requete = vi.fn().mockRejectedValue(new ApiError(status, 'Refus.'));

    await client
      .fetchQuery({ queryKey: [`code-${String(status)}`], queryFn: requete })
      .catch(() => undefined);

    expect(requete).toHaveBeenCalledTimes(1);
  });

  it('réessaie une fois une panne serveur', async () => {
    const client = creerQueryClient();
    const requete = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(503, 'Indisponible.'))
      .mockResolvedValue('ok');

    // Une 503 est passagere par nature : un relais qui redemarre, une bascule
    // de base. La retenter une fois evite une erreur affichee pour rien.
    await expect(client.fetchQuery({ queryKey: ['panne'], queryFn: requete })).resolves.toBe('ok');
    expect(requete).toHaveBeenCalledTimes(2);
  });

  it('réessaie une erreur réseau, qui n’a pas de statut', async () => {
    const client = creerQueryClient();
    const requete = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('ok');

    await expect(client.fetchQuery({ queryKey: ['reseau'], queryFn: requete })).resolves.toBe('ok');
    expect(requete).toHaveBeenCalledTimes(2);
  });

  it('ne réessaie pas une écriture', async () => {
    const client = creerQueryClient();
    const ecriture = vi.fn().mockRejectedValue(new ApiError(503, 'Indisponible.'));

    // Une ecriture rejouee peut aboutir deux fois : mieux vaut un echec visible
    // qu'un second ticket cree sans que personne l'ait demande.
    await client
      .getMutationCache()
      .build(client, { mutationFn: ecriture })
      .execute(undefined)
      .catch(() => undefined);

    expect(ecriture).toHaveBeenCalledTimes(1);
  });
});

describe('perte de session', () => {
  /**
   * Installe une session **observée**, comme l'application en tient une.
   *
   * L'observateur compte : une requête sans observateur n'est jamais rejouée,
   * et le test passerait en vérifiant une invalidation sans effet.
   */
  function sessionEnPlace(client: ReturnType<typeof creerQueryClient>) {
    const lecture = vi.fn().mockResolvedValue({ user: { username: 'admin' } });
    const observateur = new QueryObserver(client, {
      queryKey: [...CLE_SESSION],
      queryFn: lecture,
    });
    const stop = observateur.subscribe(() => undefined);

    return { lecture, stop };
  }

  it('redemande la session quand une requête revient en 401', async () => {
    const client = creerQueryClient();
    const { lecture, stop } = sessionEnPlace(client);

    await waitFor(() => {
      expect(lecture).toHaveBeenCalledTimes(1);
    });

    await client
      .fetchQuery({
        queryKey: ['tickets'],
        queryFn: () => Promise.reject(new ApiError(401, 'Authentification requise.')),
      })
      .catch(() => undefined);

    // On ne conclut pas depuis le 401 recu : on redemande la session, et c'est
    // cette reponse-la qui fait foi.
    await waitFor(() => {
      expect(lecture).toHaveBeenCalledTimes(2);
    });

    stop();
  });

  it('redemande aussi la session sur une écriture refusée', async () => {
    const client = creerQueryClient();
    const { lecture, stop } = sessionEnPlace(client);

    await waitFor(() => {
      expect(lecture).toHaveBeenCalledTimes(1);
    });

    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.reject(new ApiError(401, 'Authentification requise.')),
      })
      .execute(undefined)
      .catch(() => undefined);

    await waitFor(() => {
      expect(lecture).toHaveBeenCalledTimes(2);
    });

    stop();
  });

  it('ne bouge pas sur un simple refus de droit', async () => {
    const client = creerQueryClient();
    const { lecture, stop } = sessionEnPlace(client);

    await waitFor(() => {
      expect(lecture).toHaveBeenCalledTimes(1);
    });

    await client
      .fetchQuery({
        queryKey: ['admin-users'],
        queryFn: () => Promise.reject(new ApiError(403, 'Droit manquant.')),
      })
      .catch(() => undefined);

    // Un 403 dit « pas avec ce profil », pas « plus connecte » : deconnecter
    // sur un 403 renverrait a l'ecran de connexion pour un ecran interdit.
    expect(lecture).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ne bouge pas quand l’erreur n’a pas de statut', async () => {
    const client = creerQueryClient();
    const { lecture, stop } = sessionEnPlace(client);

    await waitFor(() => {
      expect(lecture).toHaveBeenCalledTimes(1);
    });

    await client
      .fetchQuery({
        queryKey: ['reseau-coupe'],
        queryFn: () => Promise.reject(new TypeError('Failed to fetch')),
      })
      .catch(() => undefined);

    // Un reseau coupe n'est pas une deconnexion : renvoyer a l'ecran de
    // connexion ferait ressaisir un mot de passe pour un cable debranche.
    expect(lecture).toHaveBeenCalledTimes(1);
    stop();
  });

  /**
   * La session **observée mais absente** : exactement l'écran de connexion.
   *
   * La requête part, revient en 401, et l'application affiche le formulaire.
   * L'observateur existe, mais il n'y a aucune donnée à perdre.
   */
  function sessionAbsente(client: ReturnType<typeof creerQueryClient>) {
    const lecture = vi.fn().mockRejectedValue(new ApiError(401, 'Authentification requise.'));
    const observateur = new QueryObserver(client, {
      queryKey: [...CLE_SESSION],
      queryFn: lecture,
    });
    const stop = observateur.subscribe(() => undefined);

    return { lecture, stop };
  }

  it('ne redemande pas la session quand une connexion est refusée', async () => {
    const client = creerQueryClient();
    const { lecture, stop } = sessionAbsente(client);

    await waitFor(() => {
      expect(lecture).toHaveBeenCalledTimes(1);
    });

    // Le 401 d'une connexion dit « mauvais mot de passe », pas « session
    // expiree » : il n'y a pas de session a perdre. Redemander la session
    // remonte l'ecran de connexion, ce qui reinitialise l'etat de la mutation
    // et efface le message d'erreur avant que quiconque ait pu le lire.
    await client
      .getMutationCache()
      .build(client, {
        mutationFn: () => Promise.reject(new ApiError(401, 'Identifiants invalides.')),
      })
      .execute(undefined)
      .catch(() => undefined);

    await new Promise((resoudre) => setTimeout(resoudre, 50));

    expect(lecture).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ne se relance pas sur l’échec de la requête de session elle-même', async () => {
    const client = creerQueryClient();
    const requete = vi.fn().mockRejectedValue(new ApiError(401, 'Authentification requise.'));

    await client
      .fetchQuery({ queryKey: [...CLE_SESSION], queryFn: requete })
      .catch(() => undefined);

    // Sans cette exception, chaque echec de session en declencherait un autre.
    expect(requete).toHaveBeenCalledTimes(1);
  });
});
