import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

const manifeste = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  version: string;
};

/**
 * Reponse Express reduite a ce que le controleur en utilise.
 *
 * Le mock est renvoye a part plutot que lu sur l'objet : passer
 * `reponse.status` a `expect` detache la methode de son porteur, ce que la
 * regle `unbound-method` refuse a juste titre.
 */
function reponseFactice() {
  const status = vi.fn().mockReturnThis();
  const reponse = { status } as unknown as Parameters<HealthController['check']>[0];

  return { reponse, status };
}

function sonde(base: boolean, files: boolean): HealthService {
  return {
    base: vi.fn().mockResolvedValue(base),
    files: vi.fn().mockResolvedValue(files),
  } as unknown as HealthService;
}

describe('HealthController', () => {
  it('annonce la version du manifeste', async () => {
    const { reponse } = reponseFactice();

    expect((await new HealthController(sonde(true, true)).check(reponse)).version).toBe(
      manifeste.version,
    );
  });

  it("n'annonce pas 0.0.0", async () => {
    // Le defaut que ce module corrige : `npm_package_version` n'etant renseigne
    // que par un lancement via pnpm, la route repondait `0.0.0` dans toute
    // installation reelle.
    const { reponse } = reponseFactice();

    expect((await new HealthController(sonde(true, true)).check(reponse)).version).not.toBe(
      '0.0.0',
    );
  });

  it('repond 200 quand les deux dependances repondent', async () => {
    const { reponse, status } = reponseFactice();
    const sante = await new HealthController(sonde(true, true)).check(reponse);

    expect(sante.status).toBe('ok');
    expect(sante.checks).toEqual({ database: true, queues: true });
    expect(status).toHaveBeenCalledWith(200);
  });

  it('repond 503 quand la base ne repond pas', async () => {
    // Le code compte autant que le corps : c'est lui que lit la sonde de
    // l'image, et donc lui qui fait marquer le conteneur malsain.
    const { reponse, status } = reponseFactice();
    const sante = await new HealthController(sonde(false, true)).check(reponse);

    expect(sante.status).toBe('degraded');
    expect(sante.checks.database).toBe(false);
    expect(status).toHaveBeenCalledWith(503);
  });

  it('repond 503 quand Redis ne repond pas', async () => {
    const { reponse, status } = reponseFactice();
    const sante = await new HealthController(sonde(true, false)).check(reponse);

    expect(sante.status).toBe('degraded');
    expect(sante.checks.queues).toBe(false);
    expect(status).toHaveBeenCalledWith(503);
  });

  it('compte le temps depuis le demarrage', async () => {
    const { reponse } = reponseFactice();

    expect(
      (await new HealthController(sonde(true, true)).check(reponse)).uptimeSeconds,
    ).toBeGreaterThanOrEqual(0);
  });
});
