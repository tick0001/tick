import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PluginsModule } from '../plugins/plugins.module.js';
import { EntitiesController } from './entities.controller.js';
import { EntitiesService } from './entities.service.js';

@Module({
  imports: [AuthModule, PluginsModule],
  controllers: [EntitiesController],
  providers: [EntitiesService],
  exports: [EntitiesService],
})
export class EntitiesModule {}
