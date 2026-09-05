import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  loginSchema,
  switchContextSchema,
  type Login,
  type SessionContext,
  type SwitchContext,
} from '@tick/contracts';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { requireContext } from '../common/request-context.js';
import { loadEnv } from '../config/env.js';
import { AuthService } from './auth.service.js';
import { SESSION_COOKIE } from './context.middleware.js';
import { AuthenticatedGuard } from './guards/authenticated.guard.js';
import type { SessionRecord } from './session.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: Login,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionContext> {
    const session = await this.auth.login(body.username, body.password, {
      userAgent: request.get('user-agent'),
      ipAddress: request.ip,
    });

    response.cookie(SESSION_COOKIE, session.cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      secure: loadEnv().NODE_ENV === 'production',
      path: '/',
    });

    return this.auth.describeSession(session);
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthenticatedGuard)
  async logout(@Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(requireContext().sessionId);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  /** Etat de la session courante : entite active, profil, droits, bascules possibles. */
  @Get('session')
  @UseGuards(AuthenticatedGuard)
  async session(): Promise<SessionContext> {
    return this.auth.describeSession(this.currentSession());
  }

  /** Change d'entite active ou de profil sans se reconnecter. */
  @Post('context')
  @HttpCode(200)
  @UseGuards(AuthenticatedGuard)
  async switchContext(
    @Body(new ZodValidationPipe(switchContextSchema)) body: SwitchContext,
  ): Promise<SessionContext> {
    return this.auth.switchContext(this.currentSession(), body);
  }

  /** Reconstitue l'enregistrement de session depuis le contexte de la requete. */
  private currentSession(): SessionRecord {
    const context = requireContext();

    return {
      id: context.sessionId,
      userId: context.userId,
      profileId: context.profileId,
      entityId: context.entityId,
      includeSubEntities: context.includeSubEntities,
    };
  }
}
