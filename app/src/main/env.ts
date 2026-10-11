// Runtime switches (RFC §1B.2). Only the RW_* names listed there are read by app code.
import os from 'node:os'
import path from 'node:path'

export const TEST_MODE = process.env.RW_TEST_MODE === '1'
export const NO_JITTER = process.env.RW_NO_JITTER === '1' || TEST_MODE
export const DATA_DIR = process.env.RW_DATA_DIR || path.join(os.homedir(), 'Library', 'Application Support', 'Research Workspace')
export const FIXTURE_BASE = process.env.RW_FIXTURE_BASE || 'http://127.0.0.1:4700'
/** Test mode: where *.test hosts actually live (a parallel test worker's own fixture server); URLs still say :4700. */
export const FIXTURE_HOST_RULE = TEST_MODE ? `MAP *.test 127.0.0.1${process.env.RW_FIXTURE_PORT ? ':' + process.env.RW_FIXTURE_PORT : ''}` : ''
export const LLM_CACHE = process.env.RW_LLM_CACHE === 'rw' ? 'rw' : 'off'
/** Test mode only: one response cache shared by every test app (fixture tests replay recorded answers — TestPlan.md,
 *  DEC-098); otherwise the cache, when on, lives in the data dir. */
export const LLM_CACHE_DIR = TEST_MODE ? process.env.RW_LLM_CACHE_DIR : undefined
export const TEST_NOW = TEST_MODE ? process.env.RW_TEST_NOW : undefined
export const FAULTS_ENV = TEST_MODE ? process.env.RW_FAULTS || '' : ''
/** Test mode only: search the real web (Google News) instead of the fixture search host — real-data suites (DEC-087). */
export const REAL_SEARCH = TEST_MODE && process.env.RW_REAL_SEARCH === '1'
export const STARTER_PACK_OVERRIDE = TEST_MODE ? process.env.RW_STARTER_PACK_OVERRIDE : undefined
export const BRIDGE_PROFILE_DIR = TEST_MODE ? process.env.RW_BRIDGE_PROFILE_DIR : undefined
export const BRIDGE_MOCK_KEYCHAIN = TEST_MODE && process.env.RW_BRIDGE_MOCK_KEYCHAIN === '1'
/** Test mode only: windows are created hidden and the Dock icon is hidden, so test runs don't take over the screen;
 *  Playwright drives hidden windows through the debugging protocol (RW_HEADED=1 in the harness shows them). */
export const HEADLESS = TEST_MODE && process.env.RW_HEADLESS === '1'
