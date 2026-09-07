import { Module } from '@nestjs/common';
import { OpenApiController } from './openapi.controller.js';

/** Description de l'API, deduite des controleurs montes. */
@Module({ controllers: [OpenApiController] })
export class OpenApiModule {}
