import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {cinematicType,cinematicPath,cinematicSchema,cinematicResultSchema,validCinematicPayload} from '../build/cinematic-contract.mjs';
import {cinematicVideoResponse} from '../build/cinematic-workspace.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
const mp4=Buffer.alloc(40);mp4.writeUInt32BE(24);mp4.write('ftypisom',4);
const sha=b=>createHash('sha256').update(b).digest('hex');
const base=cinematicPath+'?projectId=binari';
const sourceSha256=sha(png),id='request.official.'+'a'.repeat(64);
const payload={schemaVersion:cinematicSchema,projectId:'binari',sourceSha256,motionPrompt:'The jacket opens.'};
const result={schemaVersion:cinematicResultSchema,projectId:'binari',sourceSha256,officialRequestId:id,
 sha256:sha(mp4),bytes:mp4.length,mimeType:'video/mp4',width:512,height:352,fps:24,frameCount:45};
test('Local NGS authenticates and scopes ready cinematic intake plus verified replica playback',async t=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-cinematic-'));
 const root=join(parent,'projects');
 t.after(()=>rmSync(parent,{force:true,recursive:true}));
 for(const p of ['sources','results'])mkdirSync(join(root,'binari','cinematics',p),{mode:0o700,recursive:true});
 writeFileSync(join(root,'binari','project.json'),'{"name":"비나리"}',{mode:0o600});
 const lock=join(root,'binari','cinematics');
 writeFileSync(join(lock,'sources',sourceSha256+'.png'),png,{mode:0o600});
 writeFileSync(join(lock,'results',id+'.json'),JSON.stringify(result),{mode:0o600});
 let registered;
 let ready=false;
 const server=createLocalProjectPageServer({root,readCinematicReady:async()=>ready,
  requestQueue:{enqueue(cmd){registered=cmd;return {queueId:'ngs.local.a82bf7f5-c880-49e5-b490-3712b02eef72',status:'queued'};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(origin+base)).status,401);
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0];
 const {csrfToken,contextId,cinematicEnabled}=await boot.json();
 assert.equal(cinematicEnabled,undefined);
 const get=(p,extra={})=>fetch(origin+p,{headers:{cookie,...extra}});
 const submit=(p,extra={})=>fetch(origin+'/api/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
  'x-npcgen-csrf':csrfToken,'x-npcgen-frontend-context':contextId,...extra},
  body:JSON.stringify({requestType:cinematicType,idempotencyKey:'one-cinematic',payload:p})});
 assert.deepEqual(await (await get(base)).json(),{clips:[],sources:[sourceSha256],sequences:[]});
 assert.equal((await submit(payload)).status,404);
 ready=true;
 assert.equal((await (await get('/__npcgen_session')).json()).cinematicEnabled,true);
 assert.equal((await submit({...payload,sourceSha256:'f'.repeat(64)})).status,404);
 assert.equal((await submit({...payload,sourcePath:'/tmp/out.png'})).status,400);
 assert.equal((await submit(payload,{'x-npcgen-csrf':'wrong'})).status,403);
 assert.equal((await submit(payload)).status,202);
 assert.deepEqual(registered.payload,payload);
 assert.deepEqual(Buffer.from(await (await get(base+'&source='+sourceSha256)).arrayBuffer()),png);
 writeFileSync(join(lock,'results',id+'.mp4'),mp4,{mode:0o600});
 assert.deepEqual(await (await get(base)).json(),{clips:[id],sources:[sourceSha256],sequences:[]});
 assert.deepEqual(await (await get(base+'&clip='+id)).json(),{clip:result});
 assert.deepEqual(await (await get(base+'&grouped=1')).json(),{scenes:[{sourceSha256,title:null,sequences:[],clips:[id]}]});
 assert.equal((await get(base+'&grouped=1&clip='+id)).status,400);
 const video=await get(base+'&clip='+id+'&video=1',{range:'bytes=4-7'});
 assert.equal(video.status,206);
 assert.equal(video.headers.get('Content-Type'),'video/mp4');
 assert.equal(video.headers.get('Content-Range'),'bytes 4-7/40');
 assert.equal(await video.text(),'ftyp');
 writeFileSync(join(lock,'results',id+'.mp4'),Buffer.alloc(40,0),{mode:0o600});
 assert.equal((await get(base+'&clip='+id+'&video=1')).status,503);
 assert.equal((await get(base+'&source='+sourceSha256+'&source='+sourceSha256)).status,400);
});
test('rejects prompt injection syntax and limits bytes; range cannot join arbitrary ranges',()=>{
 assert.ok(validCinematicPayload(payload));
 assert.ok(!validCinematicPayload({...payload,motionPrompt:'embedding:foreign'}));
 assert.ok(!validCinematicPayload({...payload,motionPrompt:'가'.repeat(700)}));
 assert.equal(cinematicVideoResponse(mp4,'bytes=40-').status,416);
 assert.equal(cinematicVideoResponse(mp4,'bytes=0-1,4-5').status,200);
});

