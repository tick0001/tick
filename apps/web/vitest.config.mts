import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { couverture } from '../../vitest.shared.mts';

/**
 * Tests de l'interface.
 *
 * Environnement DOM : les composants se testent en les rendant, pas en
 * inspectant leur arbre React. Un test qui verifie ce que l'utilisateur voit
 * survit a une refonte interne ; un test qui verifie la structure des composants
 * casse a chaque retouche sans rien avoir attrape.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: couverture,
  },
});
