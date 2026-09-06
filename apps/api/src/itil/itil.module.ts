import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { ItilController } from './itil.controller.js';
import { ItilObjectsService } from './itil-objects.service.js';
import { LinksService } from './links.service.js';

/**
 * Problèmes, changements et liens.
 *
 * Dépend du module `tickets` pour l'historique, la priorité, la portée et la
 * chronologie : ce sont les briques du socle ITIL commun, et les dupliquer ici
 * laisserait deux implémentations diverger.
 */
@Module({
  imports: [AuthModule, TicketsModule],
  controllers: [ItilController],
  providers: [ItilObjectsService, LinksService],
  exports: [ItilObjectsService, LinksService],
})
export class ItilModule {}
