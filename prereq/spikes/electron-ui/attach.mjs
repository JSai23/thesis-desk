import { chromium } from 'playwright';
const b = await chromium.connectOverCDP('http://127.0.0.1:9350');
const page = b.contexts()[0].pages()[0];
await page.getByRole('textbox',{name:'Thought'}).fill('attached via CDP');
await page.getByRole('button',{name:'Save thought'}).click();
console.log('[attach]', await page.getByRole('status').textContent());
await b.close();
