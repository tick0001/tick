import {
  BadRequestException,
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
  createLinkSchema,
  itilObjectFilterSchema,
  promoteSchema,
  requestValidationSchema,
  ticketActorInputSchema,
  updateTaskSchema,
  updateItilObjectSchema,
  upsertItilObjectSchema,
  type UpdateItilObject,
  type AddFollowup,
  type AddSolution,
  type AddTask,
  type AnswerSolution,
  type AnswerValidation,
  type CreateLink,
  type ItilKind,
  type ItilLink,
  type ItilObject,
  type ItilObjectFilter,
  type ItilObjectSummary,
  type ItilType,
  type Promote,
  type PromotionResult,
  type RequestValidation,
  type TicketActor,
  type TicketActorInput,
  type TimelineEntry,
  type UpdateTask,
} from '@tick/contracts';
import { z } from 'zod';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TimelineService } from '../tickets/timeline.service.js';
import { ItilObjectsService } from './itil-objects.service.js';
import { LinksService } from './links.service.js';

/**
 * Segment d'URL vers type d'objet.
 *
 * Le pluriel dans l'URL, le singulier dans le modèle : `/itil/problems/12` se
 * lit comme une collection, ce que `/itil/problem/12` ne fait pas. La table de
 * correspondance est explicite pour que l'URL ne dépende pas d'une règle de
 * pluralisation.
 */
const SEGMENTS: Record<string, ItilType> = {
  tickets: 'ticket',
  problems: 'problem',
  changes: 'change',
};

function typeDe(segment: string): ItilType {
  const type = SEGMENTS[segment];

  if (!type) throw new BadRequestException('Type d objet inconnu.');

  return type;
}

/** Variante refusant le ticket : il a son propre contrôleur. */
function kindDe(segment: string): ItilKind {
  const type = typeDe(segment);

  if (type === 'ticket') {
    throw new BadRequestException('Les tickets se gerent sur /api/tickets.');
  }

  return type;
}

/**
 * Problèmes, changements, et les liens de tout objet ITIL.
 *
 * Un seul contrôleur pour deux objets : ils partagent le contrat, seul le
 * segment d'URL change. Les liens y sont aussi, y compris ceux des tickets,
 * parce qu'un lien n'appartient à aucun des deux bouts.
 */
@Controller('itil')
@UseGuards(AuthenticatedGuard)
export class ItilController {
  constructor(
    private readonly objects: ItilObjectsService,
    private readonly links: LinksService,
    private readonly timeline: TimelineService,
  ) {}

  @Get(':kind')
  async list(
    @Param('kind') kind: string,
    @Query(new ZodValidationPipe(itilObjectFilterSchema)) filter: ItilObjectFilter,
  ): Promise<ItilObjectSummary[]> {
    return this.objects.list(kindDe(kind), filter);
  }

  @Get(':kind/:id')
  async findOne(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ItilObject> {
    return this.objects.findById(kindDe(kind), id);
  }

  @Post(':kind')
  async create(
    @Param('kind') kind: string,
    @Body(new ZodValidationPipe(upsertItilObjectSchema)) body: z.infer<typeof upsertItilObjectSchema>,
  ): Promise<ItilObject> {
    return this.objects.create(kindDe(kind), body);
  }

  @Patch(':kind/:id')
  async update(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateItilObjectSchema)) body: UpdateItilObject,
  ): Promise<ItilObject> {
    return this.objects.update(kindDe(kind), id, body);
  }

  @Delete(':kind/:id')
  @HttpCode(204)
  async remove(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    await this.objects.softDelete(kindDe(kind), id);
  }

  @Get(':kind/:id/actors')
  async actors(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TicketActor[]> {
    return this.objects.actorsOf(kindDe(kind), id);
  }

  @Post(':kind/:id/actors')
  async setActors(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(z.array(ticketActorInputSchema).min(1)))
    body: TicketActorInput[],
  ): Promise<TicketActor[]> {
    return this.objects.setActors(kindDe(kind), id, body);
  }

  // --- Chronologie : la même que celle du ticket, sur le même socle. --------

  @Get(':kind/:id/timeline')
  async timelineOf(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TimelineEntry[]> {
    return this.timeline.timelineFor(id, kindDe(kind));
  }

  @Post(':kind/:id/followups')
  @HttpCode(204)
  async addFollowup(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(addFollowupSchema)) body: AddFollowup,
  ): Promise<void> {
    await this.timeline.addFollowup(id, body, kindDe(kind));
  }

  @Post(':kind/:id/tasks')
  @HttpCode(204)
  async addTask(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(addTaskSchema)) body: AddTask,
  ): Promise<void> {
    await this.timeline.addTask(id, body, kindDe(kind));
  }

  @Patch(':kind/:id/tasks/:taskId')
  @HttpCode(204)
  async updateTask(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('taskId', ParseIntPipe) taskId: number,
    @Body(new ZodValidationPipe(updateTaskSchema)) body: UpdateTask,
  ): Promise<void> {
    await this.timeline.updateTask(id, taskId, body, kindDe(kind));
  }

  @Post(':kind/:id/solutions')
  @HttpCode(204)
  async addSolution(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(addSolutionSchema)) body: AddSolution,
  ): Promise<void> {
    await this.timeline.addSolution(id, body, kindDe(kind));
  }

  @Post(':kind/:id/solutions/answer')
  @HttpCode(204)
  async answerSolution(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(answerSolutionSchema)) body: AnswerSolution,
  ): Promise<void> {
    await this.timeline.answerSolution(id, body, kindDe(kind));
  }

  @Post(':kind/:id/validations')
  @HttpCode(204)
  async requestValidation(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(requestValidationSchema)) body: RequestValidation,
  ): Promise<void> {
    await this.timeline.requestValidation(id, body, kindDe(kind));
  }

  @Post(':kind/:id/validations/:validationId/answer')
  @HttpCode(204)
  async answerValidation(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('validationId', ParseIntPipe) validationId: number,
    @Body(new ZodValidationPipe(answerValidationSchema)) body: AnswerValidation,
  ): Promise<void> {
    await this.timeline.answerValidation(id, validationId, body, kindDe(kind));
  }

  // --- Liens et promotion : ouverts aussi aux tickets. ----------------------

  @Get(':kind/:id/links')
  async linksOf(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<ItilLink[]> {
    return this.links.linksOf(typeDe(kind), id);
  }

  @Post(':kind/:id/links')
  async link(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(createLinkSchema)) body: CreateLink,
  ): Promise<ItilLink[]> {
    return this.links.create(typeDe(kind), id, body);
  }

  @Delete(':kind/:id/links/:linkId')
  @HttpCode(204)
  async unlink(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Param('linkId', ParseIntPipe) linkId: number,
  ): Promise<void> {
    await this.links.remove(typeDe(kind), id, linkId);
  }

  @Post(':kind/:id/promote')
  async promote(
    @Param('kind') kind: string,
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(promoteSchema)) body: Promote,
  ): Promise<PromotionResult> {
    return this.links.promote(typeDe(kind), id, body);
  }
}
