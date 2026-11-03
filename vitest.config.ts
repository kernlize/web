import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { quickpickle } from 'quickpickle';

const pkg = (name: string, file = 'index.ts') => resolve(__dirname, 'packages', name, 'src', file);

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
    include: ['packages/*/features/**/*.feature', 'packages/*/src/**/*.test.ts', 'features/**/*.feature', 'scripts/**/*.test.mjs'],
    setupFiles: ['./features/support/steps.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/types.ts', 'packages/*/src/**/*.d.ts'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
      reporter: ['text-summary', 'json-summary'],
    },
  },
});
