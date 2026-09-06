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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  exportFormatSchema,
  searchRequestSchema,
  statsFilterSchema,
  upsertDashboardSchema,
  type Dashboard,
  type SearchRequest,
  type StatsFilter,
  type StatsReport,
  type StatsTrendPoint,
  type UpsertDashboard,
  type WidgetCatalogEntry,
} from '@tick/contracts';
import type { Response } from 'express';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { currentContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SearchCompiler } from '../search/search-compiler.service.js';
import { translate } from '../search/search-labels.js';
import { TicketsService } from '../tickets/tickets.service.js';
import { DashboardsService } from './dashboards.service.js';
import { toCsv, toPdf, type Colonne } from './export.js';
import { StatsService } from './stats.service.js';
import { WidgetRegistry } from './widget-registry.service.js';

/**
 * Colonnes de l'export.
 *
 * Fixes plutôt que choisies par l'appelant : un export sert à transmettre, pas
 * à explorer, et une liste stable garantit que le fichier reçu la semaine
 * prochaine se lit avec le même tableur que celui d'aujourd'hui.
 */
const COLONNES: readonly Colonne[] = [
  { key: 'id', label: 'N°' },
  { key: 'name', label: 'Sujet' },
  { key: 'status', label: 'Statut' },
  { key: 'priority', label: 'Priorite' },
  { key: 'category', label: 'Categorie' },
  { key: 'requesters', label: 'Demandeurs' },
  { key: 'assignees', label: 'Attribue a' },
  { key: 'entity', label: 'Entite' },
  { key: 'dateOpened', label: 'Ouvert le' },
];

/** Tickets exportables en une fois, pour borner le temps et la mémoire. */
const EXPORT_MAX = 2000;

@Controller('stats')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class StatsController {
  constructor(
    private readonly stats: StatsService,
    private readonly dashboards: DashboardsService,
    private readonly widgets: WidgetRegistry,
    private readonly compiler: SearchCompiler,
    private readonly tickets: TicketsService,
  ) {}

  @Get()
  @RequireRight('stats', 'read')
  async report(
    @Query(new ZodValidationPipe(statsFilterSchema)) filter: StatsFilter,
  ): Promise<StatsReport> {
    return this.stats.report(filter);
  }

  @Get('trend')
  @RequireRight('stats', 'read')
  async trend(
    @Query(new ZodValidationPipe(statsFilterSchema)) filter: StatsFilter,
  ): Promise<StatsTrendPoint[]> {
    return this.stats.trend(filter);
  }

  /** Widgets disponibles, libellés déjà traduits — les plugins en déclarent. */
  @Get('widgets')
  @RequireRight('stats', 'read')
  widgetCatalog(): WidgetCatalogEntry[] {
    const locale = currentContext()?.locale ?? 'fr';

    return this.widgets.list().map((widget) => ({
      kind: widget.kind,
      label: translate(widget.labelKey, locale),
      description: translate(widget.descriptionKey, locale),
      ...(widget.pluginId ? { pluginId: widget.pluginId } : {}),
    }));
  }

  @Get('dashboards')
  @RequireRight('stats', 'read')
  async listDashboards(): Promise<Dashboard[]> {
    return this.dashboards.list();
  }

  @Post('dashboards')
  @RequireRight('stats', 'read')
  async createDashboard(
    @Body(new ZodValidationPipe(upsertDashboardSchema)) body: UpsertDashboard,
  ): Promise<Dashboard> {
    return this.dashboards.save(body);
  }

  @Put('dashboards/:id')
  @RequireRight('stats', 'read')
  async updateDashboard(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertDashboardSchema)) body: UpsertDashboard,
  ): Promise<Dashboard> {
    return this.dashboards.save(body, id);
  }

  @Delete('dashboards/:id')
  @RequireRight('stats', 'read')
  @HttpCode(204)
  async removeDashboard(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.dashboards.remove(id);
  }

  /**
   * Export de la recherche courante.
   *
   * Le corps est la même requête que la recherche : l'export doit rendre
   * exactement ce que l'écran montre, et lui passer un filtre distinct est le
   * moyen le plus sûr de livrer autre chose que ce qui a été vérifié à l'écran.
   */
  @Post('export')
  @RequireRight('stats', 'read')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async exportTickets(
    @Query('format', new ZodValidationPipe(exportFormatSchema)) format: 'csv' | 'pdf',
    @Body(new ZodValidationPipe(searchRequestSchema)) body: SearchRequest,
    @Res() response: Response,
  ): Promise<void> {
    const page = await this.tickets.search(this.compiler.compile(body.criteria), {
      sort: body.sort,
      direction: body.direction,
      limit: Math.min(body.limit, EXPORT_MAX),
      deleted: body.deleted,
    });

    const lignes = page.items.map((ticket) => ({
      id: ticket.id,
      name: ticket.name,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category?.name ?? '',
      requesters: ticket.requesters.join(', '),
      assignees: ticket.assignees.join(', '),
      entity: ticket.entity.name,
      dateOpened: ticket.dateOpened,
    }));

    if (format === 'csv') {
      response
        .status(200)
        .setHeader('Content-Type', 'text/csv; charset=utf-8')
        .setHeader('Content-Disposition', 'attachment; filename="tickets.csv"')
        .send(toCsv(COLONNES, lignes));

      return;
    }

    response
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Disposition', 'attachment; filename="tickets.pdf"')
      .send(toPdf('Tick& — Tickets', COLONNES, lignes));
  }
}
