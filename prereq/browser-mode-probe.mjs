import { chromium } from 'playwright'; import { JSDOM, VirtualConsole } from 'jsdom'; import { Readability } from '@mozilla/readability'; import fs from 'node:fs';
const UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36';
const vc=new VirtualConsole(); const b=await chromium.launch({channel:'chrome',headless:true}); const ctx=await b.newContext({userAgent:UA}); const p=await ctx.newPage();
const read=(html,url)=>{const a=new Readability(new JSDOM(html,{url,virtualConsole:vc}).window.document).parse();return a?(a.textContent||'').replace(/\s+/g,' ').trim():''};
// Sequoia listing
await p.goto('https://sequoiacap.com/articles/',{waitUntil:'networkidle',timeout:45000}).catch(()=>{});
const seq=[...new Set(await p.$$eval('a[href]',as=>as.map(a=>a.href).filter(h=>/sequoiacap\.com\/article\//.test(h))))];
console.log('Sequoia (browser) article links:', seq.length, seq[0]||'');
if (seq[0]) { await p.goto(seq[0],{waitUntil:'domcontentloaded'}); await p.waitForTimeout(2000); const t=read(await p.content(),p.url()); console.log('  Sequoia article chars:', t.length); if(t.length>=800) fs.writeFileSync('../fixtures/corpus/live/vc-sequoia.html', await p.content()); }
// Sifted article
const sx=await (await fetch('https://sifted.eu/feed',{headers:{'User-Agent':UA}})).text(); const sl=(sx.match(/<link>(https:\/\/sifted\.eu\/articles\/[^<]+)<\/link>/)||[])[1];
await p.goto(sl,{waitUntil:'domcontentloaded'}); await p.waitForTimeout(3000); const st=read(await p.content(),p.url());
const wall=/sign in to (continue|read)|register to (continue|read)|create a free account|subscribe to (continue|read)|already a (member|subscriber)|sifted pro/i.test(st.slice(-1500)+ (await p.content()).slice(0,0));
console.log('Sifted article (browser) chars:', st.length, '| wall phrases near end:', wall, '|', sl);
// Google News redirect resolution
const gx=await (await fetch('https://news.google.com/rss/search?q=%22Series+A%22+raises+when:7d&hl=en-US&gl=US&ceid=US:en',{headers:{'User-Agent':UA}})).text();
const links=[...gx.matchAll(/<link>(https:\/\/news\.google\.com\/rss\/articles\/[^<]+)<\/link>/g)].slice(0,3).map(m=>m[1]);
for (const l of links){ await p.goto(l,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{}); try{ await p.waitForURL(u=>!/news\.google\.com/.test(u.toString()),{timeout:15000}); }catch{} console.log('Google News link resolves (browser) to:', new URL(p.url()).host); }
await b.close();