test('formal source, native animation, timeline update and selected archive stay separate',async t=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-cinematic-native-'));
 t.after(()=>rmSync(parent,{force:true,recursive:true}));
 const root=join(parent,'projects'),dir=join(root,'binari'),cine=join(dir,'cinematics');
 const out=join(cine,'sequences',id);
 mkdirSync(join(out,'frames'),{mode:0o700,recursive:true});
 mkdirSync(join(cine,'sources'),{mode:0o700,recursive:true});
 const json=(f,v)=>writeFileSync(f,JSON.stringify(v),{mode:0o600});
 json(join(dir,'project.json'),{name:'비나리'});
 // A separate scope fixture authenticates hashes and image dimensions; browser playback
 // is tested with actual PNGs from the Worker integration, not this header fixture.
 const frame=Buffer.from(png);frame.writeUInt32BE(128,16);frame.writeUInt32BE(128,20);
 const original=Buffer.from(png);original.writeUInt32BE(1536,16);original.writeUInt32BE(1024,20);
 const source=sha(original),version=sha(frame),sourcePublished={sourceSha256:source,title:'빈 문턱'};
 const playback={durationFrames:135,speedCurve:[{frame:0,rate:1/3}],cameraCurve:[{frame:0,zoom:1,x:.5,y:.5}]};
 const sequence={schemaVersion:'ngs.cinematic-sequence-result.v1',projectId:'binari',officialRequestId:id,sourceSha256:source,width:128,height:128,masterFps:24,frameCount:45,
  frames:Array.from({length:45},(_,index)=>({index,bytes:frame.length,sha256:version})),playback};
 const registered=[];
 const yes=async()=>true;
 const server=createLocalProjectPageServer({root,readCinematicSequenceReady:yes,readCinematicPlaybackReady:yes,readCinematicSourceReady:yes,readCinematicRemoveReady:yes,
  requestQueue:{enqueue(c){registered.push(c);return {status:'queued'};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0];
 const settings=await boot.json();
 for(const flag of ['cinematicSequenceEnabled','cinematicPlaybackEnabled','cinematicSourceEnabled','cinematicRemoveEnabled'])assert.equal(settings[flag],true);
 const get=query=>fetch(origin+base+query,{headers:{cookie}});
 const post=(requestType,payload)=>fetch(origin+'/api/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
  'x-npcgen-csrf':settings.csrfToken,'x-npcgen-frontend-context':settings.contextId},body:JSON.stringify({requestType,idempotencyKey:requestType,payload})});
 const sourceCmd={schemaVersion:'ngs.cinematic-source-generate.v1',projectId:'binari',title:'빈 문턱',prompt:'A closed wooden door, ink wash.'};
 const videoCmd={schemaVersion:'ngs.cinematic-sequence-generate.v1',projectId:'binari',sourceSha256:source,motionPrompt:'A pale light drifts.',playback};
 assert.equal((await post('cinematic.source.generate',sourceCmd)).status,202);
 assert.equal((await post('cinematic.sequence.generate',videoCmd)).status,404);
 assert.equal(registered.length,1); // no dependent animation requested by source.
 writeFileSync(join(cine,'sources',source+'.png'),original,{mode:0o600});
 json(join(cine,'sources',source+'.json'),{schemaVersion:'ngs.cinematic-source-result.v1',projectId:'binari',officialRequestId:id,title:sourceCmd.title,sha256:source,bytes:original.length,width:1536,height:1024});
 assert.deepEqual(await (await get('&source='+source+'&sourceInfo=1')).json(),sourcePublished);
 assert.equal((await post('cinematic.sequence.generate',videoCmd)).status,202);
 json(join(out,'manifest.json'),sequence);
 writeFileSync(join(out,'frames','0000.png'),frame,{mode:0o600});
 assert.deepEqual((await (await get('')).json()).sequences,[id]);
 const sibling='request.official.'+'b'.repeat(64),other='request.official.'+'c'.repeat(64),otherSource=sha(png);
 writeFileSync(join(cine,'sources',otherSource+'.png'),png,{mode:0o600});
 for(const [key,src] of [[sibling,source],[other,otherSource]]){
  const path=join(cine,'sequences',key);mkdirSync(path,{mode:0o700});json(join(path,'manifest.json'),{...sequence,officialRequestId:key,sourceSha256:src});
 }
 const old=new Date('2026-01-01T00:00:00Z'),fresh=new Date('2026-01-02T00:00:00Z');
 utimesSync(join(cine,'sources',source+'.png'),old,old);
 utimesSync(join(cine,'sources',otherSource+'.png'),fresh,fresh);
 utimesSync(join(out,'manifest.json'),old,old);
 utimesSync(join(cine,'sequences',sibling,'manifest.json'),fresh,fresh);
 const grouped=(await (await get('&grouped=1')).json()).scenes;
 assert.deepEqual(grouped.map(row=>row.sourceSha256),[otherSource,source]);
 assert.deepEqual(grouped.find(row=>row.sourceSha256===source),{...sourcePublished,sequences:[sibling,id],clips:[]});
 assert.deepEqual(grouped.find(row=>row.sourceSha256===otherSource),{sourceSha256:otherSource,title:null,sequences:[other],clips:[]});
 assert.deepEqual(Buffer.from(await (await get('&sequence='+id+'&frame=0')).arrayBuffer()),frame);
 const revised={...playback,cameraCurve:[{frame:0,zoom:1,x:.5,y:.5},{frame:100,zoom:1.2,x:.52,y:.48}]};
 const timeline={schemaVersion:'ngs.cinematic-playback-update.v1',projectId:'binari',sequenceId:id,expectedRevision:0,playback:revised};
 assert.equal((await post('cinematic.playback.update',timeline)).status,202);
 assert.equal((await (await get('&sequence='+id)).json()).revision,0);
 json(join(out,'timeline.json'),{schemaVersion:'ngs.cinematic-playback-state.v1',projectId:'binari',sequenceId:id,revision:1,playback:revised});
 assert.equal((await post('cinematic.playback.update',timeline)).status,409);
 const read=await (await get('&sequence='+id)).json();
 assert.deepEqual([read.revision,read.playback,read.sequence.frames[0].sha256],[1,revised,version]);
 const hide={schemaVersion:'ngs.cinematic-sequences-remove.v1',projectId:'binari',sequenceIds:[id]};
 assert.equal((await post('cinematic.sequences.remove',{...hide,sequenceIds:[id,id]})).status,400);
 assert.equal((await post('cinematic.sequences.remove',hide)).status,202);
 json(join(cine,'sequence-archive.json'),{schemaVersion:'ngs.cinematic-sequence-archive.v1',projectId:'binari',sequenceIds:[id]});
 assert.equal((await get('&sequence='+id+'&frame=0')).status,404);
 assert.deepEqual((await (await get('')).json()).sequences,[sibling,other]);
 assert.deepEqual((await (await get('&grouped=1')).json()).scenes.find(row=>row.sourceSha256===source).sequences,[sibling]);
 assert.ok((await get('&source='+source)).ok);
});

