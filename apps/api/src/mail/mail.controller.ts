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
  upsertMailCollectorSchema,
  type MailCollector,
  type MailCollectorLog,
  type UpsertMailCollector,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MailCollectorService } from './mail-collector.service.js';
import { MailCollectorsService } from './mail-collectors.service.js';

@Controller('mail-collectors')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class MailController {
  constructor(
    private readonly collectors: MailCollectorsService,
    private readonly collector: MailCollectorService,
  ) {}

  @Get()
  @RequireRight('mailcollector', 'read')
  async list(): Promise<MailCollector[]> {
    return this.collectors.list();
  }

  @Get(':id/logs')
  @RequireRight('mailcollector', 'read')
  async logs(@Param('id', ParseIntPipe) id: number): Promise<MailCollectorLog[]> {
    return this.collectors.logs(id);
  }

  @Post()
  @RequireRight('mailcollector', 'update')
  async create(
    @Body(new ZodValidationPipe(upsertMailCollectorSchema)) body: UpsertMailCollector,
  ): Promise<MailCollector> {
    return this.collectors.save(body);
  }

  @Put(':id')
  @RequireRight('mailcollector', 'update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertMailCollectorSchema)) body: UpsertMailCollector,
  ): Promise<MailCollector> {
    return this.collectors.save(body, id);
  }

  /**
   * Releve immediate.
   *
   * Le collecteur tourne de lui-meme toutes les deux minutes ; ce bouton
   * existe pour l'unique moment ou l'on en a vraiment besoin : verifier une
   * configuration qu'on vient de saisir, sans attendre le prochain cycle.
   */
  @Post(':id/collect')
  @RequireRight('mailcollector', 'update')
  @HttpCode(200)
  async collect(@Param('id', ParseIntPipe) id: number): Promise<{ processed: number }> {
    // L'existence et la visibilite sont verifiees sous Row-Level Security avant
    // de lancer une releve qui, elle, s'execute avec le role proprietaire.
    await this.collectors.findById(id);

    return { processed: await this.collector.collectOne(id) };
  }

  @Delete(':id')
  @RequireRight('mailcollector', 'update')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.collectors.remove(id);
  }
}
