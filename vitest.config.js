/**
 * Vitest covers the rules engine, the server and the browser modules that can
 * run in Node. The end-to-end suite is Playwright's and is excluded here, so
 * `npm test` stays fast and needs no browser.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    exclude: ['e2e/**', 'node_modules/**', '.cache/**'],
  },
});
