import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TicketsModule } from '../tickets/tickets.module.js';
import { SavedSearchesService } from './saved-searches.service.js';
import { SearchController } from './search.controller.js';

/**
 * Le registre et le compilateur vivent dans le module commun, global : les
 * plugins les alimentent sans que ce module et le leur se referencent.
 */
@Module({
  imports: [AuthModule, TicketsModule],
  controllers: [SearchController],
  providers: [SavedSearchesService],
})
export class SearchModule {}
