import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  upsertAgreementSchema,
  upsertCalendarSchema,
  type Agreement,
  type Calendar,
  type UpsertAgreement,
  type UpsertCalendar,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SlmService } from './slm.service.js';

@Controller()
@UseGuards(AuthenticatedGuard, RightsGuard)
export class SlmController {
  constructor(private readonly slm: SlmService) {}

  // --- Calendriers -----------------------------------------------------------

  @Get('calendars')
  @RequireRight('slm', 'read')
  async listCalendars(): Promise<Calendar[]> {
    return this.slm.listCalendars();
  }

  @Get('calendars/:id')
  @RequireRight('slm', 'read')
  async findCalendar(@Param('id', ParseIntPipe) id: number): Promise<Calendar> {
    return this.slm.findCalendar(id);
  }

  @Post('calendars')
  @RequireRight('slm', 'update')
  async createCalendar(
    @Body(new ZodValidationPipe(upsertCalendarSchema)) body: UpsertCalendar,
  ): Promise<Calendar> {
    return this.slm.saveCalendar(body);
  }

  @Put('calendars/:id')
  @RequireRight('slm', 'update')
  async updateCalendar(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertCalendarSchema)) body: UpsertCalendar,
  ): Promise<Calendar> {
    return this.slm.saveCalendar(body, id);
  }

  @Delete('calendars/:id')
  @RequireRight('slm', 'update')
  @HttpCode(204)
  async removeCalendar(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.slm.removeCalendar(id);
  }

  // --- Engagements -----------------------------------------------------------

  @Get('agreements')
  @RequireRight('slm', 'read')
  async listAgreements(): Promise<Agreement[]> {
    return this.slm.listAgreements();
  }

  @Get('agreements/:id')
  @RequireRight('slm', 'read')
  async findAgreement(@Param('id', ParseIntPipe) id: number): Promise<Agreement> {
    return this.slm.findAgreement(id);
  }

  @Post('agreements')
  @RequireRight('slm', 'update')
  async createAgreement(
    @Body(new ZodValidationPipe(upsertAgreementSchema)) body: UpsertAgreement,
  ): Promise<Agreement> {
    return this.slm.saveAgreement(body);
  }

  @Put('agreements/:id')
  @RequireRight('slm', 'update')
  async updateAgreement(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertAgreementSchema)) body: UpsertAgreement,
  ): Promise<Agreement> {
    return this.slm.saveAgreement(body, id);
  }

  @Delete('agreements/:id')
  @RequireRight('slm', 'update')
  @HttpCode(204)
  async removeAgreement(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.slm.removeAgreement(id);
  }
}
