// Records the README's demo clips headlessly: the built app on the bundled demo library (test.seedDemo — the design
// prototype's data: no model calls, no network), driven with a drawn cursor, each flow encoded as a GIF in pure JS.
// Launched through the test harness, so it is headless like every test run (DEC-097).
//   npm run demo:record            → docs/media/hero.png + docs/media/{today,theses,companies,search,reports}.gif
import { test } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { PNG } from 'pngjs'
// @ts-ignore — gifenc ships no types
import * as gifencModule from 'gifenc'
import { launch, reloadApp, ROOT } from '../harness/app'

// its CommonJS build exposes the functions either on the module or on .default, depending on the loader
const gifenc: any = (gifencModule as any).GIFEncoder ? gifencModule : (gifencModule as any).default
const { GIFEncoder, quantize, applyPalette } = gifenc
const OUT = path.join(ROOT, 'docs/media')
const W = 1440, H = 900 // window content size (CSS px)
const GIF_W = 960 // clips are scaled down to this width

// ---------------------------------------------------------------- frames → GIF
function scale(png: any, w: number) {
  const h = Math.round(png.height * w / png.width)
  const out = new Uint8ClampedArray(w * h * 4)
  const fx = png.width / w, fy = png.height / h
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    // box filter over the source pixels this output pixel covers
    const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx))
    const y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy))
    let r = 0, g = 0, b = 0, n = 0
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      const i = (sy * png.width + sx) * 4
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n++
    }
    const o = (y * w + x) * 4
    out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255
  }
  return { data: out, width: w, height: h }
}

class Clip {
  frames: { img: { data: Uint8ClampedArray; width: number; height: number }; delay: number }[] = []
  name: string
  constructor(name: string) { this.name = name }
  async snap(page: any, delay = 80) {
    const png = PNG.sync.read(await page.screenshot({ scale: 'css', type: 'png' }))
    this.frames.push({ img: scale(png, GIF_W), delay })
  }
  hold(ms: number) { if (this.frames.length) this.frames[this.frames.length - 1].delay += ms }
  save() {
    const gif = GIFEncoder()
    for (const f of this.frames) {
      const palette = quantize(f.img.data, 256)
      gif.writeFrame(applyPalette(f.img.data, palette), f.img.width, f.img.height, { palette, delay: f.delay })
    }
    gif.finish()
    const file = path.join(OUT, `${this.name}.gif`)
    fs.writeFileSync(file, gif.bytes())
    console.log(`  ${path.relative(ROOT, file)} · ${this.frames.length} frames · ${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} MB`)
  }
}

// ---------------------------------------------------------------- a drawn cursor (screenshots don't show the real one)
const CURSOR = `(() => {
  if (document.getElementById('demo-cursor')) return
  const c = document.createElement('div'); c.id = 'demo-cursor'
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-7 1-4 7z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/></svg>'
  Object.assign(c.style, { position: 'fixed', left: '720px', top: '450px', zIndex: 2147483647, pointerEvents: 'none', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.5))' })
  document.body.appendChild(c)
})()`
let cur = { x: 720, y: 450 }
const place = (page: any, x: number, y: number) => page.evaluate(([x, y]: number[]) => { const c = document.getElementById('demo-cursor'); if (c) { c.style.left = x + 'px'; c.style.top = y + 'px' } }, [x, y])

async function moveTo(page: any, clip: Clip, target: any, steps = 7) {
  await page.evaluate(CURSOR)
  const box = await target.boundingBox()
  if (!box) throw new Error('target not visible')
  const to = { x: box.x + Math.min(box.width / 2, 60), y: box.y + box.height / 2 }
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2 // ease in-out
    await place(page, cur.x + (to.x - cur.x) * e, cur.y + (to.y - cur.y) * e)
    await clip.snap(page, 40)
  }
  cur = to
}
async function click(page: any, clip: Clip, target: any, after = 900) {
  await moveTo(page, clip, target)
  await target.click()
  await page.waitForTimeout(350)
  await page.evaluate(CURSOR); await place(page, cur.x, cur.y)
  await clip.snap(page, after)
}
async function type(page: any, clip: Clip, text: string) {
  for (const ch of text) { await page.keyboard.type(ch); await page.waitForTimeout(60); await clip.snap(page, 90) }
}

// ---------------------------------------------------------------- the flows
const nav = (page: any) => (label: string) => page.locator('aside').getByText(label, { exact: true }).first()
const CLIPS = {
  async today(page: any, c: Clip) {
    await click(page, c, nav(page)('Today'), 1400)
    await click(page, c, page.getByText('Harvey expands into Germany', { exact: true }).first(), 2600)
    await click(page, c, page.getByText(/^Review/).first(), 2200)
  },
  async theses(page: any, c: Clip) {
    await click(page, c, nav(page)('Theses'), 1400)
    await click(page, c, page.getByText('AI replacing outsourced services labor', { exact: true }).first(), 2400)
    await click(page, c, page.getByText('Evolution', { exact: true }).first(), 2400)
  },
  async companies(page: any, c: Clip) {
    await click(page, c, nav(page)('Companies'), 1200)
    await click(page, c, page.getByText('Harvey', { exact: true }).first(), 2600)
    await click(page, c, nav(page)('Venture Firms'), 900)
    await click(page, c, page.getByText('Benchmark', { exact: true }).first(), 2400)
  },
  async search(page: any, c: Clip) {
    await click(page, c, nav(page)('Today'), 900)
    await page.keyboard.press('Meta+k'); await page.waitForTimeout(300); await c.snap(page, 700)
    await type(page, c, 'Harvey')
    c.hold(2600)
  },
  async reports(page: any, c: Clip) {
    await click(page, c, nav(page)('Sources'), 900)
    await click(page, c, page.getByText('Stratechery', { exact: true }).first(), 2000)
    await click(page, c, nav(page)('Reports'), 2800)
  }
}

// ---------------------------------------------------------------- run
test('record the README demo clips', async () => {
  test.setTimeout(10 * 60_000)
  fs.mkdirSync(OUT, { recursive: true })
  const rw = await launch()
  try {
    const page = rw.page
    await rw.invoke('test.seedDemo')
    await rw.invoke('settings.update', { patch: { 'appearance.theme': 'dark', 'banners.dismissed': ['open_at_login'] } })
    await rw.app.evaluate(({ BrowserWindow }, [w, h]) => { const win = BrowserWindow.getAllWindows().find(x => !x.isDestroyed() && (x as any).__rwMain) || BrowserWindow.getAllWindows()[0]; win.setContentSize(w, h) }, [W, H])
    await reloadApp(page); await page.waitForTimeout(1500)
    // hero still: Today with an item open in the reader
    await nav(page)('Today').click(); await page.getByText('Harvey expands into Germany', { exact: true }).first().click(); await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(OUT, 'hero.png'), scale: 'css' })
    const want = (process.env.DEMO_CLIPS || '').split(',').filter(Boolean)
    for (const name of want.length ? want : Object.keys(CLIPS)) {
      const clip = new Clip(name)
      await (CLIPS as any)[name](page, clip)
      clip.save()
      await page.keyboard.press('Escape').catch(() => {})
    }
  } finally { await rw.close() }
})
