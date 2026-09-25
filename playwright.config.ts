import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
  webServer: [
    {
      command: 'node_modules/.bin/tsx apps/api/src/server.ts',
      url: 'http://127.0.0.1:3001/health',
      env: { AI_PROVIDER: 'demo', DATABASE_URL: 'pglite:memory', PORT: '3001' },
      reuseExistingServer: false,
      timeout: 30000,
    },
    {
      command:
        'node_modules/.bin/vite --config apps/web/vite.config.ts apps/web --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
