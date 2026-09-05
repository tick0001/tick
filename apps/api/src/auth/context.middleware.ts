import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { runWithContext, type TickContext } from '../common/request-context.js';
import { ScopeService } from './scope.service.js';
import { SessionService } from './session.service.js';

export const SESSION_COOKIE = 'tick_session';

/**
 * Etablit le contexte de travail pour toute la duree de la requete.
 *
 * Une requete sans session valide poursuit son chemin sans contexte : c'est aux
 * gardes de refuser l'acces. Ce decoupage laisse exister des routes publiques
 * (sante, FAQ, connexion) sans exception dans le cablage.
 */
@Injectable()
export class ContextMiddleware implements NestMiddleware {
  constructor(
    private readonly sessions: SessionService,
    private readonly scopes: ScopeService,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const cookies = request.cookies as Record<string, string> | undefined;
    const session = await this.sessions.resolve(cookies?.[SESSION_COOKIE]);

    if (!session) {
      next();
      return;
    }

    const scope = await this.scopes.workingScope(
      session.userId,
      session.entityId,
      session.profileId,
      session.includeSubEntities,
    );

    const context: TickContext = {
      sessionId: session.id,
      userId: session.userId,
      profileId: session.profileId,
      entityId: scope.entityId,
      entityPath: scope.entityPath,
      includeSubEntities: scope.includeSubEntities,
      scope: scope.scope,
      locale: request.acceptsLanguages('fr', 'en') || 'fr',
    };

    runWithContext(context, () => {
      next();
    });
  }
}