test('prop-style scene controls create a single original and add only versions of the selected source',async t=>{
 const {mountCinematicWorkspace}=await import('../build/cinematic-workspace-ui.mjs');
 const other='f'.repeat(64),sibling='request.official.'+'b'.repeat(64),otherId='request.official.'+'c'.repeat(64);
 const sceneList=[{sourceSha256,title:'빈 문턱',sequences:[id,sibling],clips:[]},{sourceSha256:other,title:'다른 장면',sequences:[otherId],clips:[]}];
 class Element{
  constructor(tag,doc){this.tag=tag;this.ownerDocument=doc;this.events={};this.attrs={};this.children=[];this.style={};this.value='';
   this.classList={add:(...c)=>{this.className=[this.className,...c].filter(Boolean).join(' ');}};
  }
  setAttribute(k,v){this.attrs[k]=v;}
  addEventListener(k,v){this.events[k]=v;}
  append(...els){for(const e of els){e.parentElement=this;this.children.push(e);}}
  replaceChildren(...els){this.children=[];this.append(...els);}
  before(...els){const i=this.parentElement.children.indexOf(this);for(const e of els)e.parentElement=this.parentElement;this.parentElement.children.splice(i,0,...els);}
  click(){if(!this.disabled)return this.events.click?.({});}
  focus(){}
  showModal(){this.open=true;}
  close(){if(!this.open)return;this.open=false;this.events.close?.();}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(e=>e!==this);}
 }
 const doc={createElement:tag=>new Element(tag,doc),createElementNS:(_,tag)=>new Element(tag,doc)};
 const prior=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{value:doc,configurable:true});
 t.after(()=>{if(prior)Object.defineProperty(globalThis,'document',prior);else delete globalThis.document;});
 const walk=(el,keep)=>[...(keep(el)?[el]:[]),...el.children.flatMap(x=>walk(x,keep))];
 const submissions=[];
 async function mount(opts={}){
  const items=doc.createElement('ul'),detail=doc.createElement('article'),tools=doc.createElement('div');
  doc.createElement('section').append(items);
  await mountCinematicWorkspace({items,detail,tools,projectId:'binari',signal:new AbortController().signal,
   request:async path=>{assert.match(path,/grouped=1/);return {scenes:sceneList};},
   navigate:params=>'/?'+new URLSearchParams(params),sourceEnabled:true,enabled:true,playbackEnabled:true,removeEnabled:true,
   submit:async command=>{submissions.push(command);return Response.json({status:'queued',queueId:'ngs.local.a82bf7f5-c880-49e5-b490-3712b02eef72'},{status:202});},...opts});
  return {items,detail,tools};
 }
 const overview=await mount();
 assert.match(overview.items.parentElement.className,/npc-roster-list/);
 assert.equal(walk(overview.items,x=>x.tag==='strong')[0].textContent,'빈 문턱');
 assert.equal(walk(overview.detail,x=>x.tag==='form').length,0);
 overview.tools.children[0].click();
 const create=walk(overview.detail,x=>x.tag==='form')[0];
 walk(create,x=>x.tag==='input')[0].value='새 장면';
 walk(create,x=>x.tag==='textarea')[0].value='한 장의 풍경';
 await create.events.submit({preventDefault(){}});
 assert.equal(submissions.length,1);
 assert.equal(submissions[0].requestType,'cinematic.source.generate');
 assert.equal(submissions[0].payload.title,'새 장면');
 const basic=await mount({source:sourceSha256,panel:'source'});
 assert.equal(walk(basic.detail,x=>x.tag==='img').length,1);
 assert.match(walk(basic.detail,x=>x.tag==='img')[0].src,new RegExp(sourceSha256));
 assert.equal(walk(basic.detail,x=>x.tag==='form').length,0);
 assert.equal(walk(basic.detail,x=>x.attrs.role==='tab').length,2);
 const cropRequests=[];
 const cropView=async(width,height)=>mount({source:sourceSha256,panel:'source',cropEnabled:true,
  request:async path=>path.includes('sourceInfo=2')?{sourceSha256,width,height}:{scenes:sceneList},
  submit:async command=>{cropRequests.push(command);return Response.json({status:'queued',queueId:'ngs.local.a82bf7f5-c880-49e5-b490-3712b02eef72'},{status:202});}
 });
 const crop=await cropView(1536,512);
 const cropButton=walk(crop.detail,x=>x.textContent==='2:1 자르기')[0];
 const original=walk(crop.detail,x=>x.tag==='img')[0];
 assert.ok(original.parentElement.children.indexOf(cropButton.parentElement)<original.parentElement.children.indexOf(original));
 assert.match(cropButton.style.cssText,/background:#087f86/);
 cropButton.click();
 const cropForm=walk(crop.detail,x=>x.tag==='form')[0];
 assert.equal(walk(cropForm,x=>x.textContent==='상단 자르기').length,0);
 walk(cropForm,x=>x.textContent==='좌우 자르기')[0].click();
 const lines=walk(cropForm,x=>x.style.cssText?.includes('#ff3434'));
 assert.equal(lines.length,2);
 assert.match(lines[0].style.cssText,/border-left/);
 assert.equal(cropRequests.length,0);
 await cropForm.events.submit({preventDefault(){}});
 assert.equal(cropRequests[0].requestType,'cinematic.source.crop');
 assert.deepEqual(['left','top','right','bottom'].map(k=>cropRequests[0].payload[k]),[256,0,1280,512]);
 assert.equal(cropRequests[0].payload.label,undefined);
 const already=await cropView(1536,768);
 assert.equal(walk(already.detail,x=>x.textContent==='2:1 자르기').length,0);
 const versions=await mount({source:sourceSha256,panel:'animations'});
 assert.equal(walk(versions.detail,x=>x.type==='checkbox').length,2);
 assert.equal(walk(versions.detail,x=>x.tag==='button'&&x.textContent==='수정').length,2);
 assert.ok(!walk(versions.detail,x=>x.href?.includes(otherId)).length);
 const add=walk(versions.detail,x=>x.attrs['aria-label']==='애니메이션 추가')[0];
 for(let n=0;n<2;n++){
  add.click();
  const form=walk(versions.detail,x=>x.tag==='form')[0];
  assert.equal(walk(form,x=>x.tag==='select').length,0);
  walk(form,x=>x.tag==='textarea')[0].value='문이 조금 열린다';
  await form.events.submit({preventDefault(){}});
 }
 assert.equal(submissions.length,3);
 for(const c of submissions.slice(1)){
  assert.equal(c.requestType,'cinematic.sequence.generate');
  assert.equal(c.payload.sourceSha256,sourceSha256);
  assert.equal(c.payload.motionPrompt,'문이 조금 열린다');
 }
 assert.notEqual(submissions[1].idempotencyKey,submissions[2].idempotencyKey);
});

