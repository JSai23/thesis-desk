import { _electron as electron } from 'playwright';
const mode = process.argv[2];
const opts = mode === 'packaged'
  ? { executablePath: process.argv[3] }
  : { args: ['.'] };
const app = await electron.launch(opts);
const win = await app.firstWindow();
await win.waitForSelector('h1');
console.log(`[${mode}] title:`, await win.title());
// operate purely through UI (accessibility roles/labels)
await win.getByRole('textbox', { name: 'Thought' }).fill('Legal AI buyers run two vendors');
await win.getByRole('button', { name: 'Save thought' }).click();
console.log(`[${mode}] status:`, await win.getByRole('status').textContent());
// accessibility snapshot an agent can read
console.log(`[${mode}] aria:\n` + (await win.locator('body').ariaSnapshot()));
// same boundary the UI uses (backend black-box call)
console.log(`[${mode}] ipc:`, JSON.stringify(await win.evaluate(() => window.rw.invoke('counter.inc'))));
// main-process access
console.log(`[${mode}] main isPackaged:`, await app.evaluate(({ app }) => app.isPackaged));
await win.screenshot({ path: `shot-${mode}.png` });
await app.close();
