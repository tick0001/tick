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
  saveSearchSchema,
  searchRequestSchema,
  type SavedSearch,
  type SaveSearch,
  type SearchField,
  type SearchRequest,
  type TicketPage,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { currentContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { SavedSearchesService } from './saved-searches.service.js';
import { SearchCompiler } from './search-compiler.service.js';
import { SearchRegistry } from './search-registry.service.js';
import { translate } from './search-labels.js';

@Controller('search')
@UseGuards(AuthenticatedGuard)
export class SearchController {
  constructor(
    private readonly registry: SearchRegistry,
    private readonly compiler: SearchCompiler,
    private readonly tickets: TicketsService,
    private readonly saved: SavedSearchesService,
  ) {}

  /**
   * Champs interrogeables, libellés déjà traduits.
   *
   * Traduits côté serveur parce que les plugins déclarent leurs propres champs :
   * l'interface ne peut pas connaître à l'avance les clés à traduire.
   */
  @Get('fields')
  fields(): SearchField[] {
    const locale = currentContext()?.locale ?? 'fr';

    return this.registry.list().map((champ) => ({
      key: champ.key,
      label: translate(champ.labelKey, locale),
      type: champ.type,
      operators: [...champ.operators],
      ...(champ.options
        ? { options: champ.options.map((valeur) => ({ value: valeur, label: valeur })) }
        : {}),
      ...(champ.pluginId ? { pluginId: champ.pluginId } : {}),
    }));
  }

  @Post('tickets')
  @HttpCode(200)
  async searchTickets(
    @Body(new ZodValidationPipe(searchRequestSchema)) body: SearchRequest,
  ): Promise<TicketPage> {
    return this.tickets.search(this.compiler.compile(body.criteria), {
      sort: body.sort,
      direction: body.direction,
      limit: body.limit,
      cursor: body.cursor,
      deleted: body.deleted,
    });
  }

  @Get('saved')
  async listSaved(@Query('target') target?: string): Promise<SavedSearch[]> {
    return this.saved.list(target ?? 'ticket');
  }

  @Post('saved')
  async create(
    @Body(new ZodValidationPipe(saveSearchSchema)) body: SaveSearch,
  ): Promise<SavedSearch> {
    return this.saved.save(body);
  }

  @Put('saved/:id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(saveSearchSchema)) body: SaveSearch,
  ): Promise<SavedSearch> {
    return this.saved.save(body, id);
  }

  @Delete('saved/:id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.saved.remove(id);
  }
}
