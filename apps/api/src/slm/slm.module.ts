import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EscalationService } from './escalation.service.js';
import { SlaService } from './sla.service.js';
import { SlmController } from './slm.controller.js';
import { SlmService } from './slm.service.js';

/**
 * Niveaux de service.
 *
 * Ne dépend pas des tickets, alors que les tickets dépendent de lui : le calcul
 * d'échéance ne connaît qu'un identifiant, une date d'ouverture et un temps
 * d'attente. C'est ce qui permet d'appliquer plus tard les mêmes engagements à
 * un problème ou à un changement sans rien réécrire.
 */
@Module({
  imports: [AuthModule],
  controllers: [SlmController],
  providers: [SlmService, SlaService, EscalationService],
  exports: [SlmService, SlaService, EscalationService],
})
export class SlmModule {}