test('object-store upload time is carried to the shared scene sort',async()=>{
 const {openObjectWorkspaceProject}=await import('../build/object-workspace-read-storage.mjs');
 const date=new Date('2026-11-25T03:04:05Z');
 const port=openObjectWorkspaceProject({head:async()=>({size:100,etag:'pin',uploaded:date,customMetadata:{sha256:sourceSha256}})},'binari');
 assert.deepEqual(await port.head('cinematics/sources/file.png'),{size:100,sha256:sourceSha256,modifiedAtMs:date.getTime()});
});

test('scene-folder writes resolve through the common Local, Space and Viewer projection',async()=>{
 const {cinematicWorkspaceRead}=await import('../build/cinematic-workspace.mjs');
 const {cinematicSceneDeletePayload}=await import('../build/prop-folder-delete-contract.mjs');
 const frame=Buffer.from(png);frame.writeUInt32BE(128,16);frame.writeUInt32BE(128,20);
 const source=Buffer.from(png);source.writeUInt32BE(1536,16);source.writeUInt32BE(768,20);
 const digest=sha(source),root='cinematics/scenes/'+digest,sequence=root+'/sequences/'+id;
 const playback={durationFrames:135,speedCurve:[{frame:0,rate:1/3}],cameraCurve:[{frame:0,zoom:1,x:.5,y:.5}]};
 const meta={schemaVersion:'ngs.cinematic-source-result.v1',projectId:'binari',officialRequestId:id,title:'새 장면',sha256:digest,bytes:source.length,width:1536,height:768};
 const m={schemaVersion:'ngs.cinematic-sequence-result.v1',projectId:'binari',officialRequestId:id,sourceSha256:digest,width:128,height:128,masterFps:24,frameCount:45,
  frames:Array.from({length:45},(_,index)=>({index,bytes:frame.length,sha256:sha(frame)})),playback};
 const json=x=>Buffer.from(JSON.stringify(x));
 const objects=new Map([[root+'/source.png',source],[root+'/source.json',json(meta)],[sequence+'/manifest.json',json(m)],
  [sequence+'/frames/0000.png',frame],['cinematics/scene-index/sequences/'+id+'.json',json({sourceSha256:digest})]]);
 const storage={head:async p=>objects.has(p)?{size:objects.get(p).length,sha256:sha(objects.get(p))}:null,
  readBytes:async p=>objects.get(p)??null,listChildren:async p=>{
   const rows=new Map();for(const key of objects.keys())if(key.startsWith(p+'/')){
    const [name,...rest]=key.slice(p.length+1).split('/');rows.set(name,{name,kind:rest.length?'directory':'file'});
   }return [...rows.values()];
  }};
 const read=query=>cinematicWorkspaceRead({query:new URLSearchParams({projectId:'binari',...query}),openProject:async()=>storage,authorize:async()=>true});
 assert.deepEqual((await read({source:digest,sourceInfo:'1'})).json,{sourceSha256:digest,title:'새 장면',sceneFolder:true});
 assert.deepEqual((await read({grouped:'1'})).json.scenes,[{sourceSha256:digest,title:'새 장면',sequences:[id],clips:[],sceneFolder:true}]);
 assert.deepEqual((await read({sequence:id,frame:'0'})).bytes,frame);
 assert.equal(cinematicSceneDeletePayload(digest).target.path,'scenes/'+digest);
 objects.set('cinematics/scene-index/sequences/'+id+'.json',json({sourceSha256:'b'.repeat(64)}));
 await assert.rejects(read({sequence:id}),{status:404});
});

