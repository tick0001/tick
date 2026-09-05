import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { loadEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { EntitiesModule } from './entities/entities.module.js';
import { HealthModule } from './health/health.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PluginsModule } from './plugins/plugins.module.js';
import { RulesModule } from './rules/rules.module.js';
import { SearchModule } from './search/search.module.js';
import { SlmModule } from './slm/slm.module.js';
import { TicketsModule } from './tickets/tickets.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validate: loadEnv,
    }),
    CommonModule,
    DatabaseModule,
    AuthModule,
    PluginsModule,
    EntitiesModule,
    RulesModule,
    SlmModule,
    TicketsModule,
    SearchModule,
    NotificationsModule,
    DocumentsModule,
    HealthModule,
  ],
})
export class AppModule {}
