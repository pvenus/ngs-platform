import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {fileDeleteType,backgroundDeletePayloads,validBackgroundFileDelete} from '../build/prop-folder-delete-contract.mjs';
import {backgroundPath,backgroundSourceSchema,backgroundSourceType,backgroundPixelType,backgroundPixelSchema,backgroundResultSchema,backgroundFields,validBackgroundRequest} from '../build/cinematic-sequence-contract.mjs';

test('Local background workspace requires the six inputs, queues one typed request and reads its published PNG',async t=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-bg-'));t.after(()=>rmSync(parent,{force:true,recursive:true}));
 const root=join(parent,'projects');mkdirSync(root,{mode:0o700});
 const project=join(root,'binari'),folder=join(project,'cinematics','backgrounds');
 mkdirSync(project,{mode:0o700});writeFileSync(join(project,'project.json'),'{"name":"비나리"}',{mode:0o600});
 const jobs=[];let deleteReady=false,pixelReady=false;const server=createLocalProjectPageServer({root,readBackgroundReady:async()=>true,readBackgroundPixelReady:async()=>pixelReady,readBackgroundDeleteReady:async()=>deleteReady,
  requestQueue:{enqueue(cmd){jobs.push(cmd);return {status:'queued'};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port,base=backgroundPath+'?projectId=binari';
 assert.equal((await fetch(origin+base)).status,401);
 assert.equal((await fetch(origin+'/catalog-roster-edit.mjs')).status,200);
 assert.equal((await fetch(origin+'/background-playback.mjs')).status,200);
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0],settings=await boot.json();
 assert.equal(settings.backgroundSourceEnabled,true);
 const get=path=>fetch(origin+path,{headers:{cookie}});
 const post=(p,type=backgroundSourceType)=>fetch(origin+'/api/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
  'x-npcgen-csrf':settings.csrfToken,'x-npcgen-frontend-context':settings.contextId},
  body:JSON.stringify({requestType:type,idempotencyKey:'fixture-background',payload:p})});
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
 const deletion=backgroundDeletePayloads({id:sha256,expected:{sourceRequestId:row.officialRequestId}});
 assert.equal((await post(deletion[0],fileDeleteType)).status,404);
 deleteReady=true;
 assert.equal((await (await get('/__npcgen_session')).json()).backgroundDeleteEnabled,true);
 assert.deepEqual(deletion.map(x=>x.target.path),[sha256+'.png',sha256+'.json']);
 assert.ok(deletion.every(validBackgroundFileDelete));
 assert.equal((await post({...deletion[0],target:{...deletion[0].target,path:'../a.png'}},fileDeleteType)).status,400);
 for(const job of deletion)assert.equal((await post(job,fileDeleteType)).status,202);
 assert.deepEqual(jobs.slice(1).map(x=>x.payload),deletion);
 const chain={...payload,schemaVersion:backgroundPixelSchema};
 assert.equal((await post(chain,backgroundPixelType)).status,404);
 pixelReady=true;
 assert.equal((await (await get('/__npcgen_session')).json()).backgroundPixelEnabled,true);
 assert.equal((await post({...chain,resize:384},backgroundPixelType)).status,400);
 assert.equal((await post(chain,backgroundPixelType)).status,202);
 assert.deepEqual(jobs.at(-1).payload,chain);

 assert.equal((await get(base+'&image='+sha256)).status,200);

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
 const saved=[];
 const backgrounds=[1,2,3].map(n=>({title:'장면 '+n,sha256:String(n).repeat(64),width:1536,height:1024}));
 await mountBackgroundWorkspace({items:id('items'),detail:id('detail'),tools:id('tools'),projectId:'binari',
  signal:new AbortController().signal,request:async()=>({backgrounds}),navigate:()=>'',enabled:true,
  deleteItem:async row=>{saved.push(row.title);},submit:async req=>{
   received=req;max++;return Response.json({status:'queued',queueId:'ngs.local.a82bf7f5-c880-49e5-b490-3712b02eef72'},{status:202});}});
 const search=id('background-search');
 assert(search?.matches('input.npc-search[type=search]'),'shared search missing');
 assert(search.nextElementSibling===id('items'),'search not above the roster');
 assert(document.querySelector('label[for=background-search]')?.textContent==='배경 검색','search has no accessible label');
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
 const modify=document.querySelector('[aria-label="목록 편집"]'),checks=[...id('items').querySelectorAll('input[type=checkbox]')];
 assert(modify.textContent===''&&modify.querySelector('svg')&&checks.every(x=>x.hidden),'icon or hidden state wrong');
 modify.click();
 assert(checks.every(x=>!x.hidden)&&modify.getAttribute('aria-pressed')==='true','edit mode not opened');
 checks[0].click();checks[2].click();
 id('tools').querySelector('.prop-animation-delete').click();
 const confirm=document.querySelector('dialog[open] .prop-animation-delete');
 assert(saved.length===0&&confirm,'no confirmation boundary');
 confirm.click();await new Promise(r=>setTimeout(r,20));
 assert(JSON.stringify(saved)===JSON.stringify(['장면 1','장면 3']),'did not submit separately for selected rows');
 assert(id('items').querySelectorAll('li').length===3,'optimistically erased rows');
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

test('one gallery item owns both published stills, never the draft, and accepts one paired animation request',async t=>{
 const {backgroundAnimationType:type,backgroundAnimationSchema:schema}=await import('../build/cinematic-sequence-contract.mjs');
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-bg-animation-'));t.after(()=>rmSync(parent,{force:true,recursive:true}));
 const root=join(parent,'projects'),project=join(root,'binari'),folder=join(project,'cinematics','backgrounds');
 mkdirSync(folder,{mode:0o700,recursive:true});writeFileSync(join(project,'project.json'),'{"name":"비나리"}',{mode:0o600});
 const jobs=[],server=createLocalProjectPageServer({root,readBackgroundAnimationReady:async()=>true,
  requestQueue:{enqueue(cmd){jobs.push(cmd);return {status:'queued'};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port,base=backgroundPath+'?projectId=binari';
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0],settings=await boot.json();
 assert.equal(settings.backgroundAnimationEnabled,true);
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),oid='request.official.'+'e'.repeat(64);
 const derived=key=>'request.official.'+sha(JSON.stringify([oid,key]));
 const pub=(suffix,id)=>{
  const png=Buffer.alloc(80,suffix.charCodeAt(0)),h=sha(png);
  writeFileSync(join(folder,h+'.json'),JSON.stringify({schemaVersion:backgroundResultSchema,projectId:'binari',officialRequestId:id,
   title:'안뜰 · '+suffix,sha256:h,bytes:png.length,width:1536,height:1024}),{mode:0o600});
  writeFileSync(join(folder,h+'.png'),png,{mode:0o600});return h;
 };
 const cinematic=pub('시네마틱 원본',derived('background_cinematic_source'));
 const draft=pub('픽셀 생성본',derived('background_pixel_generate'));
 const pixel=pub('픽셀 보정',oid);
 const {backgrounds}=await (await fetch(origin+base,{headers:{cookie}})).json();
 assert.deepEqual(backgrounds.map(x=>[x.displayTitle,x.cinematic.sha256,x.pixel.sha256]),[['안뜰',cinematic,pixel]]);
 const playback={durationFrames:264,speedCurve:[{frame:0,rate:1/3}],cameraCurve:[{frame:0,x:.5,y:.5,zoom:1}]};
 const payload={schemaVersion:schema,projectId:'binari',backgroundSha256:pixel,motionPrompt:'Continuous seamless ambient loop, static camera. Lantern flame keeps flickering.',references:{cinematic,pixel},playback};
 const post=p=>fetch(origin+'/api/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
  'x-npcgen-csrf':settings.csrfToken,'x-npcgen-frontend-context':settings.contextId},
  body:JSON.stringify({requestType:type,idempotencyKey:'fixture-background-animation',payload:p})});
 assert.equal((await post({...payload,references:{cinematic:draft}})).status,404);
 assert.equal((await post({...payload,motionPrompt:'A leaf stops.'})).status,400);
 assert.equal((await post({...payload,playback:{...playback,durationFrames:135}})).status,400);
 assert.equal((await post(payload)).status,202);
 assert.deepEqual(jobs.map(x=>x.payload),[payload]);
 const group='request.official.'+'8'.repeat(64);
 const seq='request.official.'+sha(JSON.stringify([group,'background_animation_cinematic']));
 const seqDir=join(project,'cinematics','sequences',seq);
 mkdirSync(seqDir,{recursive:true,mode:0o700});
 writeFileSync(join(seqDir,'manifest.json'),JSON.stringify({schemaVersion:'ngs.cinematic-sequence-result.v1',projectId:'binari',
  officialRequestId:seq,sourceSha256:cinematic,group:{requestId:group,variant:'cinematic',backgroundSha256:pixel},
  frameCount:45,frames:Array.from({length:45},(_,index)=>({index,sha256:'f'.repeat(64),bytes:80})),
  masterFps:24,width:1024,height:704,upscale:{model:'seedvr2-7b-fp16',scale:2,sourceWidth:512,sourceHeight:352},playback}),{mode:0o600});
 assert.deepEqual((await (await fetch(origin+base+'&groups='+pixel,{headers:{cookie}})).json()).groups.map(x=>[x.requestId,x.variants]),
  [[group,{cinematic:{id:seq,sourceSha256:cinematic}}]]);
});

test('background two-track comparison uses one submission and a shared timeline in Chromium',{skip:!process.env.CHROME_BIN},async t=>{
 const {createServer}=await import('node:http');const {createReadStream}=await import('node:fs');
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const profile=mkdtempSync(join(realpathSync(tmpdir()),'ngs-bg-pair-browser-'));t.after(()=>rmSync(profile,{force:true,recursive:true}));
 const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
 const html=`<!doctype html><meta charset="utf-8"><div id="tools"></div><ul id="items"></ul><article id="detail"></article>
 <p id="result">RUN</p><script type="module">
 import {mountBackgroundWorkspace} from '/cinematic-workspace-ui.mjs';
 const assert=(v,m)=>{if(!v)throw Error(m);};
 const pixel={sha256:'b'.repeat(64),width:1536,height:1024,title:'안뜰 · 픽셀 보정'};
 const original={...pixel,sha256:'a'.repeat(64),title:'안뜰 · 시네마틱 원본'};
 const pr='request.official.'+'c'.repeat(64),co='request.official.'+'d'.repeat(64),px='request.official.'+'e'.repeat(64);
 const refs={cinematic:{id:co,sourceSha256:original.sha256},pixel:{id:px,sourceSha256:pixel.sha256}};
 const playback={durationFrames:264,speedCurve:[{frame:0,rate:1/3}],cameraCurve:[{frame:0,x:.5,y:.5,zoom:1}]};
 const backgrounds=[{...pixel,displayTitle:'안뜰',cinematic:original,pixel}];
 const sent=[];
 // One decoded fixture pixel suffices for testing the player DOM and its frame URL contract.
 const sample=document.createElement('img');
 sample.src='data:image/png;base64,${image.toString('base64')}';
 await sample.decode();
 Object.defineProperty(sample,'src',{set(value){
  const query=new URL(value,location.origin).searchParams;
  assert(query.has('sequence')&&query.has('frame'),'not a frame endpoint');
 }});
 sample.decode=()=>Promise.resolve();
 globalThis.Image=function(){return sample;};
 const untilReady=(host,selector)=>new Promise(resolve=>{
  const observer=new MutationObserver(check);
  function check(){const match=host.querySelector(selector);if(match){observer.disconnect();resolve(match);}}
  observer.observe(host,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});check();
 });
 const call=async url=>{
  const params=new URL(url,location.origin).searchParams;
  if(params.has('groups'))return {groups:[{requestId:pr,variants:refs}]};
  if(params.has('sequence')){
   const id=params.get('sequence'),variant=id===co?'cinematic':'pixel';
   return {playback,sequence:{schemaVersion:'ngs.cinematic-sequence-result.v1',projectId:'binari',officialRequestId:id,
    sourceSha256:refs[variant].sourceSha256,group:{requestId:pr,variant,backgroundSha256:pixel.sha256},width:1024,height:704,
    upscale:{model:'seedvr2-7b-fp16',scale:2,sourceWidth:512,sourceHeight:352},
    masterFps:24,frameCount:45,frames:Array.from({length:45},(_,index)=>({index,sha256:'f'.repeat(64),bytes:90})),playback}};
  }
  return {backgrounds};
 };
 let abort=new AbortController(),routed;
 const mount=panel=>mountBackgroundWorkspace({items:document.querySelector('#items'),detail:document.querySelector('#detail'),
  tools:document.querySelector('#tools'),projectId:'binari',item:pixel.sha256,panel,animationEnabled:true,
  signal:abort.signal,request:call,navigate:options=>{if(options.cineTab==='play')routed=options;return '?'+new URLSearchParams(options);},submit:async req=>{
   sent.push(req);return Response.json({status:'queued',queueId:'ngs.local.a82bf7f5-c880-49e5-b490-3712b02eef72'},{status:202});
  }});
 try{
  await mount('source');
  assert(document.querySelectorAll('#detail img').length===2&&!document.querySelector('#detail').textContent.includes('픽셀 생성본'),'not two final stills');
  const openStill=document.querySelector('[aria-label="시네마틱 스타일 원본 확대"]');
  openStill.click();
  const still=document.querySelector('dialog.background-media-dialog[open]');
  assert(still?.querySelector('img')?.src===openStill.querySelector('img').src,'full source image not in popup');
  still.querySelector('button').click();await new Promise(r=>setTimeout(r,25));
  assert(!document.querySelector('dialog[open]'),'image popup did not close');
  assert(document.querySelector('#background-tab-play')?.getAttribute('href').includes('cineTab=play'),'missing published play tab');
  abort.abort();abort=new AbortController();
  const realRaf=globalThis.requestAnimationFrame,realCancel=globalThis.cancelAnimationFrame;
  let pending,nextId=0;
  globalThis.requestAnimationFrame=fn=>(pending=fn,++nextId);
  globalThis.cancelAnimationFrame=()=>{pending=undefined;};
  const frame=time=>{const callback=pending;pending=undefined;callback?.(time);};
  await mount('play');
  const active=document.querySelector('#background-tab-play'),play=document.querySelector('[data-flag="seojin.spiritSight"]');
  assert(routed.item===pixel.sha256&&active?.getAttribute('aria-selected')==='true','play is not a selected resource tab');
  assert(document.querySelector('[data-motion=paired]'),'did not load verified pair');
  const spirit=document.querySelector('[data-layer=spirit]'),normal=document.querySelector('[data-layer=normal]');
  frame(0);frame(250);
  assert(spirit.dataset.frame==='2'&&normal.dataset.frame==='2','both layers do not use the same phase');
  play.click();
  assert(play.getAttribute('aria-pressed')==='true'&&play.textContent.includes('끄기'),'cannot activate the flag');
  frame(400);
  const incoming=Number(spirit.style.opacity);
  assert(incoming>0&&incoming<1&&spirit.dataset.frame==='3','blend is not gradual or phase reset when turned on');
  play.click();frame(450);
  assert(play.getAttribute('aria-pressed')==='false'&&play.textContent.includes('켜기')&&Number(spirit.style.opacity)>0&&
   Number(spirit.style.opacity)<incoming&&spirit.dataset.frame===normal.dataset.frame,'cannot reverse blend from the current phase');
  abort.abort();abort=new AbortController();
  globalThis.requestAnimationFrame=realRaf;globalThis.cancelAnimationFrame=realCancel;
  await mount('animations');
  document.querySelector('[aria-label="배경 애니메이션 추가"]').click();
  const form=document.querySelector('dialog form'),text=form.querySelector('textarea');
  assert([...form.querySelectorAll('fieldset input')].filter(i=>i.checked).length===2,'two picks unavailable');
  text.value='바닥에서 옅은 안개가 흐른다';text.dispatchEvent(new Event('input',{bubbles:true}));
  form.requestSubmit();await new Promise(r=>setTimeout(r,25));
  assert(sent.length===1&&sent[0].requestType==='background.animation.workflow'&&Object.keys(sent[0].payload.references).length===2&&sent[0].payload.motionPrompt.startsWith('Continuous seamless ambient loop')&&sent[0].payload.playback.durationFrames===84,'not one paired loop request');
  [...document.querySelectorAll('#detail button')].find(b=>b.textContent==='두 영상 함께 재생').click();
  const host=document.querySelector('.background-pair-player'),range=await untilReady(host,'input[type=range]:enabled');
  assert(host.querySelectorAll('canvas').length===2&&range&&!range.disabled&&host.querySelectorAll('input[type=range]').length===1,'no shared player');
  range.value=48;range.dispatchEvent(new Event('input',{bubbles:true}));
  assert(host.textContent.includes('2.00초'),'shared clock could not seek');
  for(const label of ['시네마틱 스타일 원본','픽셀 보정본']){
   [...document.querySelectorAll('#detail button')].find(b=>b.textContent===label+' 확대').click();
   const popup=document.querySelector('dialog.background-media-dialog[open]');
   assert(popup?.querySelector('h3')?.textContent===label+' 애니메이션','wrong individual popup');
   const frames=await untilReady(popup,'[aria-label="PNG 원본 프레임"]:enabled');
   assert(popup.querySelectorAll('canvas').length===1&&frames&&!frames.disabled&&frames.max==='45'&&popup.querySelector('canvas').width===1024&&popup.textContent.includes('2× 업스케일'),'not one upscaled frame player');
   frames.value='4';frames.dispatchEvent(new Event('input',{bubbles:true}));
   assert(popup.textContent.includes('PNG 원본 프레임 4 / 45'),'native scrub did not seek');
   [...popup.querySelectorAll('button')].find(b=>b.textContent==='다음 프레임').click();
   assert(popup.textContent.includes('PNG 원본 프레임 5 / 45'),'native stepping failed');
   popup.querySelector('button').click();await new Promise(r=>setTimeout(r,25));
  }
  document.querySelector('#result').textContent='PASS';
 }catch(e){document.querySelector('#result').textContent=e.message;}
 </script>`;
 const http=createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);return;}
  if(req.url.startsWith('/api/')){res.setHeader('Content-Type','image/png');res.end(image);return;}
  if(!/^\/[a-z0-9-]+\.mjs$/.test(req.url)){res.writeHead(404).end();return;}
  res.setHeader('Content-Type','text/javascript; charset=utf-8');
  createReadStream(new URL('../build'+req.url,import.meta.url)).on('error',()=>res.end()).pipe(res);
 });
 await new Promise(r=>http.listen(0,'127.0.0.1',r));t.after(()=>http.close());
 const {stdout}=await promisify(execFile)(process.env.CHROME_BIN,['--headless','--disable-gpu','--disable-background-networking',
  '--no-first-run','--user-data-dir='+profile,'--virtual-time-budget=7200','--dump-dom','http://127.0.0.1:'+http.address().port+'/'],
  {timeout:25000,maxBuffer:1024*1024});
 assert.match(stdout,/<p id="result">PASS<\/p>/,stdout.match(/<p id="result">.*?<\/p>/)?.[0]);
});
