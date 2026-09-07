import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

/** Clé de la requête portant la session courante. */
export const CLE_SESSION = ['session'] as const;

/**
 * Un refus n'est pas une panne passagère.
 *
 * Réessayer un 401 ou un 403 ne peut rien donner de plus : le droit ne s'ouvre
 * pas entre deux tentatives. Chaque essai retarde en revanche l'affichage de
 * l'écran de connexion, et laisse l'utilisateur devant une page qui semble
 * charger alors qu'elle est déjà refusée.
 */
function reessayer(tentative: number, erreur: Error): boolean {
  if (erreur instanceof ApiError && erreur.status >= 400 && erreur.status < 500) return false;

  return tentative < 1;
}

/**
 * La session est perdue dès qu'une requête revient en 401.
 *
 * Sans cela, seule la requête de session détecte l'expiration, et elle ne
 * repart qu'au retour sur l'onglet : l'écran resté ouvert accumule des erreurs
 * pendant ce temps, chacune formulée comme une panne alors que le compte est
 * simplement déconnecté.
 *
 * On ne conclut pas depuis le 401 reçu : on **redemande** la session. C'est
 * elle qui fait foi, et la réponse tranche entre « déconnecté » et « cette
 * ressource-là est refusée à ce profil ».
 */
function surErreur(client: QueryClient, erreur: unknown, cleSession: boolean): void {
  if (cleSession) return;
  if (!(erreur instanceof ApiError) || erreur.status !== 401) return;

  // `invalidateQueries` et non `removeQueries` : retirer la requête la sort du
  // cache sans que l'observateur monté la redemande, et l'application resterait
  // affichée sur des données périmées jusqu'à la prochaine navigation. Invalider
  // marque la session périmée **et** relance la lecture.
  void client.invalidateQueries({ queryKey: CLE_SESSION });
}

export function creerQueryClient(): QueryClient {
  const client: QueryClient = new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: reessayer },
      mutations: { retry: false },
    },
    queryCache: new QueryCache({
      onError: (erreur, requete) => {
        surErreur(client, erreur, requete.queryKey[0] === CLE_SESSION[0]);
      },
    }),
    mutationCache: new MutationCache({
      onError: (erreur) => {
        surErreur(client, erreur, false);
      },
    }),
  });

  return client;
}
