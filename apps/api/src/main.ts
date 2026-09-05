import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { loadEnv, loadEnvFiles } from './config/env.js';

async function bootstrap(): Promise<void> {
  loadEnvFiles();
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_URL, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  new Logger('Amorcage').log(`API demarree sur ${env.API_URL}/api`);
}

void bootstrap();
