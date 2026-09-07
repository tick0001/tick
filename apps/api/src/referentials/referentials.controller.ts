import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { itilCategoryFilterSchema, type ItilCategory, type ItilCategoryFilter } from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReferentialsService } from './referentials.service.js';

/**
 * Referentiels de saisie.
 *
 * Aucune garde de droit au-dela de la session : choisir une categorie fait
 * partie de l'ouverture d'un ticket, et l'exiger sous un droit de configuration
 * empecherait un demandeur de classer sa propre demande -- ce qui reviendrait a
 * lui demander d'ecrire ce qu'un technicien devra corriger.
 */
@Controller('referentials')
@UseGuards(AuthenticatedGuard)
export class ReferentialsController {
  constructor(private readonly referentials: ReferentialsService) {}

  @Get('itil-categories')
  async itilCategories(
    @Query(new ZodValidationPipe(itilCategoryFilterSchema)) filtre: ItilCategoryFilter,
  ): Promise<ItilCategory[]> {
    return this.referentials.itilCategories(filtre);
  }
}
