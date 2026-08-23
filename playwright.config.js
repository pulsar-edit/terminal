// @ts-check
const { defineConfig } = require('@playwright/test');

// These are full end-to-end tests: a real installed Pulsar binary, loaded
// with this checkout as a dev-mode package, driving a real login shell
// through a real terminal. See `e2e/helpers.js` for how the app gets
// launched, and the plan behind this suite for why it's split out from the
// fast headless `pulsar --test spec/` suite (real GUI/shell startup cost,
// run on a schedule + path-filtered rather than every push).
module.exports = defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000
  },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['junit', { outputFile: 'report.xml' }]] : 'list',
  use: {
    video: process.env.CI ? 'retain-on-failure' : 'off'
  }
});
