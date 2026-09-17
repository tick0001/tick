import 'reflect-metadata';
import { Logger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { cablerApplication } from './cablage.js';
import { loadEnv, loadEnvFiles } from './config/env.js';

async function bootstrap(): Promise<void> {
  loadEnvFiles();
  const env = loadEnv();
  // Les niveaux sont cumulatifs et ordonnes du plus grave au plus bavard :
  // choisir `debug` conserve `log`, `warn` et `error`.
  const NIVEAUX: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];
  const actifs = NIVEAUX.slice(0, NIVEAUX.indexOf(env.LOG_LEVEL) + 1);

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: actifs,
    bodyParser: false,
  });

  cablerApplication(app);
  app.enableCors({ origin: env.WEB_URL, credentials: true });

  await app.listen(env.API_PORT);
  new Logger('Amorcage').log(`API demarree sur ${env.API_URL}/api`);
}

void bootstrap();
