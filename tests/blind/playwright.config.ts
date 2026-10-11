// Playwright config for the blind-evaluation setup step only (tests/blind/setup.spec.ts, invoked by run.mjs).
import { defineConfig } from '@playwright/test'
import path from 'node:path'

export default defineConfig({
  testDir: __dirname,
  testMatch: /setup\.spec\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 120 * 60_000,
  expect: { timeout: 30_000 },
  outputDir: path.join(process.env.BLIND_SETUP_DIR || path.join(__dirname, 'runs', 'setup'), 'pw-artifacts'),
  reporter: [['list']]
})
