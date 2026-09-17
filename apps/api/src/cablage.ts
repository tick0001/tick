import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import { DatabaseExceptionFilter } from './common/database-exception.filter.js';
import { exigerUtf8 } from './common/corps-utf8.js';
import { loadEnv } from './config/env.js';

/** `TRUST_PROXY` tel qu'Express l'attend. */
export function relaisDeConfiance(valeur: string): boolean | number | string {
  if (valeur === 'true') return true;
  if (valeur === 'false' || valeur === '') return false;
  if (/^\d+$/.test(valeur)) return Number(valeur);

  return valeur;
}

/**
 * Le câblage HTTP de l'application, commun au serveur et aux tests.
 *
 * Il vivait en double, dans `main.ts` et dans le harnais des tests HTTP : un
 * réglage ajouté d'un côté seulement aurait fait passer des tests sur une
 * application qui n'existe pas.
 *
 * L'application doit être créée avec `bodyParser: false` : les analyseurs sont
 * posés ici, avec le contrôle d'encodage que ceux par défaut n'ont pas. Ce sont
 * ceux d'Express, mêmes réglages que ceux de Nest, parce que Nest ne laisse pas
 * passer d'option `verify`.
 */
export function cablerApplication(app: NestExpressApplication): void {
  app.set('trust proxy', relaisDeConfiance(loadEnv().TRUST_PROXY));
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use(json({ verify: exigerUtf8 }));
  app.use(urlencoded({ extended: true, verify: exigerUtf8 }));
  app.useGlobalFilters(new DatabaseExceptionFilter(app.getHttpAdapter()));
  app.enableShutdownHooks();
}
