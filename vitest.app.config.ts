import { defineConfig } from 'vitest/config';

// App tests (site detection, UI helpers). The engine suite keeps its own config.
export default defineConfig({
  test: {
    include: ['test-app/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
