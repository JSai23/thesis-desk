import { defineConfig } from '@playwright/test'
import path from 'node:path'

const runId = process.env.RW_RUN_ID || new Date().toISOString().replace(/[:.]/g, '-')
process.env.RW_RUN_ID = runId
process.env.RW_RUN_STARTED ||= String(Date.now()) // workers inherit it (shared prepared libraries, one results dir)
const out = path.join(__dirname, 'results', runId)

export default defineConfig({
  testDir: __dirname,
  // RW_WORKERS > 1: files run in parallel (each its own app, data dir and fixture server — RW_FIXTURE_PORT_BASE)
  workers: Number(process.env.RW_WORKERS || 1),
  fullyParallel: false,
  timeout: 20 * 60_000,
  // a run never stalls forever on a leaked app or a stuck worker: the whole invocation stops after 4 h
  globalTimeout: 4 * 3600_000,
  expect: { timeout: 30_000 },
  // a stuck click/hover fails at that step after 2 min instead of silently using the whole test budget
  use: { actionTimeout: 120_000, navigationTimeout: 90_000 },
  retries: 0,
  outputDir: path.join(out, 'artifacts'),
  reporter: [['list'], ['json', { outputFile: path.join(out, `${process.env.RW_SUITE || 'suite'}.json`) }]],
  projects: [
    { name: 'smoke', testMatch: /smoke\/.*\.spec\.ts$/ },
    { name: 'e2e-backend', testMatch: /e2e-backend\/.*\.spec\.ts$/ },
    { name: 'e2e-product', testMatch: /e2e-product\/.*\.spec\.ts$/ },
    { name: 'live', testMatch: /live\/.*\.spec\.ts$/ },
    { name: 'realdata', testMatch: /realdata\/(sources|hydrate|hydrate-firms|briefs|briefings|briefings-ui|ui-fixes|extraction|ontology|story-reports|tiers|lookup|describe)\.spec\.ts$/ },
    { name: 'realdata-quality', testMatch: /realdata\/quality\.spec\.ts$/ },
    { name: 'scratch', testMatch: /scratch\/.*\.spec\.ts$/ },
    // README demo clips (npm run demo:record) — not part of any suite
    { name: 'demo', testMatch: /demo\/.*\.spec\.ts$/ }
  ]
})
