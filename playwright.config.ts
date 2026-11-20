import { defineConfig, devices } from '@playwright/test';

// Live site by default. Set E2E_URL to test another build, e.g. a local `vite preview`:
//   npm run build; $env:E2E_URL="http://localhost:4173"; npm run test:e2e
const LIVE = 'https://bkk-feasibility.vercel.app';
const url = process.env.E2E_URL || LIVE;
const local = /localhost|127\.0\.0\.1/.test(url);

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/.results',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: true,
  workers: 3,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: url,
    trace: 'off',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    // WebGL in headless Chromium
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: local
    ? { command: `npx vite preview --port ${new URL(url).port || 4173} --strictPort`, url, reuseExistingServer: true, timeout: 60_000 }
    : undefined,
});
