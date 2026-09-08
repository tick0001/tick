import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.js';

const manifeste = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as {
  version: string;
};

describe('HealthController', () => {
  it('annonce la version du manifeste', () => {
    expect(new HealthController().check().version).toBe(manifeste.version);
  });

  it("n'annonce pas 0.0.0", () => {
    // Le defaut que ce module corrige : `npm_package_version` n'etant renseigne
    // que par un lancement via pnpm, la route repondait `0.0.0` dans toute
    // installation reelle. Ce test echoue si la lecture du manifeste se casse,
    // ou si quelqu'un oublie de porter le numero de version avant d'etiqueter.
    expect(new HealthController().check().version).not.toBe('0.0.0');
  });

  it('compte le temps depuis le demarrage', () => {
    expect(new HealthController().check().uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
