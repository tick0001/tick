import { defineConfig } from 'vitest/config';
import { BaseSequencer } from 'vitest/node';
import { couverture } from '../../vitest.shared.mts';

/**
 * L'amorcage passe en premier.
 *
 * `seed.ts` tronque les tables avant d'ecrire : le lancer au milieu de la suite
 * effacerait les donnees que les autres fichiers viennent de creer. En le
 * placant en tete -- et en interdisant l'execution simultanee des fichiers --
 * la suite entiere devient rejouable depuis une base vierge, au lieu de
 * supposer un `pnpm db:seed` lance a la main.
 */
class AmorcageDAbord extends BaseSequencer {
  override async sort(fichiers: Parameters<BaseSequencer['sort']>[0]) {
    const tries = await super.sort(fichiers);

    return tries.sort(
      (a, b) => Number(b.moduleId.includes('seed.test')) - Number(a.moduleId.includes('seed.test')),
    );
  }
}

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./vitest.setup.mts'],
    // Les tests partagent une seule base : les executer en parallele les ferait
    // se marcher dessus, et l'amorcage tronquerait les tables des autres.
    fileParallelism: false,
    sequence: { sequencer: AmorcageDAbord },
    // Les tests d'integration ouvrent de vraies connexions PostgreSQL.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    coverage: couverture,
  },
});
