import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocumentsModule } from '../documents/documents.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { MailCollectorService } from './mail-collector.service.js';
import { MailCollectorsService } from './mail-collectors.service.js';
import { MailController } from './mail.controller.js';

/**
 * Courriel entrant.
 *
 * Depend des tickets et des documents, jamais l'inverse : un courriel n'est
 * qu'une facon d'ouvrir ou de completer un ticket, et le coeur n'a pas a savoir
 * qu'une messagerie existe.
 */
@Module({
  imports: [AuthModule, TicketsModule, DocumentsModule],
  controllers: [MailController],
  providers: [MailCollectorsService, MailCollectorService],
  exports: [MailCollectorsService, MailCollectorService],
})
export class MailModule {}
