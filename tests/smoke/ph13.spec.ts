// SMK-13 (RFC PH-13): build the dmg, mount it, copy the .app to a temp folder and launch the packaged app with a fresh
// data dir, no ChatGPT sign-in (empty RW_CODEX_HOME) and no Gmail account → app.status ok, Today empty state, M14 banner.
import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { launch, tempDir, ROOT } from '../harness/app'

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const DMG = path.join(ROOT, `app/dist/Research Workspace-${pkg.version}-arm64.dmg`)

test('SMK-13 PH-13 packaged app', async () => {
  if (process.env.SMK13_SKIP_DIST !== '1' || !fs.existsSync(DMG)) execFileSync('npm', ['run', 'dist'], { cwd: ROOT, stdio: 'ignore', timeout: 15 * 60_000 })
  expect(fs.existsSync(DMG)).toBe(true)
  const mnt = tempDir('rw-dmg-')
  execFileSync('hdiutil', ['attach', DMG, '-nobrowse', '-readonly', '-mountpoint', mnt])
  const dest = tempDir('rw-app-')
  try {
    execFileSync('cp', ['-R', path.join(mnt, 'Research Workspace.app'), dest])
  } finally { execFileSync('hdiutil', ['detach', mnt, '-force']) }
  const exe = path.join(dest, 'Research Workspace.app/Contents/MacOS/Research Workspace')
  expect(fs.existsSync(exe)).toBe(true)

  const rw = await launch({ executablePath: exe, codexHome: tempDir('rw-codex-empty-') })
  const st = await rw.invoke('app.status', {})
  expect(st.versions.app).toBe(pkg.version)
  expect((await rw.invoke('ai.status', {})).status).not.toBe('ok')
  const page = rw.page
  await expect(page.getByRole('button', { name: 'Add a source' })).toBeVisible()
  await expect(page.getByText('Sign in to ChatGPT with Codex to organize what comes in')).toBeVisible()
  await rw.close()
  fs.rmSync(dest, { recursive: true, force: true })
})
