import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  // Les declarations sont produites par tsc, seule reference pour les types.
  // Le generateur de tsup passe par rollup-plugin-dts, qui embarque sa propre version
  // de TypeScript et derive donc de celle du projet.
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
});
