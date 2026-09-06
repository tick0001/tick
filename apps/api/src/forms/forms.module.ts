import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { CatalogueController, FormsController } from './forms.controller.js';
import { FormsService } from './forms.service.js';

/**
 * Formulaires et catalogue de services.
 *
 * Depend des tickets, jamais l'inverse : un formulaire n'est qu'une facon
 * guidee d'ouvrir un ticket, et le coeur n'a pas a savoir qu'il existe.
 */
@Module({
  imports: [AuthModule, TicketsModule],
  controllers: [FormsController, CatalogueController],
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
