import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:7860',
    headless: true,
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'cd .. && go run ./cmd/server',
    url: 'http://localhost:7860',
    timeout: 30_000,
    reuseExistingServer: true,
    env: {
      DATA_DIR: '/tmp/floodtest-e2e',
    },
  },
})
