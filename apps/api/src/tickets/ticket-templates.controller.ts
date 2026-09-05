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
  saveTicketTemplateSchema,
  type SaveTicketTemplate,
  type TicketTemplate,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TEMPLATE_FIELDS, TicketTemplatesService } from './ticket-templates.service.js';

@Controller('ticket-templates')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class TicketTemplatesController {
  constructor(private readonly templates: TicketTemplatesService) {}

  /** Champs qu'un gabarit peut piloter. Alimente l'editeur de gabarit. */
  @Get('fields')
  @RequireRight('ticket', 'read')
  fields(): readonly string[] {
    return TEMPLATE_FIELDS;
  }

  @Get()
  @RequireRight('ticket', 'read')
  async list(): Promise<TicketTemplate[]> {
    return this.templates.list();
  }

  @Get(':id')
  @RequireRight('ticket', 'read')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<TicketTemplate> {
    return this.templates.findById(id);
  }

  @Post()
  @RequireRight('ticket', 'update')
  async create(
    @Body(new ZodValidationPipe(saveTicketTemplateSchema)) body: SaveTicketTemplate,
  ): Promise<TicketTemplate> {
    return this.templates.save(body);
  }

  @Put(':id')
  @RequireRight('ticket', 'update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(saveTicketTemplateSchema)) body: SaveTicketTemplate,
  ): Promise<TicketTemplate> {
    return this.templates.save(body, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireRight('ticket', 'delete')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.templates.remove(id);
  }
}
