import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Controller, Get } from '@nestjs/common';
import type { Health } from '@tick/contracts';

/**
 * Version du produit, lue dans le manifeste.
 *
 * Elle venait de `npm_package_version`, que npm et pnpm ne renseignent que
 * lorsqu'ils lancent eux-memes le processus. Or rien ne le fait en production :
 * l'image comme les installations nues demarrent `node dist/main.js`
 * directement. La route annoncait donc `0.0.0` partout ou elle sert — c'est-a-dire
 * partout ou l'on cherche a savoir quelle version tourne.
 *
 * Le chemin vaut dans les deux dispositions, puisque le manifeste est deux
 * niveaux au-dessus du controleur compile dans l'une comme dans l'autre :
 * `apps/api/dist/health/` en developpement, et `<racine>/dist/health/` dans
 * l'arborescence produite par `pnpm deploy`.
 */
function lireVersion(): string {
  try {
    const manifeste = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8');
    return (JSON.parse(manifeste) as { version?: string }).version ?? '0.0.0';
  } catch {
    // Un manifeste absent ou illisible n'est pas une raison de refuser de
    // demarrer : la version est une information, pas une condition de service.
    return '0.0.0';
  }
}

/** Lue une fois : le manifeste ne change pas sous un processus en cours. */
const VERSION = lireVersion();

@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  @Get()
  check(): Health {
    return {
      status: 'ok',
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
    };
  }
}
