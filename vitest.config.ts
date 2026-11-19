import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 120_000,
    // files run one at a time so the timing test is not measured under the property tests' load
    fileParallelism: false,
  },
});