test('wide cinematic source and legacy cinematic source coexist; background stays 3:2',async()=>{
 const {validCinematicSourceResult,validBackgroundResult}=await import('../build/cinematic-sequence-contract.mjs');
 const still={schemaVersion:'ngs.cinematic-source-result.v1',projectId:'binari',officialRequestId:id,title:'장면',sha256:'f'.repeat(64),bytes:60,width:1536,height:768};
 assert.ok(validCinematicSourceResult(still));
 assert.ok(validCinematicSourceResult({...still,height:1024}));
 assert.ok(!validBackgroundResult({...still,schemaVersion:'ngs.background-source-result.v1'}));
 assert.ok(validBackgroundResult({...still,schemaVersion:'ngs.background-source-result.v1',height:1024}));
});

test('upscale submits an exact formal request and exposes separate 2× row in the original scene',async t=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-cine-upscale-'));
 t.after(()=>rmSync(parent,{force:true,recursive:true}));
 const root=join(parent,'projects'),dir=join(root,'binari'),cine=join(dir,'cinematics');
 const resultId='request.official.'+'b'.repeat(64);
 for(const folder of ['sources','sequences/'+id+'/frames','sequences/'+resultId+'/frames'])mkdirSync(join(cine,folder),{recursive:true,mode:0o700});
 writeFileSync(join(dir,'project.json'),'{"name":"비나리"}');
 writeFileSync(join(cine,'sources',sourceSha256+'.png'),png,{mode:0o600});
 const playback={durationFrames:135,speedCurve:[{frame:0,rate:1/3}],cameraCurve:[{frame:0,zoom:1,x:.5,y:.5}]};
 const frames=Array.from({length:45},(_,index)=>({index,sha256:sourceSha256,bytes:png.length}));
 const manifest={schemaVersion:'ngs.cinematic-sequence-result.v1',projectId:'binari',officialRequestId:id,
  sourceSha256,width:512,height:352,masterFps:24,frameCount:45,frames,playback};
 writeFileSync(join(cine,'sequences',id,'manifest.json'),JSON.stringify(manifest),{mode:0o600});
 writeFileSync(join(cine,'sequences',id,'frames','0000.png'),png,{mode:0o600});
 const requests=[];let ready=false;
 const server=createLocalProjectPageServer({root,releaseCapabilities:{cinematicUpscaleEnabled:true},
  readCinematicUpscaleReady:async()=>ready,requestQueue:{
  enqueue(c){requests.push(c);return {status:'queued'};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 assert.equal((await (await fetch(origin+'/__npcgen_session')).json()).cinematicUpscaleEnabled,false);
 ready=true;
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0],settings=await boot.json();
 assert.equal(settings.cinematicUpscaleEnabled,true);
 const type='cinematic.sequence.upscale';
 const wire={schemaVersion:'ngs.cinematic-sequence-upscale.v1',projectId:'binari',sequenceId:id,sourceSha256,expectedRevision:0,playback};
 const post=payload=>fetch(origin+'/api/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
  'x-npcgen-csrf':settings.csrfToken,'x-npcgen-frontend-context':settings.contextId},body:JSON.stringify({requestType:type,idempotencyKey:type,payload})});
 assert.equal((await post({...wire,sourcePath:'/tmp/source'})).status,400);
 assert.equal((await post(wire)).status,202);assert.deepEqual(requests,[{requestType:type,idempotencyKey:type,payload:wire}]);
 const derivative={...manifest,officialRequestId:resultId,width:1024,height:704,
  upscale:{model:'seedvr2-7b-fp16',scale:2,sourceWidth:512,sourceHeight:352,sourceSequenceId:id}};
 writeFileSync(join(cine,'sequences',resultId,'manifest.json'),JSON.stringify(derivative),{mode:0o600});
 writeFileSync(join(cine,'sequences',resultId,'frames','0000.png'),png,{mode:0o600});
 const get=q=>fetch(origin+base+q,{headers:{cookie}});
 const {scenes}=await (await get('&grouped=1')).json();
 assert.deepEqual(scenes[0].upscaledSequences,[resultId]);
 assert.deepEqual(new Set(scenes[0].sequences),new Set([id,resultId]));
 assert.deepEqual((await (await get('&sequence='+resultId)).json()).sequence,derivative);
});

