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
  UseGuards,
} from '@nestjs/common';
import {
  submitFormSchema,
  upsertFormSchema,
  type Form,
  type FormSubmissionResult,
  type FormSummary,
  type SubmitForm,
  type UpsertForm,
} from '@tick/contracts';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FormsService } from './forms.service.js';

/**
 * Catalogue de services, ouvert a toute personne connectee.
 *
 * Aucun droit d'administration exige : remplir un formulaire est ce que fait un
 * demandeur, et le subordonner a un droit reviendrait a lui fermer la porte
 * qu'on vient d'ouvrir.
 */
@Controller('catalogue')
@UseGuards(AuthenticatedGuard)
export class CatalogueController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  async list(): Promise<FormSummary[]> {
    return this.forms.catalogue();
  }

  @Get(':id')
  async render(@Param('id', ParseIntPipe) id: number): Promise<Form> {
    return this.forms.render(id);
  }

  @Post(':id')
  @HttpCode(201)
  async submit(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(submitFormSchema)) body: SubmitForm,
  ): Promise<FormSubmissionResult> {
    return this.forms.submit(id, body);
  }
}

@Controller('forms')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class FormsController {
  constructor(private readonly forms: FormsService) {}

  @Get()
  @RequireRight('form', 'read')
  async list(): Promise<Form[]> {
    return this.forms.list();
  }

  @Get(':id')
  @RequireRight('form', 'read')
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<Form> {
    return this.forms.findById(id);
  }

  @Post()
  @RequireRight('form', 'update')
  async create(@Body(new ZodValidationPipe(upsertFormSchema)) body: UpsertForm): Promise<Form> {
    return this.forms.save(body);
  }

  @Put(':id')
  @RequireRight('form', 'update')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body(new ZodValidationPipe(upsertFormSchema)) body: UpsertForm,
  ): Promise<Form> {
    return this.forms.save(body, id);
  }

  @Delete(':id')
  @RequireRight('form', 'update')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.forms.remove(id);
  }
}
