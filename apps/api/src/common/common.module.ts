import { Global, Module } from '@nestjs/common';
import { SearchCompiler } from '../search/search-compiler.service.js';
import { SearchRegistry } from '../search/search-registry.service.js';
import { WidgetRegistry } from '../stats/widget-registry.service.js';
import { SecretsService } from './secrets.service.js';

/** Services transverses sans dependance metier, disponibles partout. */
@Global()
@Module({
  // Le registre des champs de recherche est global : le module de recherche
  // le lit, celui des plugins l'alimente, et les faire dependre l'un de l'autre
  // creerait un cycle avec le module des tickets.
  providers: [SecretsService, SearchRegistry, SearchCompiler, WidgetRegistry],
  exports: [SecretsService, SearchRegistry, SearchCompiler, WidgetRegistry],
})
export class CommonModule {}
