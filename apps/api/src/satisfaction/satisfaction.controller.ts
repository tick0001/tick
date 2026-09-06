import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import {
  answerSurveySchema,
  upsertSatisfactionConfigSchema,
  type AnswerSurvey,
  type PublicSurvey,
  type SatisfactionConfig,
  type SatisfactionStats,
  type UpsertSatisfactionConfig,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SatisfactionService } from './satisfaction.service.js';

/**
 * Formulaire public, sans authentification.
 *
 * C'est tout l'interet de l'enquete : le demandeur repond depuis son courriel,
 * sans compte et sans connexion. Le jeton fait autorisation, et n'ouvre l'acces
 * qu'a la seule enquete qu'il designe.
 */
@Controller('public/satisfaction')
export class PublicSatisfactionController {
  constructor(private readonly satisfaction: SatisfactionService) {}

  @Get(':token')
  async find(@Param('token') token: string): Promise<PublicSurvey> {
    return this.satisfaction.byToken(token);
  }

  @Post(':token')
  @HttpCode(204)
  async answer(
    @Param('token') token: string,
    @Body(new ZodValidationPipe(answerSurveySchema)) body: AnswerSurvey,
  ): Promise<void> {
    await this.satisfaction.answer(token, body);
  }
}

@Controller('satisfaction')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class SatisfactionController {
  constructor(private readonly satisfaction: SatisfactionService) {}

  @Get('configs')
  @RequireRight('satisfaction', 'read')
  async list(): Promise<SatisfactionConfig[]> {
    return this.satisfaction.list();
  }

  @Put('configs')
  @RequireRight('satisfaction', 'update')
  async save(
    @Body(new ZodValidationPipe(upsertSatisfactionConfigSchema)) body: UpsertSatisfactionConfig,
  ): Promise<SatisfactionConfig> {
    return this.satisfaction.save(body);
  }

  @Get('stats')
  @RequireRight('satisfaction', 'read')
  async stats(): Promise<SatisfactionStats> {
    return this.satisfaction.stats();
  }
}
