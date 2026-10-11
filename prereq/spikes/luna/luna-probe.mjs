import fs from 'node:fs'; import os from 'node:os';
const auth = JSON.parse(fs.readFileSync(os.homedir()+'/.codex/auth.json','utf8'));
const tok = auth.tokens.access_token, acct = auth.tokens.account_id;
const URL_ = 'https://chatgpt.com/backend-api/codex/responses';
async function call(label, body){
  const t0=Date.now();
  const r = await fetch(URL_, {method:'POST', headers:{'Authorization':'Bearer '+tok,'chatgpt-account-id':acct,'originator':'codex_cli_rs','Content-Type':'application/json','Accept':'text/event-stream'}, body: JSON.stringify(body)});
  const txt = await r.text();
  let out='', usage=null, err=null;
  for (const line of txt.split('\n')) { if(!line.startsWith('data:')) continue; const d=line.slice(5).trim(); if(d==='[DONE]') continue;
    try{ const e=JSON.parse(d); if(e.type==='response.output_text.delta') out+=e.delta; if(e.type==='response.completed') usage=e.response?.usage; if(e.type==='error'||e.type==='response.failed') err=JSON.stringify(e).slice(0,300);}catch{} }
  console.log(`[${label}] HTTP ${r.status} ${Date.now()-t0}ms`, r.status>=400? txt.slice(0,300):'', '| out:', out.slice(0,200), '| usage:', usage?JSON.stringify({in:usage.input_tokens,out:usage.output_tokens,reason:usage.output_tokens_details?.reasoning_tokens}):'', err||'');
  return {status:r.status,out};
}
const base = {model:'gpt-6-luna', store:false, stream:true, instructions:'You are a precise assistant.', reasoning:{effort:'low'}};
await call('text', {...base, input:[{role:'user',content:[{type:'input_text',text:'Reply with exactly: LUNA-OK'}]}]});
const r2 = await call('json_schema', {...base, input:[{role:'user',content:[{type:'input_text',text:'Extract: "Lumen Legal raised an $18 million Series A led by Northwind Ventures."'}]}],
  text:{format:{type:'json_schema', name:'funding', strict:true, schema:{type:'object',additionalProperties:false,required:['company','amountUsd','lead'],properties:{company:{type:'string'},amountUsd:{type:'number'},lead:{type:'string'}}}}}});
try{ console.log('parsed:', JSON.parse(r2.out)); }catch(e){ console.log('json parse failed'); }
await call('effort-none', {...base, reasoning:{effort:'none'}, input:[{role:'user',content:[{type:'input_text',text:'Say hi'}]}]});
