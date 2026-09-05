import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { currentContext } from '../../common/request-context.js';
import { RightsService, type RightScope } from '../rights.service.js';

const RIGHT_KEY = 'tick:right';

export interface RequiredRight {
  object: string;
  action: string;
}

/**
 * Exige un droit sur l'objet vise.
 *
 * La garde verifie l'existence du droit, pas sa portee : `own`, `group`,
 * `entity` ou `all` conditionnent *quelles lignes* sont concernees, ce que
 * seule la requete peut decider. La portee resolue est mise a disposition du
 * service via `RightsService`.
 */
export const RequireRight = (object: string, action: string): MethodDecorator =>
  SetMetadata(RIGHT_KEY, { object, action } satisfies RequiredRight);

@Injectable()
export class RightsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rights: RightsService,
  ) {}

  async canActivate(execution: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredRight | undefined>(RIGHT_KEY, [
      execution.getHandler(),
      execution.getClass(),
    ]);

    if (!required) return true;

    const context = currentContext();
    if (!context) throw new UnauthorizedException('Authentification requise.');

    const scope: RightScope | undefined = await this.rights.scopeFor(
      context.profileId,
      required.object,
      required.action,
    );

    if (!scope) {
      throw new ForbiddenException(
        `Droit manquant : ${required.object}:${required.action} pour le profil actif.`,
      );
    }

    return true;
  }
}
