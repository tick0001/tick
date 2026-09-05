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
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  reorderRulesSchema,
  ruleCollectionSchema,
  simulateRulesSchema,
  upsertRuleSchema,
  type ReorderRules,
  type Rule,
  type RuleField,
  type SimulateRules,
  type SimulationResult,
  type UpsertRule,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { currentContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RulesService } from './rules.service.js';

@Controller('rules')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class RulesController {
  constructor(private readonly rules: RulesService) {}

  /** Catalogue d'une collection, libellés déjà traduits comme pour la recherche. */
  @Get('fields')
  @RequireRight('rule', 'read')
  fields(@Query('collection') collection?: string): RuleField[] {
    const locale = currentContext()?.locale ?? 'fr';

    return this.rules.fields(ruleCollectionSchema.parse(collection), locale);
  }

  @Get()
  @RequireRight('rule', 'read')
  async list(@Query('collection') collection?: string): Promise<Rule[]> {
    return this.rules.list(
      collection === undefined ? undefined : ruleCollectionSchema.parse(collection),
    );
  }

  @Get(':id')
  @RequireRight('rule', 'read')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<Rule> {
    return this.rules.findById(id);
  }

  @Post()
  @RequireRight('rule', 'update')
  async create(@Body(new ZodValidationPipe(upsertRuleSchema)) body: UpsertRule): Promise<Rule> {
    return this.rules.save(body);
  }

  @Put(':id')
  @RequireRight('rule', 'update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertRuleSchema)) body: UpsertRule,
  ): Promise<Rule> {
    return this.rules.save(body, id);
  }

  @Post('reorder')
  @RequireRight('rule', 'update')
  @HttpCode(204)
  async reorder(
    @Body(new ZodValidationPipe(reorderRulesSchema)) body: ReorderRules,
  ): Promise<void> {
    await this.rules.reorder(body.ids);
  }

  /**
   * Simulation.
   *
   * En `POST` bien qu'elle n'écrive rien : les données de départ d'un ticket
   * n'ont pas leur place dans une URL, ni dans les journaux du serveur mandataire.
   */
  @Post('simulate')
  @RequireRight('rule', 'read')
  @HttpCode(200)
  async simulate(
    @Body(new ZodValidationPipe(simulateRulesSchema)) body: SimulateRules,
  ): Promise<SimulationResult> {
    return this.rules.simulate(body.collection, body.input);
  }

  @Delete(':id')
  @RequireRight('rule', 'update')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.rules.remove(id);
  }
}