test('crop direction only follows excess axis and produces exact half-open 2:1 pixels',async()=>{
 const {cinematicCropPresets,validCinematicCrop,cinematicCropSchema}=await import('../build/cinematic-sequence-contract.mjs');
 const presets=(w,h)=>cinematicCropPresets(w,h).map(({label,left,top,right,bottom})=>[label,left,top,right,bottom]);
 assert.deepEqual(presets(1536,768),[]);
 assert.deepEqual(presets(1536,1024),[['상단 자르기',0,256,1536,1024],['하단 자르기',0,0,1536,768],['상하 자르기',0,128,1536,896]]);
 assert.deepEqual(presets(1536,512),[['좌측 자르기',512,0,1536,512],['우측 자르기',0,0,1024,512],['좌우 자르기',256,0,1280,512]]);
 for(const [width,height] of [[1536,1024],[1536,512],[1537,1024],[1537,512]]){
  for(const {label,...box} of cinematicCropPresets(width,height)){
   const p={schemaVersion:cinematicCropSchema,projectId:'binari',title:'테스트',sourceSha256,...box};
   assert.equal(validCinematicCrop(p),true,label);
   assert.equal(validCinematicCrop({...p,label}),false);
   assert.equal(validCinematicCrop({...p,right:9999}),false);
  }
 }
});
