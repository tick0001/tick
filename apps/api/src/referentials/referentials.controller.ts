import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  itilCategoryFilterSchema,
  upsertItilCategorySchema,
  type ItilCategory,
  type ItilCategoryDetail,
  type ItilCategoryFilter,
  type UpsertItilCategory,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ReferentialsService } from './referentials.service.js';

/**
 * Referentiels de saisie.
 *
 * La lecture n'a pas de garde de droit au-dela de la session : choisir une
 * categorie fait partie de l'ouverture d'un ticket, et l'exiger sous un droit
 * de configuration empecherait un demandeur de classer sa propre demande --
 * ce qui reviendrait a lui demander d'ecrire ce qu'un technicien devra
 * corriger.
 *
 * L'ecriture, elle, est gardee. Le Row-Level Security tient le perimetre : il
 * dit dans quelle branche on ecrit, mais il ne dit pas si l'on a le droit
 * d'ecrire. Sans garde, tout compte authentifie pourrait renommer le
 * referentiel de son entite -- et le classement de tous ses tickets avec.
 */
@Controller('referentials')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class ReferentialsController {
  constructor(private readonly referentials: ReferentialsService) {}

  @Get('itil-categories')
  async itilCategories(
    @Query(new ZodValidationPipe(itilCategoryFilterSchema)) filtre: ItilCategoryFilter,
  ): Promise<ItilCategory[]> {
    return this.referentials.itilCategories(filtre);
  }

  /**
   * Vue de configuration.
   *
   * Route distincte de la precedente, et non un parametre de plus : les deux
   * n'ont ni le meme public, ni le meme filtrage, ni la meme forme de reponse.
   * Les fondre aurait rendu la liste du guichet dependante d'un drapeau qu'un
   * client peut envoyer.
   */
  @Get('itil-categories/all')
  @RequireRight('category', 'update')
  async itilCategoriesDetail(): Promise<ItilCategoryDetail[]> {
    return this.referentials.itilCategoriesDetail();
  }

  @Post('itil-categories')
  @RequireRight('category', 'create')
  async createItilCategory(
    @Body(new ZodValidationPipe(upsertItilCategorySchema)) body: UpsertItilCategory,
  ): Promise<ItilCategoryDetail> {
    return this.referentials.saveItilCategory(body);
  }

  @Put('itil-categories/:id')
  @RequireRight('category', 'update')
  async updateItilCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertItilCategorySchema)) body: UpsertItilCategory,
  ): Promise<ItilCategoryDetail> {
    return this.referentials.saveItilCategory(body, id);
  }

  @Delete('itil-categories/:id')
  @HttpCode(204)
  @RequireRight('category', 'delete')
  async removeItilCategory(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.referentials.removeItilCategory(id);
  }
}
