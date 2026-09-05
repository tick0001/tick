import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { LdapModule } from '../ldap/ldap.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { ContextMiddleware } from './context.middleware.js';
import { AuthenticatedGuard } from './guards/authenticated.guard.js';
import { RightsGuard } from './guards/rights.guard.js';
import { PasswordService } from './password.service.js';
import { RightsService } from './rights.service.js';
import { ScopeService } from './scope.service.js';
import { SessionService } from './session.service.js';

@Module({
  imports: [LdapModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    SessionService,
    ScopeService,
    RightsService,
    AuthenticatedGuard,
    RightsGuard,
  ],
  exports: [AuthService, ScopeService, RightsService, SessionService, PasswordService],
})
export class AuthModule implements NestModule {
  /**
   * Le contexte s'etablit pour *toutes* les routes, y compris publiques.
   *
   * Le poser globalement plutot que route par route supprime la categorie de
   * bug la plus couteuse du modele : une route qui interrogerait la base sans
   * perimetre defini. Sans session, le contexte reste simplement absent et les
   * gardes refusent l'acces.
   */
  configure(consumer: MiddlewareConsumer): void {
    // Syntaxe Express 5 : `*` seul n'est plus accepte par path-to-regexp.
    consumer.apply(ContextMiddleware).forRoutes('{*path}');
  }
}
