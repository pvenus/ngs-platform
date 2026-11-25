import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {accessSync,createReadStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';

const browser=[process.env.CHROME_BIN].find(p=>{
 if(!p)return false;try{accessSync(p);return true;}catch{return false;}
});
test('NPC browser keeps search, nodes and scroll across selection and refresh', {skip:!browser},async t=>{
 const profile=await mkdtemp(join(tmpdir(),'npc-roster-test-'));
 t.after(()=>rm(profile,{recursive:true,force:true}));
 const html=`<!doctype html><meta charset="utf-8">
 <style>#items ul {max-height:120px;overflow:auto} #items a{display:block;height:24px}</style>
 <main id="workspace"><h2 class="project-content-heading">NPC</h2><aside><h3>목록</h3><ul id="items"></ul></aside><section id="detail"></section></main>
 <p id="result">running</p>
 <script type="module">
 import {loadNpcFolder} from '/local-npc-workspace-ui.mjs';
 const el=id=>document.getElementById(id), items=el('items'), detail=el('detail'), workspace=el('workspace');
 const row=i=>({id:'npc.test-'+i,name:i===0?'다른 인물':'서진 '+i,role:'인물',actId:'act01',chapters:['chapter01'],scope:'binari/npcs/npc.test-'+i});
 let npcs=Array.from({length:42},(_,i)=>row(i));
 let rosterReads=0;
 const params=new URLSearchParams(location.search);
 const control=new AbortController(), fail=message=>{throw Error(message);};
 const until=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await new Promise(r=>setTimeout(r,5));}fail('condition timed out');};
 const read=async url=>{
  const id=new URL(url,location.origin).searchParams.get('npcId');
  const base={actId:'act01',chapters:[{id:'chapter01',label:'1'}],npcs:[...npcs]};
  if(!id){rosterReads++;return base;}
  return {...base,npc:npcs.find(n=>n.id===id),planning:[]};
 };
 try{
  await loadNpcFolder({search:params,projectId:'binari',signal:control.signal,request:read,post:async()=>({groups:[]}),
   note:()=>{},items,detail,workspace});
  const input=document.querySelector('#npc-search'); input.value='서진';input.dispatchEvent(new Event('input'));
  const list=items.querySelector('li ul');list.scrollTop=300;
  const scroll=list.scrollTop;if(scroll<=0)fail('fixture must scroll');
  const reads=rosterReads;
  items.querySelector('a[href*="npc.test-18"]').click();
  await until(()=>detail.querySelector('h3')?.textContent==='서진 18');
  if(items.querySelector('li ul')!==list||list.scrollTop!==scroll||input.value!=='서진'||rosterReads!==reads)fail('selection reloaded roster or changed position');
  if(items.querySelector('[aria-current="page"]')?.textContent!=='서진 18인물')fail('active marker incorrect');
  npcs=npcs.filter(n=>n.id!=='npc.test-39').concat(row(60));
  window.dispatchEvent(new Event('focus'));
  await until(()=>items.querySelector('a[href*="npc.test-60"]'));
  if(items.querySelector('a[href*="npc.test-39"]')||items.querySelector('li ul').scrollTop!==scroll||input.value!=='서진')fail('refresh lost filter, scroll or deleted row');
  if(detail.querySelector('h3')?.textContent!=='서진 18')fail('refresh replaced the selected detail');
  el('result').textContent='PASS';
 }catch(e){el('result').textContent=e.message;}
 finally{control.abort();}
 </script>`;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(!/^\/[a-z0-9-]+\.mjs$/.test(url.pathname)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  const file=new URL('../build'+url.pathname,import.meta.url);
  createReadStream(file).on('error',()=>res.end()).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const url='http://127.0.0.1:'+server.address().port+'/?projectId=binari&catalogArea=npcs&item=npc.test-1';
 const {stdout}=await promisify(execFile)(browser,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run','--disable-dev-shm-usage',
  '--user-data-dir='+profile,'--virtual-time-budget=4000','--dump-dom',url],{timeout:25000,maxBuffer:1024*1024});
 assert.match(stdout,/<p id="result">PASS<\/p>/,stdout.match(/<p id="result">.*?<\/p>/)?.[0]);
});
