import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 120_000, // mongodb-memory-server first-run download
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup-env.ts'],
    fileParallelism: false,
  },
});
