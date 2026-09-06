import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { DashboardsService } from './dashboards.service.js';
import { StatsController } from './stats.controller.js';
import { StatsService } from './stats.service.js';

/**
 * Statistiques, tableaux de bord et exports.
 *
 * Le registre des widgets vit dans le module commun, global : ce module le lit,
 * celui des plugins l'alimente, et les faire se référencer créerait le même
 * cycle que pour les champs de recherche.
 */
@Module({
  imports: [AuthModule, TicketsModule],
  controllers: [StatsController],
  providers: [StatsService, DashboardsService],
  exports: [StatsService, DashboardsService],
})
export class StatsModule {}
