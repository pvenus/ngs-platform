import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {browserRequestId} from '../build/browser-request-id.mjs';
import {sha256Hex} from '../build/browser-sha256.mjs';

test('LAN HTTP uses strong random bytes and the exact native SHA-256 result',async()=>{
 const id=browserRequestId({getRandomValues:bytes=>bytes.fill(0xa5)});
 assert.equal(id,'a5a5a5a5-a5a5-45a5-a5a5-a5a5a5a5a5a5');
 assert.equal(new Set(Array.from({length:128},()=>browserRequestId())).size,128);
 for(const size of [0,1,55,56,63,64,65,119,120,127,128,129,1024,100000]){
  const sample=randomBytes(size+6).subarray(3,size+3);
  assert.equal(await sha256Hex(sample,null),createHash('sha256').update(sample).digest('hex'));
 }
});
test('assembly + opens and accepts a request in a real LAN HTTP browser',{skip:!process.env.CHROME_BIN||!process.env.NGS_LAN_TEST_HOST},async t=>{
 const ip=process.env.NGS_LAN_TEST_HOST;
 assert.match(ip,/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u);
 const profile=await mkdtemp(join(tmpdir(),'ngs-http-browser-'));t.after(()=>rm(profile,{recursive:true,force:true}));
 const html=`<!doctype html><meta charset="utf-8"><div id="tools"></div><aside><ul id="items"></ul></aside><main id="detail"></main><p id="result">running</p>
 <script type="module">
 import {mountAssemblyCatalog} from '/assembly-catalog-ui.mjs';
 import {sha256Hex} from '/browser-sha256.mjs';
 const result=document.getElementById('result'), mapId='request.official.'+'a'.repeat(64);
 try{
  if(isSecureContext||typeof crypto.randomUUID!=='undefined'||crypto.subtle)throw Error('not plain LAN HTTP');
  let command;
  await mountAssemblyCatalog({projectId:'binari',signal:new AbortController().signal,
   items:document.getElementById('items'),detail:document.getElementById('detail'),tools:document.getElementById('tools'),
   request:async path=>path.startsWith('/api/map-workspace')?{maps:[{mapId,title:'마당'}]}:{assemblies:[]},
   navigate:()=>'/',
   submit:async c=>{command=c;return Response.json({status:'queued',queueId:'ngs.local.00000000-0000-4000-8000-000000000000'},{status:202});}});
  document.querySelector('#tools button').click();
  const d=document.querySelector('dialog[open]');
  if(!d)throw Error('plus did not open the creation dialog');
  d.querySelector('input').value='마당 조립';d.querySelector('form').requestSubmit();
  await new Promise(r=>setTimeout(r,20));
  if(command?.payload?.mapId!==mapId||!/^[0-9a-f-]{36}$/.test(command.idempotencyKey))throw Error('request not sent');
  if(await sha256Hex(new TextEncoder().encode('abc'))!=='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')throw Error('hash wrong');
  result.textContent='PASS';
 }catch(e){result.textContent=e.message;}
 </script>`;
 const server=createServer(async(req,res)=>{
  if(req.url==='/'){res.setHeader('content-type','text/html; charset=utf-8');return res.end(html);}
  if(!/^\/[a-z0-9-]+\.mjs$/u.test(req.url??''))return res.writeHead(404).end();
  try{const file=await readFile(new URL('../build'+req.url,import.meta.url));res.setHeader('content-type','text/javascript');res.end(file);}
  catch{res.writeHead(404).end();}
 });
 await new Promise((resolve,reject)=>server.once('error',reject).listen(0,ip,resolve));t.after(()=>server.close());
 const {stdout}=await promisify(execFile)(process.env.CHROME_BIN,['--headless','--disable-gpu','--disable-background-networking','--no-proxy-server',
  '--no-first-run','--user-data-dir='+profile,'--virtual-time-budget=5000','--dump-dom','http://'+ip+':'+server.address().port+'/'],{timeout:30000});
 assert.match(stdout,/<p id="result">PASS<\/p>/u,stdout.match(/<p id="result">.*?<\/p>/u)?.[0]);
});

test('all shared browser modules use the LAN-safe helpers for UUIDs and hashes',async()=>{
 const source=await readFile(new URL('../build/local-project-page-server.mjs',import.meta.url),'utf8');
 const table=source.slice(source.indexOf('const assets=new Map(['),source.indexOf('const puzzleCode'));
 const modules=[...table.matchAll(/new URL\('\.\/([\w.-]+\.(?:mjs|js))'/gu)].map(m=>m[1]);
 assert.ok(modules.includes('browser-request-id.mjs'));
 assert.ok(modules.includes('browser-sha256.mjs'));
 for(const name of modules){
  const src=await readFile(new URL('../build/'+name,import.meta.url),'utf8');
  assert.doesNotMatch(src,/\b(?:globalThis\.)?crypto\s*\.\s*(?:randomUUID|subtle)\b/u,name);
 }
});
