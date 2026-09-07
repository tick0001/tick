import { Controller, Get } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { loadEnv } from '../config/env.js';
import { construireOpenApi, decouvrirRoutes } from './openapi.builder.js';

/**
 * Le document OpenAPI, servi par l'API qu'il décrit.
 *
 * Sans session : une description d'interface publique qu'il faudrait un compte
 * pour lire n'aurait pas de public. Elle ne divulgue rien de plus que les
 * chemins et les formes attendues — ce qu'un client légitime doit connaître, et
 * ce qu'un client hostile découvre de toute façon en essayant.
 *
 * Le document est calculé une fois puis conservé : il ne dépend que du code
 * monté, qui ne change pas en cours d'exécution.
 */
@Controller('openapi.json')
export class OpenApiController {
  private document: Record<string, unknown> | null = null;

  constructor(private readonly moduleRef: ModuleRef) {}

  @Get()
  get(): Record<string, unknown> {
    if (this.document) return this.document;

    const env = loadEnv();
    const application = this.moduleRef as unknown as INestApplicationContext;

    this.document = construireOpenApi(decouvrirRoutes(application), {
      titre: 'Tick&',
      version: process.env['npm_package_version'] ?? '0.0.0',
      serveur: env.API_URL,
    });

    return this.document;
  }
}
