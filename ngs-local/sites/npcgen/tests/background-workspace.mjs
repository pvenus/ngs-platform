import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {backgroundPath,backgroundSourceSchema,backgroundSourceType,backgroundResultSchema,backgroundFields,validBackgroundRequest} from '../build/cinematic-sequence-contract.mjs';

test('Local background workspace requires the six inputs, queues one typed request and reads its published PNG',async t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-bg-'));t.after(()=>rmSync(root,{force:true,recursive:true}));
 const project=join(root,'binari'),folder=join(project,'cinematics','backgrounds');
 mkdirSync(project,{mode:0o700});writeFileSync(join(project,'project.json'),'{"name":"비나리"}',{mode:0o600});
 const jobs=[];const server=createLocalProjectPageServer({root,readBackgroundReady:async()=>true,
  requestQueue:{enqueue(cmd){jobs.push(cmd);return {status:'queued'};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port,base=backgroundPath+'?projectId=binari';
 assert.equal((await fetch(origin+base)).status,401);
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0],settings=await boot.json();
 assert.equal(settings.backgroundSourceEnabled,true);
 const get=path=>fetch(origin+path,{headers:{cookie}});
 const post=p=>fetch(origin+'/api/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
  'x-npcgen-csrf':settings.csrfToken,'x-npcgen-frontend-context':settings.contextId},
  body:JSON.stringify({requestType:backgroundSourceType,idempotencyKey:'fixture-background',payload:p})});
 const payload={schemaVersion:backgroundSourceSchema,projectId:'binari',title:'테스트 원본',timeOfDay:'해질녘',season:'늦가을',
  mood:'적막',color:'먹색',location:'한옥 마당',requirements:'마루와 문턱을 구분',additionalNotes:''};
 assert.ok(validBackgroundRequest(payload));
 for(const [k] of backgroundFields.filter(([k])=>k!=='additionalNotes'))assert.equal((await post({...payload,[k]:''})).status,400,k);
 assert.equal((await post(payload)).status,202);assert.deepEqual(jobs.map(x=>x.payload),[payload]);
 assert.deepEqual(await (await get(base)).json(),{backgrounds:[]});
 mkdirSync(folder,{recursive:true,mode:0o700});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
 const sha256=createHash('sha256').update(png).digest('hex');
 const row={schemaVersion:backgroundResultSchema,projectId:'binari',officialRequestId:'request.official.'+'a'.repeat(64),
  title:payload.title,sha256,bytes:png.length,width:1536,height:1024};
 writeFileSync(join(folder,sha256+'.json'),JSON.stringify(row),{mode:0o600});
 assert.deepEqual(await (await get(base)).json(),{backgrounds:[]});
 writeFileSync(join(folder,sha256+'.png'),png,{mode:0o600});
 const list=await (await get(base)).json();assert.deepEqual(list.backgrounds.map(x=>x.title),[row.title]);
 assert.deepEqual(Buffer.from(await (await get(base+'&image='+sha256)).arrayBuffer()),png);
});

test('background create dialog marks each required field and submits optional notes without demanding them',{skip:!process.env.CHROME_BIN},async t=>{
 const {createServer}=await import('node:http');const {createReadStream}=await import('node:fs');
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const profile=mkdtempSync(join(realpathSync(tmpdir()),'ngs-bg-browser-'));t.after(()=>rmSync(profile,{force:true,recursive:true}));
 const html=`<!doctype html><meta charset="utf-8"><div id="tools"></div><ul id="items"></ul><article id="detail"></article>
 <p id="result">RUN</p><script type="module">
 import {mountBackgroundWorkspace} from '/cinematic-workspace-ui.mjs';
 const id=x=>document.getElementById(x),assert=(v,m)=>{if(!v)throw Error(m);};
 try{
 let received,max=0;
 await mountBackgroundWorkspace({items:id('items'),detail:id('detail'),tools:id('tools'),projectId:'binari',
  signal:new AbortController().signal,request:async()=>({backgrounds:[]}),navigate:()=>'',enabled:true,submit:async req=>{
   received=req;max++;return Response.json({status:'queued',queueId:'ngs.local.a82bf7f5-c880-49e5-b490-3712b02eef72'},{status:202});}});
 document.querySelector('[aria-label="배경 생성 요청"]').click();
 const form=document.querySelector('dialog form'),button=form.querySelector('button[type=submit]');
 assert(button.disabled,'required gate missing');
 const required={title:'이름',timeOfDay:'저녁',season:'가을',mood:'고요',color:'먹색',location:'안채',requirements:'문턱 보여주기'};
 for(const [k,v] of Object.entries(required)){
  const input=form.elements.namedItem(k);assert(input.required,k+' not marked');
  input.value=v;input.dispatchEvent(new Event('input',{bubbles:true}));
 }
 assert(!button.disabled&&!form.elements.namedItem('additionalNotes').required,'optional field blocked');
 form.requestSubmit();
 await new Promise(r=>setTimeout(r,20));
 assert(max===1&&received.requestType==='background.source.generate'&&received.payload.additionalNotes===''&&received.payload.location==='안채','wrong request');
 id('result').textContent='PASS';
 }catch(e){id('result').textContent=e.message;}
 </script>`;
 const http=createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(!/^\/[a-z0-9-]+\.mjs$/.test(req.url)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  createReadStream(new URL('../build'+req.url,import.meta.url)).on('error',()=>res.end()).pipe(res);
 });
 await new Promise(r=>http.listen(0,'127.0.0.1',r));t.after(()=>http.close());
 const {stdout}=await promisify(execFile)(process.env.CHROME_BIN,['--headless','--disable-gpu','--disable-background-networking',
  '--no-first-run','--user-data-dir='+profile,'--virtual-time-budget=5000','--dump-dom','http://127.0.0.1:'+http.address().port+'/'],
  {timeout:25000,maxBuffer:1024*1024});
 assert.match(stdout,/<p id="result">PASS<\/p>/,stdout.match(/<p id="result">.*?<\/p>/)?.[0]);
});
