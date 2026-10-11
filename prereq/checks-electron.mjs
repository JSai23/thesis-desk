import { _electron as electron } from 'playwright';
const out = {};
for (const run of [1, 2]) {
  const app = await electron.launch({ args: ['electron-probe'], env: { ...process.env, NODE_PATH: process.cwd() + '/node_modules' } });
  const w = await app.firstWindow(); await w.waitForSelector('h1');
  await w.getByRole('button', { name: 'Go' }).click();
  const status = await w.getByRole('status').textContent();
  const shot = await w.screenshot(); const r = await w.evaluate(() => window.probe.results());
  out[`run${run}`] = { status, shotBytes: shot.length, ...r }; await app.close();
}
console.log(JSON.stringify(out, null, 1));
