import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  planningFilterSchema,
  recurringFilterSchema,
  upsertRecurringTicketSchema,
  upsertUnavailabilitySchema,
  type PlanningEntry,
  type PlanningFilter,
  type RecurringFilter,
  type RecurringTicket,
  type UpsertRecurringTicket,
  type UpsertUnavailability,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { toIcalendar } from './ical.js';
import { PlanningService } from './planning.service.js';
import { RecurrenceService } from './recurrence.service.js';

@Controller('planning')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class PlanningController {
  constructor(
    private readonly planning: PlanningService,
    private readonly recurrence: RecurrenceService,
  ) {}

  @Get()
  @RequireRight('planning', 'read')
  async list(
    @Query(new ZodValidationPipe(planningFilterSchema)) filter: PlanningFilter,
  ): Promise<PlanningEntry[]> {
    return this.planning.list(filter);
  }

  /**
   * Export iCal de la fenêtre demandée.
   *
   * Un fichier plutôt qu'un abonnement : un flux permanent exigerait un jeton
   * porteur dans l'URL, donc un secret durable dans le calendrier de chacun.
   * C'est un compromis assumé, et il est réversible.
   */
  @Get('ical')
  @RequireRight('planning', 'read')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="planning.ics"')
  async ical(
    @Query(new ZodValidationPipe(planningFilterSchema)) filter: PlanningFilter,
  ): Promise<string> {
    return toIcalendar(await this.planning.list(filter));
  }

  @Post('unavailabilities')
  @RequireRight('planning', 'update')
  @HttpCode(204)
  async createUnavailability(
    @Body(new ZodValidationPipe(upsertUnavailabilitySchema)) body: UpsertUnavailability,
  ): Promise<void> {
    await this.planning.createUnavailability(body);
  }

  @Delete('unavailabilities/:id')
  @RequireRight('planning', 'update')
  @HttpCode(204)
  async removeUnavailability(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.planning.removeUnavailability(id);
  }

  // --- Tickets récurrents ---------------------------------------------------

  @Get('recurring')
  @RequireRight('recurrence', 'read')
  async listRecurring(
    @Query(new ZodValidationPipe(recurringFilterSchema)) filter: RecurringFilter,
  ): Promise<RecurringTicket[]> {
    return this.recurrence.list(filter);
  }

  @Post('recurring')
  @RequireRight('recurrence', 'update')
  async createRecurring(
    @Body(new ZodValidationPipe(upsertRecurringTicketSchema)) body: UpsertRecurringTicket,
  ): Promise<RecurringTicket> {
    return this.recurrence.save(body);
  }

  @Put('recurring/:id')
  @RequireRight('recurrence', 'update')
  async updateRecurring(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertRecurringTicketSchema)) body: UpsertRecurringTicket,
  ): Promise<RecurringTicket> {
    return this.recurrence.save(body, id);
  }

  @Delete('recurring/:id')
  @RequireRight('recurrence', 'update')
  @HttpCode(204)
  async removeRecurring(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.recurrence.remove(id);
  }

  /**
   * Déclenche un balayage immédiat.
   *
   * Sert à l'exploitation : après avoir corrigé une récurrence en retard, on
   * veut voir le résultat sans attendre le cycle suivant. Ne produit rien de
   * plus que le balayage périodique — la trace anti-rejeu est la même.
   */
  @Post('recurring/run')
  @RequireRight('recurrence', 'update')
  async run(): Promise<{ created: number }> {
    return { created: await this.recurrence.sweep() };
  }
}
