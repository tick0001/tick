import 'reflect-metadata';
import { Logger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';
import { loadEnv, loadEnvFiles } from './config/env.js';

async function bootstrap(): Promise<void> {
  loadEnvFiles();
  const env = loadEnv();
  // Les niveaux sont cumulatifs et ordonnes du plus grave au plus bavard :
  // choisir `debug` conserve `log`, `warn` et `error`.
  const NIVEAUX: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  const actifs = NIVEAUX.slice(0, NIVEAUX.indexOf(env.LOG_LEVEL) + 1);

  const app = await NestFactory.create(AppModule, { logger: actifs });

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: env.WEB_URL, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  new Logger('Amorcage').log(`API demarree sur ${env.API_URL}/api`);
}

void bootstrap();
