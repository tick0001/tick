import { defineConfig } from 'tsup';

export default defineConfig({
  // `migrate` est une seconde entree, et non un script lance par `tsx` : en
  // production l'image n'embarque pas TypeScript, et les migrations doivent
  // pouvoir se jouer avec le seul Node. Le dossier `drizzle` se resout depuis
  // `dist/`, ou `files` le place aussi.
  entry: ['src/index.ts', 'src/migrate.ts'],
  format: ['esm', 'cjs'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'es2023',
});
