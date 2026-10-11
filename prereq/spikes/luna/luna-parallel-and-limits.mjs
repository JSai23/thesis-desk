import fs from 'node:fs'; import os from 'node:os';
const a=JSON.parse(fs.readFileSync(os.homedir()+'/.codex/auth.json','utf8'));
const H={'Authorization':'Bearer '+a.tokens.access_token,'chatgpt-account-id':a.tokens.account_id,'originator':'codex_cli_rs','Content-Type':'application/json'};
const body=(t)=>JSON.stringify({model:'gpt-6-luna',store:false,stream:true,instructions:'Be brief.',reasoning:{effort:'none'},input:[{role:'user',content:[{type:'input_text',text:t}]}]});
const go=async(t)=>{const r=await fetch('https://chatgpt.com/backend-api/codex/responses',{method:'POST',headers:H,body:body(t)});const x=await r.text();const m=x.match(/"input_tokens":(\d+)/);return [r.status,m?+m[1]:null, [...r.headers].filter(([k])=>/ratelimit|x-codex/i.test(k)).map(([k,v])=>k+'='+v).join(' ')]};
let t0=Date.now(); const rs=await Promise.all([...Array(8)].map((_,i)=>go('Reply with the number '+i)));
console.log('8 parallel:', rs.map(r=>r[0]).join(','), (Date.now()-t0)+'ms'); console.log('limit headers:', rs[0][2].slice(0,400));
const big=('The quick brown fox jumps over the lazy dog. ').repeat(5500)+' Reply OK.';
t0=Date.now(); const b=await go(big); console.log('large input:', b[0], 'input_tokens', b[1], (Date.now()-t0)+'ms');
