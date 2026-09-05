import { CanActivate, Injectable, UnauthorizedException } from '@nestjs/common';
import { currentContext } from '../../common/request-context.js';

/** Exige une session etablie, donc un contexte d'entite defini. */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(): boolean {
    if (!currentContext()) {
      throw new UnauthorizedException('Authentification requise.');
    }

    return true;
  }
}
