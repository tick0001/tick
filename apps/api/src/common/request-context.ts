import { AsyncLocalStorage } from 'node:async_hooks';
import { InternalServerErrorException } from '@nestjs/common';
import type { RequestContext } from '@tick/db';

/**
 * Contexte de travail de la requete en cours.
 *
 * Il etend le contexte que la couche donnees injecte dans la transaction avec
 * ce dont l'application a besoin par ailleurs : session, entite active sous
 * forme d'identifiant, langue.
 */
export interface TickContext extends RequestContext {
  sessionId: string;
  entityId: number;
  includeSubEntities: boolean;
  locale: string;
}

const storage = new AsyncLocalStorage<TickContext>();

/** Execute le travail avec ce contexte, propage a tout l'arbre d'appels. */
export function runWithContext<T>(context: TickContext, work: () => T): T {
  return storage.run(context, work);
}

export function currentContext(): TickContext | undefined {
  return storage.getStore();
}

/**
 * Contexte obligatoire.
 *
 * L'absence de contexte n'est pas un cas fonctionnel mais un defaut de cablage :
 * une route protegee atteinte sans authentification, ou un travail de fond
 * lance hors contexte. Echouer bruyamment vaut mieux qu'executer une requete
 * dont le perimetre serait indefini.
 */
export function requireContext(): TickContext {
  const context = storage.getStore();

  if (!context) {
    throw new InternalServerErrorException(
      "Aucun contexte de requete : le perimetre d'entites serait indefini.",
    );
  }

  return context;
}
