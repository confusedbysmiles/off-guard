/**
 * Playwright, covering the three surfaces.
 *
 * The suite starts its own server against a temporary database, seeded by
 * `e2e/fixture.js`, so it never touches a real one and can be run twice in a
 * row. Chromium only: this is a private application for one table, and a matrix
 * of browsers would cost more to maintain than it would ever catch.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.OFF_GUARD_E2E_PORT ?? 8799);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : [['list']],
  timeout: 20_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `node e2e/server.js ${PORT}`,
    url: `http://127.0.0.1:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
