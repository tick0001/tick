import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    setupFiles: ['./vitest.setup.mts'],
    // Les tests d'integration ouvrent de vraies connexions PostgreSQL.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
