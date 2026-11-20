import { defineConfig } from 'vitest/config';

// MCP server tests: JSON-RPC through the HTTP handler, the stdio entry and the Vercel bundle.
export default defineConfig({
  test: {
    include: ['test-mcp/**/*.test.ts'],
    testTimeout: 60_000,
  },
});
