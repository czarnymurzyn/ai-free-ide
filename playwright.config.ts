import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // The Electron app is a single shared instance across the file; running
  // files in parallel would launch several windows fighting over the same
  // user-data directory.
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
