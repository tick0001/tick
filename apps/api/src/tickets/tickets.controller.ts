import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  addFollowupSchema,
  addSolutionSchema,
  addTaskSchema,
  answerSolutionSchema,
  answerValidationSchema,
  createTicketSchema,
  requestValidationSchema,
  ticketActorInputSchema,
  ticketFilterSchema,
  updateTaskSchema,
  updateTicketSchema,
  type AddFollowup,
  type AddSolution,
  type AddTask,
  type AnswerSolution,
  type AnswerValidation,
  type CreateTicket,
  type RequestValidation,
  type TicketActor,
  type TicketActorInput,
  type TicketDetail,
  type TicketFilter,
  type TicketPage,
  type TimelineEntry,
  type UpdateTask,
  type UpdateTicket,
  type TicketAgreement,
} from '@tick/contracts';
import { z } from 'zod';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SlaService } from '../slm/sla.service.js';
import { TicketsService } from './tickets.service.js';
import { TimelineService } from './timeline.service.js';

/**
 * Les droits ne sont pas verifies par une garde mais par les services.
 *
 * La portee d'un droit (`own`, `group`, `entity`...) ne dit pas *si* l'acces
 * est permis mais *quelles lignes* le sont : elle doit donc entrer dans la
 * requete, ce qu'une garde ne peut pas faire. Le refus reste explicite, il est
 * simplement leve plus bas.
 */
@Controller('tickets')
@UseGuards(AuthenticatedGuard)
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly timeline: TimelineService,
    private readonly sla: SlaService,
  ) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(ticketFilterSchema)) filter: TicketFilter,
  ): Promise<TicketPage> {
    return this.tickets.list(filter);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<TicketDetail> {
    return this.tickets.findById(id);
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createTicketSchema)) body: CreateTicket,
  ): Promise<TicketDetail> {
    return this.tickets.create(body);
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateTicketSchema)) body: UpdateTicket,
  ): Promise<TicketDetail> {
    return this.tickets.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.tickets.softDelete(id);
  }

  @Post(':id/restore')
  @HttpCode(204)
  async restore(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.tickets.restore(id);
  }

  /**
   * Engagements applicables au ticket, avec le temps restant.
   *
   * Servi a part de la fiche : c'est une information qui se perime a la
   * seconde, et la recalculer a chaque lecture de ticket couterait cher pour
   * une donnee que toutes les vues n'affichent pas.
   */
  @Get(':id/agreements')
  async agreements(@Param('id', ParseIntPipe) id: number): Promise<TicketAgreement[]> {
    return this.sla.statusOf(id);
  }

  @Get(':id/actors')
  async actors(@Param('id', ParseIntPipe) id: number): Promise<TicketActor[]> {
    return this.tickets.actorsOf(id);
  }

  @Post(':id/actors')
  async setActors(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(z.array(ticketActorInputSchema).min(1)))
    body: TicketActorInput[],
  ): Promise<TicketActor[]> {
    return this.tickets.setActors(id, body);
  }

  @Get(':id/timeline')
  async timelineOf(@Param('id', ParseIntPipe) id: number): Promise<TimelineEntry[]> {
    return this.timeline.timelineFor(id);
  }

  @Post(':id/followups')
  @HttpCode(204)
  async addFollowup(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(addFollowupSchema)) body: AddFollowup,
  ): Promise<void> {
    await this.timeline.addFollowup(id, body);
  }

  @Post(':id/tasks')
  @HttpCode(204)
  async addTask(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(addTaskSchema)) body: AddTask,
  ): Promise<void> {
    await this.timeline.addTask(id, body);
  }

  @Patch(':id/tasks/:taskId')
  @HttpCode(204)
  async updateTask(
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTask,
  ): Promise<void> {
    await this.timeline.updateTask(id, taskId, body);
  }

  @Post(':id/solutions')
  @HttpCode(204)
  async addSolution(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(addSolutionSchema)) body: AddSolution,
  ): Promise<void> {
    await this.timeline.addSolution(id, body);
  }

  @Post(':id/solutions/answer')
  @HttpCode(204)
  async answerSolution(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(answerSolutionSchema)) body: AnswerSolution,
  ): Promise<void> {
    await this.timeline.answerSolution(id, body);
  }

  @Post(':id/validations')
  @HttpCode(204)
  async requestValidation(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(requestValidationSchema)) body: RequestValidation,
  ): Promise<void> {
    await this.timeline.requestValidation(id, body);
  }

  @Post(':id/validations/:validationId/answer')
  @HttpCode(204)
  async answerValidation(
    @Param('id', ParseIntPipe) id: number,
    @Param('validationId', ParseIntPipe) validationId: number,
    @Body(new ZodValidationPipe(answerValidationSchema)) body: AnswerValidation,
  ): Promise<void> {
    await this.timeline.answerValidation(id, validationId, body);
  }
}
