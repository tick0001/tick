import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import i18n from '@/lib/i18n';

/**
 * Rendu d'un composant dans le contexte que l'application lui donne.
 *
 * Traductions, cache de requêtes et routeur : un composant de Tick& en dépend
 * presque toujours, et les monter à la main dans chaque fichier ferait diverger
 * les réglages — un test finirait par passer parce qu'il réessaie là où
 * l'application ne réessaie pas.
 *
 * Les réessais sont **désactivés** ici. Le comportement par défaut de
 * TanStack Query est de retenter trois fois avec un délai croissant : un test
 * qui vérifie l'affichage d'une erreur attendrait alors plusieurs secondes
 * avant de la voir, et finirait par expirer sans que rien ne soit cassé.
 */

/**
 * La langue des tests est fixée au français.
 *
 * Elle est autrement négociée depuis `navigator.language`, qui dépend de la
 * machine : un test comparant un libellé passerait sur un poste et échouerait
 * en intégration continue, pour une raison sans rapport avec ce qu'il vérifie.
 */
void i18n.changeLanguage('fr');

export function creerClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      // `gcTime: 0` ramasserait aussitot toute entree sans observateur, y
      // compris celles qu'un test vient de poser a la main pour verifier
      // qu'elles survivent -- ou non -- a une action.
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface OptionsRendu extends Omit<RenderOptions, 'wrapper'> {
  /** Route initiale, pour un composant qui lit l'URL. */
  route?: string;
  client?: QueryClient;
}

export function rendre(
  element: ReactElement,
  { route = '/', client = creerClient(), ...options }: OptionsRendu = {},
): RenderResult & { client: QueryClient } {
  function Enveloppe({ children }: { children: ReactNode }) {
    return (
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>
    );
  }

  return { ...render(element, { wrapper: Enveloppe, ...options }), client };
}
