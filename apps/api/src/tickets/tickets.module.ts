import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EntitiesModule } from '../entities/entities.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { HistoryService } from './history.service.js';
import { PriorityService } from './priority.service.js';
import { TicketScopeService } from './ticket-scope.service.js';
import { TicketsController } from './tickets.controller.js';
import { TicketsService } from './tickets.service.js';
import { TimelineService } from './timeline.service.js';

@Module({
  imports: [AuthModule, PluginsModule, EntitiesModule],
  controllers: [TicketsController],
  providers: [TicketsService, TimelineService, TicketScopeService, PriorityService, HistoryService],
  exports: [TicketsService, TicketScopeService],
})
export class TicketsModule {}
