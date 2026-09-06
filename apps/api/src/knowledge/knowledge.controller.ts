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
  kbQuerySchema,
  upsertKbArticleSchema,
  upsertKbCategorySchema,
  type KbArticle,
  type KbArticleSummary,
  type KbCategory,
  type KbQuery,
  type KbRevision,
  type PublicArticle,
  type PublicArticleSummary,
  type UpsertKbArticle,
  type UpsertKbCategory,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { KnowledgeService } from './knowledge.service.js';

/**
 * FAQ publique, sans authentification.
 *
 * Le drapeau « FAQ » d'un article est la decision de publication : rien d'autre
 * ne filtre ici, parce qu'il n'y a personne dont on pourrait verifier le profil.
 */
@Controller('public/faq')
export class PublicFaqController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  async list(@Query('search') search?: string): Promise<PublicArticleSummary[]> {
    return this.knowledge.publicList(search);
  }

  @Get(':id')
  async article(@Param('id', ParseIntPipe) id: number): Promise<PublicArticle> {
    return this.knowledge.publicArticle(id);
  }
}

@Controller('kb')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('categories')
  @RequireRight('kb', 'read')
  async categories(): Promise<KbCategory[]> {
    return this.knowledge.categories();
  }

  @Post('categories')
  @RequireRight('kb', 'update')
  async createCategory(
    @Body(new ZodValidationPipe(upsertKbCategorySchema)) body: UpsertKbCategory,
  ): Promise<KbCategory> {
    return this.knowledge.saveCategory(body);
  }

  @Put('categories/:id')
  @RequireRight('kb', 'update')
  async updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertKbCategorySchema)) body: UpsertKbCategory,
  ): Promise<KbCategory> {
    return this.knowledge.saveCategory(body, id);
  }

  @Delete('categories/:id')
  @RequireRight('kb', 'update')
  @HttpCode(204)
  async removeCategory(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.knowledge.removeCategory(id);
  }

  @Get()
  @RequireRight('kb', 'read')
  async list(
    @Query(new ZodValidationPipe(kbQuerySchema)) filtre: KbQuery,
  ): Promise<KbArticleSummary[]> {
    return this.knowledge.list(filtre);
  }

  @Get(':id')
  @RequireRight('kb', 'read')
  async read(@Param('id', ParseIntPipe) id: number): Promise<KbArticle> {
    return this.knowledge.read(id);
  }

  @Get(':id/revisions')
  @RequireRight('kb', 'read')
  async revisions(@Param('id', ParseIntPipe) id: number): Promise<KbRevision[]> {
    return this.knowledge.revisions(id);
  }

  @Post(':id/favorite')
  @RequireRight('kb', 'read')
  @HttpCode(200)
  async favorite(@Param('id', ParseIntPipe) id: number): Promise<{ isFavorite: boolean }> {
    return { isFavorite: await this.knowledge.toggleFavorite(id) };
  }

  @Post()
  @RequireRight('kb', 'update')
  async create(
    @Body(new ZodValidationPipe(upsertKbArticleSchema)) body: UpsertKbArticle,
  ): Promise<KbArticle> {
    return this.knowledge.save(body);
  }

  @Put(':id')
  @RequireRight('kb', 'update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertKbArticleSchema)) body: UpsertKbArticle,
  ): Promise<KbArticle> {
    return this.knowledge.save(body, id);
  }

  @Delete(':id')
  @RequireRight('kb', 'update')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.knowledge.remove(id);
  }
}
