import { defineConfig } from 'vitest/config';
import { couverture } from '../../vitest.shared.mts';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: couverture,
  },
});
