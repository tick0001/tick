import { Global, Module } from '@nestjs/common';
import { SecretsService } from './secrets.service.js';

/** Services transverses sans dependance metier, disponibles partout. */
@Global()
@Module({
  providers: [SecretsService],
  exports: [SecretsService],
})
export class CommonModule {}
