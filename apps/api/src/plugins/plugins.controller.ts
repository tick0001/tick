import { readFile } from 'node:fs/promises';
import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthenticatedGuard } from '../auth/guards/authenticated.guard.js';
import { RequireRight, RightsGuard } from '../auth/guards/rights.guard.js';
import { PluginRegistry } from './plugin-registry.service.js';
import { PluginsService, type PluginStatus } from './plugins.service.js';

@Controller('plugins')
@UseGuards(AuthenticatedGuard, RightsGuard)
export class PluginsController {
  constructor(
    private readonly plugins: PluginsService,
    private readonly registry: PluginRegistry,
  ) {}

  @Get()
  @RequireRight('plugin', 'read')
  async list(): Promise<PluginStatus[]> {
    return this.plugins.list();
  }

  @Post(':id/install')
  @HttpCode(204)
  @RequireRight('plugin', 'update')
  async install(@Param('id') id: string): Promise<void> {
    await this.plugins.install(id);
  }

  @Post(':id/activate')
  @HttpCode(204)
  @RequireRight('plugin', 'update')
  async activate(@Param('id') id: string): Promise<void> {
    await this.plugins.activate(id);
  }

  @Post(':id/deactivate')
  @HttpCode(204)
  @RequireRight('plugin', 'update')
  async deactivate(@Param('id') id: string): Promise<void> {
    await this.plugins.deactivate(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireRight('plugin', 'delete')
  async uninstall(@Param('id') id: string): Promise<void> {
    await this.plugins.uninstall(id);
  }

  /**
   * Sert le bundle d'interface d'un plugin actif.
   *
   * Accessible à tout utilisateur authentifié, sans droit particulier : c'est
   * l'interface elle-même qui le charge, et refuser le fichier reviendrait à
   * masquer une fonctionnalité que l'utilisateur a par ailleurs le droit
   * d'utiliser.
   */
  @Get(':id/client.js')
  @Header('Content-Type', 'application/javascript; charset=utf-8')
  @Header('Cache-Control', 'no-cache')
  async client(@Param('id') id: string): Promise<string> {
    const statuts = await this.plugins.list();
    const statut = statuts.find((ligne) => ligne.id === id);

    if (!statut || statut.state !== 'actif') {
      throw new NotFoundException(`Aucun plugin actif nommé « ${id} ».`);
    }

    const plugin = this.registry.find(id);

    if (!plugin?.manifest.client) {
      throw new NotFoundException(`Le plugin « ${id} » n'a pas de partie interface.`);
    }

    const fichier = this.registry.resolveInside(plugin.directory, plugin.manifest.client);

    try {
      return await readFile(fichier, 'utf8');
    } catch {
      throw new NotFoundException(
        `Bundle d'interface introuvable pour « ${id} ». Le plugin est-il construit ?`,
      );
    }
  }
}
