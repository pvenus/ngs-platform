import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {accessSync,createReadStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
const browser=process.env.CHROME_BIN;
test('cinematic search and visible anchor survive page reopen when a newer scene appears', {skip:!browser},async t=>{
 accessSync(browser);
 const profile=await mkdtemp(join(tmpdir(),'cinematic-roster-browser-'));
 t.after(()=>rm(profile,{recursive:true,force:true}));
 const html=`<!doctype html><meta charset="utf-8">
 <style>#items{max-height:104px;overflow:auto;padding:0;margin:0;list-style:none}#items li{height:28px}</style>
 <aside><div id="tools"></div><ul id="items"></ul></aside><article id="detail"></article><p id="result">running</p>
 <script type="module">
 import {mountCinematicWorkspace} from '/cinematic-workspace-ui.mjs';
 const params=new URLSearchParams(location.search),phase=params.get('p');
 const el=id=>document.getElementById(id), items=el('items'),detail=el('detail');
 const row=(i,title='프롤로그 '+i)=>({sourceSha256:i.toString(16).padStart(64,'0'),title,sequences:[],clips:[]});
 const scenes=Array.from({length:40},(_,i)=>row(40-i));
 if(phase==='second')scenes.unshift(row(41));
 scenes.push(row(100,'다른 장면'));
 try{
  await mountCinematicWorkspace({items,detail,tools:el('tools'),projectId:'binari',signal:new AbortController().signal,
   request:async()=>({scenes}),source:params.get('cineSource'),navigate:options=>'/?'+new URLSearchParams({p:'second',...options})});
  const input=el('cinematic-search'),list=()=>[...items.querySelectorAll('strong')].map(o=>o.textContent);
  const visible=()=>[...items.querySelectorAll('li')].find(x=>x.getBoundingClientRect().bottom>items.getBoundingClientRect().top)?.querySelector('strong')?.textContent;
  if(phase!=='second'){
   input.value='프롤로그';input.dispatchEvent(new Event('input'));
   items.scrollTop=284;items.dispatchEvent(new Event('scroll'));
   if(list().length!==40||!visible()||items.scrollTop<200)throw Error('fixture did not scroll/filter');
   sessionStorage.setItem('assertVisible',visible());
   items.querySelectorAll('a')[15].click();
  }else{
   if(input.value!=='프롤로그')throw Error('query lost: '+input.value);
   if(list()[0]!=='프롤로그 41'||list().includes('다른 장면'))throw Error('new row or filtering missing');
   if(sessionStorage.getItem('assertVisible')!==visible())throw Error('scroll anchor lost: '+visible());
   if(items.querySelector('[aria-current="page"]')?.querySelector('strong').textContent!=='프롤로그 25')throw Error('wrong selection');
   if(!sessionStorage.getItem('didReload')){
    sessionStorage.setItem('didReload','1');location.reload();
   }else el('result').textContent='PASS';
  }
 }catch(e){el('result').textContent=e.message;}
 </script>`;
 const server=createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(!/^\/[a-z0-9-]+\.mjs$/.test(url.pathname)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  createReadStream(new URL('../build'+url.pathname,import.meta.url)).on('error',()=>res.end()).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const {stdout}=await promisify(execFile)(browser,['--headless','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run',
  '--user-data-dir='+profile,'--virtual-time-budget=5000','--dump-dom','http://127.0.0.1:'+server.address().port+'/?p=first'],
  {timeout:25000,maxBuffer:1024*1024});
 assert.match(stdout,/<p id="result">PASS<\/p>/,stdout.match(/<p id="result">.*?<\/p>/)?.[0]);
});
