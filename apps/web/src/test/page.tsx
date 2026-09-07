import type { RightScope, SessionContext } from '@tick/contracts';
import type { RenderResult } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { SessionProvider } from '@/lib/session';
import { rendre, type OptionsRendu } from '@/test/rendu';

/**
 * Monter un écran complet, comme l'application le monte.
 *
 * Une page de Tick& ne se rend pas seule : elle lit la session pour savoir ce
 * qu'elle a le droit d'afficher, et sans fournisseur elle lève. Chaque fichier
 * de test refaisait donc le même contexte factice — une trentaine de lignes de
 * session qui n'apprennent rien au lecteur et qu'il faut corriger partout le
 * jour où le contrat change.
 *
 * Les droits sont le seul paramètre qui compte vraiment ici : c'est par eux
 * qu'un écran montre ou cache ses actions, et c'est donc ce qu'un test veut
 * faire varier.
 */

/** Compte de démonstration, identique d'un test à l'autre. */
export const MOI = {
  id: 1,
  username: 'admin',
  displayName: 'Alice Martin',
  email: 'admin@exemple.fr',
  locale: 'fr',
};

export const ENTITE = {
  id: 1,
  name: 'Racine',
  completeName: 'Racine',
  path: 'e1',
  level: 0,
  parentId: null,
};

/**
 * Tous les droits, portée maximale.
 *
 * Le défaut est volontairement permissif : un test qui n'étudie pas les droits
 * ne doit pas avoir à les énumérer pour que sa page s'affiche. Ceux qui les
 * étudient passent la table exacte qu'ils veulent.
 */
export function tousDroits(objets: readonly string[]): Record<string, RightScope> {
  const table: Record<string, RightScope> = {};

  for (const objet of objets) {
    for (const action of ['read', 'create', 'update', 'delete'] as const) {
      table[`${objet}:${action}`] = 'all';
    }
  }

  return table;
}

export function sessionFactice(
  rights: Record<string, RightScope> = {},
  surcharge: Partial<SessionContext> = {},
): SessionContext {
  return {
    user: MOI,
    entity: ENTITE,
    profile: { id: 1, name: 'Administrateur', interface: 'standard' },
    includeSubEntities: true,
    rights,
    available: [],
    ...surcharge,
  };
}

export interface OptionsPage extends OptionsRendu {
  droits?: Record<string, RightScope> | undefined;
  session?: Partial<SessionContext> | undefined;
}

// Le type de retour est annote : l'inferer ferait remonter un type interne de
// `pretty-format`, que TypeScript refuse de nommer depuis ce fichier.
export function monterPage(
  element: ReactElement,
  options: OptionsPage = {},
): RenderResult & { client: QueryClient } {
  const { droits = {}, session, ...rendu } = options;

  return rendre(
    <SessionProvider session={sessionFactice(droits, session ?? {})}>{element}</SessionProvider>,
    rendu,
  );
}
