import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { PlanningController } from './planning.controller.js';
import { PlanningService } from './planning.service.js';
import { RecurrenceService } from './recurrence.service.js';

/**
 * Planning et tickets récurrents.
 *
 * Les deux vivent ensemble parce qu'ils parlent du même axe : le temps. L'un
 * montre ce qui est prévu, l'autre produit ce qui revient.
 */
@Module({
  imports: [AuthModule, TicketsModule],
  controllers: [PlanningController],
  providers: [PlanningService, RecurrenceService],
  exports: [PlanningService, RecurrenceService],
})
export class PlanningModule {}
