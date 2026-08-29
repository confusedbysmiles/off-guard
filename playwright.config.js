/**
 * Playwright, covering the three surfaces.
 *
 * The suite starts its own server against a temporary database, seeded by
 * `e2e/fixture.js`, so it never touches a real one and can be run twice in a
 * row.
 *
 * Chromium runs everything: a full browser matrix would cost more to maintain
 * than it would ever catch for a private application serving one table. But the
 * table itself is phones and an iPad, so `e2e/safari.spec.js` runs in WebKit at
 * a tablet size, covering only the four browser features that could plausibly
 * differ between engines. It needs `npx playwright install webkit`; that is a
 * browser binary for the test runner, not a dependency of the application,
 * which still has none in the browser.
 */
import { defineConfig, devices } from '@playwright/test';

import { PORTS } from './e2e/world.js';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : [['list']],
  timeout: 20_000,
  expect: { timeout: 5_000 },
  use: {
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], baseURL: `http://127.0.0.1:${PORTS.desktop}` },
      testIgnore: /safari.*\.spec\.js/,
    },
    {
      name: 'tablet-webkit',
      use: {
        ...devices['iPad (gen 7) landscape'],
        baseURL: `http://127.0.0.1:${PORTS.webkit}`,
      },
      testMatch: /safari.*\.spec\.js/,
    },
  ],
  // One server per project, each on its own temporary database. See
  // `e2e/world.js` for why they cannot share one.
  webServer: Object.values(PORTS).map((port) => ({
    command: `node e2e/server.js ${port}`,
    url: `http://127.0.0.1:${port}/healthz`,
    reuseExistingServer: false,
    timeout: 20_000,
    stdout: 'pipe',
    stderr: 'pipe',
  })),
});
