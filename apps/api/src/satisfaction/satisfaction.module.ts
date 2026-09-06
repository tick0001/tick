import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { PublicSatisfactionController, SatisfactionController } from './satisfaction.controller.js';
import { SatisfactionService } from './satisfaction.service.js';

/**
 * Enquetes de satisfaction.
 *
 * Ne connait ni les tickets ni les notifications : elle ecoute la cloture et
 * publie un evenement. Ce sont les modeles de notification qui decident du
 * texte, comme pour tout le reste de l'application.
 */
@Module({
  imports: [AuthModule, PluginsModule],
  controllers: [SatisfactionController, PublicSatisfactionController],
  providers: [SatisfactionService],
  exports: [SatisfactionService],
})
export class SatisfactionModule {}
