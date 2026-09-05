import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EventBus } from './event-bus.service.js';
import { HookBus } from './hook-bus.service.js';
import { PluginMigrator } from './plugin-migrator.service.js';
import { PluginRegistry } from './plugin-registry.service.js';
import { PluginsController } from './plugins.controller.js';
import { PluginsService } from './plugins.service.js';

/**
 * Substrat d'extension.
 *
 * Les bus sont exportes pour que les modules metier puissent declencher des
 * hooks et signaler des evenements. Le module ne connait aucun domaine : c'est
 * l'inverse qui est vrai, et c'est ce qui permettra d'etendre le ticket au
 * jalon suivant sans revenir ici.
 */
@Module({
  imports: [AuthModule],
  controllers: [PluginsController],
  providers: [PluginRegistry, PluginMigrator, HookBus, EventBus, PluginsService],
  exports: [HookBus, EventBus, PluginsService],
})
export class PluginsModule {}
