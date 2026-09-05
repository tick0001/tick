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
  UseGuards,
} from '@nestjs/common';
import {
  createEntitySchema,
  updateEntitySchema,
  type CreateEntity,
  type EntitySummary,
  type UpdateEntity,
} from '@tick/contracts';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { EntitiesService, type ResolvedSettings } from './entities.service.js';

@Controller('entities')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class EntitiesController {
  constructor(private readonly entities: EntitiesService) {}

  @Get()
  @RequireRight('entity', 'read')
  async list(): Promise<EntitySummary[]> {
    return this.entities.list();
  }

  @Get(':id')
  @RequireRight('entity', 'read')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<EntitySummary> {
    return this.entities.findById(id);
  }

  @Post()
  @RequireRight('entity', 'create')
  async create(
    @Body(new ZodValidationPipe(createEntitySchema)) body: CreateEntity,
  ): Promise<EntitySummary> {
    return this.entities.create(body);
  }

  @Patch(':id')
  @RequireRight('entity', 'update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(updateEntitySchema)) body: UpdateEntity,
  ): Promise<EntitySummary> {
    return this.entities.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireRight('entity', 'delete')
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.entities.softDelete(id);
  }

  /** Configuration effective, avec l'entite d'origine de chaque valeur heritee. */
  @Get(':id/settings')
  @RequireRight('entity', 'read')
  async settings(@Param('id', ParseIntPipe) id: number): Promise<ResolvedSettings> {
    return this.entities.resolveSettings(id);
  }
}
