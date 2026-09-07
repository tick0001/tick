import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EntitiesModule } from '../entities/entities.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { RulesCoreModule } from '../rules/rules-core.module.js';
import { SlmModule } from '../slm/slm.module.js';
import { ActorsService } from './actors.service.js';
import { BulkService } from './bulk.service.js';
import { HistoryService } from './history.service.js';
import { PriorityService } from './priority.service.js';
import { TicketScopeService } from './ticket-scope.service.js';
import { TicketTemplatesService } from './ticket-templates.service.js';
import { TicketTemplatesController } from './ticket-templates.controller.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { TimelineService } from './timeline.service.js';

@Module({
  imports: [AuthModule, PluginsModule, EntitiesModule, RulesCoreModule, SlmModule],
  controllers: [TicketsController, TicketTemplatesController],
  providers: [
    TicketsService,
    ActorsService,
    BulkService,
    TimelineService,
    TicketScopeService,
    PriorityService,
    HistoryService,
    TicketTemplatesService,
  ],
  exports: [
    TicketsService,
    ActorsService,
    TimelineService,
    TicketScopeService,
    TicketTemplatesService,
    HistoryService,
    PriorityService,
  ],
})
export class TicketsModule {}
