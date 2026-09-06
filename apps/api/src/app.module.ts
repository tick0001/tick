import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { loadEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { EntitiesModule } from './entities/entities.module.js';
import { FormsModule } from './forms/forms.module.js';
import { HealthModule } from './health/health.module.js';
import { ItilModule } from './itil/itil.module.js';
import { KnowledgeModule } from './knowledge/knowledge.module.js';
import { MailModule } from './mail/mail.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PluginsModule } from './plugins/plugins.module.js';
import { RulesModule } from './rules/rules.module.js';
import { SatisfactionModule } from './satisfaction/satisfaction.module.js';
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
    ItilModule,
    SearchModule,
    NotificationsModule,
    DocumentsModule,
    MailModule,
    KnowledgeModule,
    FormsModule,
    SatisfactionModule,
    HealthModule,
  ],
})
export class AppModule {}
