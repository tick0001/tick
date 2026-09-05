import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { loadEnv } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { EntitiesModule } from './entities/entities.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env', '../../.env'],
      validate: loadEnv,
    }),
    DatabaseModule,
    AuthModule,
    EntitiesModule,
    HealthModule,
  ],
})
export class AppModule {}
