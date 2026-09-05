import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import {
  DocumentsService,
  MAX_SIZE,
  type StoredDocument,
  type UploadedFileLike,
} from './documents.service.js';

/**
 * Pieces jointes.
 *
 * Le rattachement est polymorphe : le meme mecanisme servira aux problemes, aux
 * changements et aux articles de connaissance sans nouvelle route.
 */
@Controller('documents')
@UseGuards(AuthenticatedGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  // Prefixe `items` obligatoire : sans lui, `/documents/1/content` serait
  // capte par cette route, avec itemType = « 1 » et itemId = « content ».
  @Get('items/:itemType/:itemId')
  async list(
    @Param('itemType') itemType: string,
    @Param('itemId', ParseIntPipe) itemId: number,
  ): Promise<StoredDocument[]> {
    return this.documents.listFor(itemType, itemId);
  }

  @Post('items/:itemType/:itemId')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SIZE } }))
  async upload(
    @Param('itemType') itemType: string,
    @Param('itemId', ParseIntPipe) itemId: number,
    @UploadedFile() file: UploadedFileLike,
  ): Promise<StoredDocument> {
    return this.documents.upload(file, { itemType, itemId });
  }

  /**
   * Telechargement.
   *
   * `Content-Disposition: attachment` et `X-Content-Type-Options: nosniff` :
   * une piece jointe deposee par un tiers ne doit jamais s'executer dans le
   * navigateur d'un collegue.
   */
  @Get(':id/content')
  @Header('X-Content-Type-Options', 'nosniff')
  async download(
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const { document, contenu } = await this.documents.read(id);

    response.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(document.name)}`,
    );

    // `StreamableFile` plutot qu'un Buffer renvoye tel quel : ce dernier
    // passerait par la serialisation JSON et arriverait sous forme de tableau
    // d'octets.
    return new StreamableFile(contenu, { type: document.mimeType });
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.documents.remove(id);
  }
}
