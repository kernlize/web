import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { quickpickle } from 'quickpickle';

const pkg = (name: string, file = 'index.ts') => resolve(import.meta.dirname, 'packages', name, 'src', file);

export default defineConfig({
  plugins: [quickpickle({ stepTimeout: 5000 })],
  resolve: {
    alias: {
      '@kernl/guard': pkg('guard'),
      '@kernl/messaging': pkg('messaging'),
      '@kernl/bridges': pkg('bridges'),
      '@kernl/core': pkg('core'),
    },
  },
  test: {
    environment: 'node',
    include: ['packages/*/features/**/*.feature', 'packages/*/src/**/*.test.ts', 'features/**/*.feature', 'apps/web/features/**/*.feature', 'apps/web/src/shell/**/*.test.ts', 'scripts/**/*.test.mjs'],
    setupFiles: ['./features/support/steps.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'apps/web/src/shell/**/*.ts'],
      // Rune stores (`*.svelte.ts`) and Svelte components only run under the Svelte compiler; tests/e2e covers them in Playwright.
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/types.ts', 'packages/*/src/**/*.d.ts', 'apps/web/src/shell/**/*.test.ts', 'apps/web/src/shell/**/*.svelte.ts'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
