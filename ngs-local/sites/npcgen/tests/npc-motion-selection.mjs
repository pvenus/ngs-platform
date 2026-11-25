import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';import {realpathSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';import {openLocalRequestQueue} from '../build/local-request-queue.mjs';
import {workspaceRead} from '../build/project-workspace-view.mjs';
import {mountNpcAnimationRegenerate} from '../build/local-npc-workspace-ui.mjs';
import {mountNpcOneStop,newNpcOneStopRequest,newNpcBasicRequest,npcReplacementTarget,readOneStopMotionPresets} from '../build/local-npc-one-stop-ui.mjs';
import {animationRegenerateSchema,animationRegenerateType,npcAnimationRegenerateRequest,npcPublishedMotionLabel,validNpcAnimationRegenerate,motionCatalogSchema,motionDirections,motionSelectionOf,publishedMotionChoice,quickMotionSelection,
 selectionReplaceSchemaVersion,selectionSchemaVersion,validMotionSelection,validNpcMotionSelectionRequest,validNpcPortraitRegeneration,portraitRegenerateType,portraitRegenerateSchema} from '../build/npc-motion-selection.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const variant={kind:'2d',sourcePresetId:'run',sourcePresetHash:'a'.repeat(64)};
const choice=(presetId,posePreset='idle',label=presetId,marker='1')=>({presetId,posePreset,label,assetSetSha256:marker.repeat(64)});
const walk=choice('walk-flat'),run=choice('run-flat'),run2d=choice('run-2d'),attack=choice('sword-attack-flat','combat');
const extra=Array.from({length:8},(_,i)=>choice('extra-'+i));
const direct=['walk-flat','run-flat','run-2d','sword-attack-flat'];
const brief={goal:'실종된 가족을 찾음',behavior:'조용히 단서를 확인함',palette:'먹색, 회청색',appearance:'단정한 회색 겉옷'};
const source={name:'오리',slug:'duck',role:'농부',actId:'act1',chapterId:'ch01',intent:'마을에서 논다.',sourceRefs:'마을기록'};
function manifest(presetId,posePreset='idle',extras={}){
 return {schemaVersion:'ngs.motion-preset.v1',presetId,posePreset,label:presetId,
  directions:motionDirections.map((direction,i)=>{const sha256=digest(presetId+'-'+i);
   return {direction,sha256,assetId:sha256+'.mp4',bytes:120,frameCount:25,fps:24,cycleCount:1};}).reverse(),...extras};
}
test('catalog reads only indexed small preset JSON and produces exact ordered asset identity',async()=>{
 const manifests=new Map(direct.map(id=>[id,manifest(id,id===attack.presetId?'combat':'idle',id===run2d.presetId?{variant}:{})]));
 manifests.set('incomplete',manifest('incomplete','idle',{directions:[]}));
 manifests.set('bad-marker',manifest('bad-marker','idle',{variant:{...variant,leak:1}}));
 manifests.set('DUP',manifest('DUP'));manifests.set('dup',manifest('dup'));
 const files=[],listed=[];
 const fake={
  async listChildren(prefix){listed.push(prefix);return [...manifests.keys()].map(id=>({name:id+'.json',kind:'file'}));},
  async readBytes(file,limit){files.push([file,limit]);return new TextEncoder().encode(JSON.stringify(manifests.get(file.split('/').at(-1).slice(0,-5))));},
  async head(){assert.fail('never stat video');},
 };
 const make=extra=>workspaceRead({openProject:async id=>{assert.equal(id,'binari');return fake;},authorize:id=>assert.equal(id,'binari'),
  query:new URLSearchParams('projectId=binari&tab=motion-presets&view=selection'+(extra??''))});
 const result=await make();
 assert.equal(result.json.schemaVersion,motionCatalogSchema);
 assert.deepEqual(result.json.presets.map(row=>row.presetId).sort(),[...direct].sort());
 for(const preset of result.json.presets){
  const p=manifests.get(preset.presetId),rows=motionDirections.map(direction=>[direction,p.directions.find(r=>r.direction===direction).sha256]);
  assert.equal(preset.assetSetSha256,digest(JSON.stringify(['ngs.motion-assets.v1',p.presetId,p.posePreset,rows])));
  assert.deepEqual(Object.keys(preset).sort(),['assetSetSha256','label','posePreset','presetId']);
 }
 assert.deepEqual(listed,['motion-presets/presets']);
 assert.ok(files.every(([path,limit])=>path.startsWith('motion-presets/presets/')&&path.endsWith('.json')&&limit===16*1024));
 assert.equal(files.length,6);
 manifests.set('new',manifest('new'));assert.ok((await make()).json.presets.some(row=>row.presetId==='new'));
 await assert.rejects(make('&item=walk-flat'),e=>e.status===400);
});

test('exact mixed selections and starter buttons never substitute or write hidden defaults',async()=>{
 const catalog=[walk,run,run2d,attack],selected=[run2d,attack,run].map(motionSelectionOf);
 const body=newNpcOneStopRequest({...source,motionSelection:selected},catalog);
 assert.deepEqual(Object.keys(body).sort(),['character','intent','motionSelection','projectId','schemaVersion','sourceRefs']);
 assert.equal(body.schemaVersion,'ngs.npc-one-stop.selection.v1');assert.deepEqual(body.motionSelection,selected);
 assert.equal(selectionReplaceSchemaVersion,'ngs.npc-one-stop.selection.replace.v2');
 assert.equal(newNpcOneStopRequest({...source,motionSelection:[motionSelectionOf(run)]},catalog,true).schemaVersion,selectionSchemaVersion);
 assert.equal(validNpcMotionSelectionRequest({...body,schemaVersion:'ngs.npc-one-stop.selection.v1'}),true);
 assert.equal(validNpcMotionSelectionRequest({...body,schemaVersion:selectionReplaceSchemaVersion}),true);
 for(const [id,slug,ch] of [['character.seojin','seojin','ch1'],['character.yeonwoo','yeonwoo','chapter01']]){
  const target=npcReplacementTarget({id,name:'기존 인물',role:'역할',actId:'story.main.act01',chapters:[ch]});
  assert.deepEqual([target.npcId,target.slug,target.actId,target.chapterId],[id,slug,'act01',ch]);
  assert.equal(npcReplacementTarget({id,slug:'wrong'}),null);
  assert.equal(npcReplacementTarget({id:id.toUpperCase()}),null);
  const character={...body.character,npcId:id,slug,actId:target.actId,chapterId:ch};
  assert.equal(validNpcMotionSelectionRequest({...body,character,schemaVersion:selectionReplaceSchemaVersion}),true);
  assert.equal(validNpcMotionSelectionRequest({...body,character}),false);
  for(const patch of [{slug:'other'},{actId:'act2'},{chapterId:'ch6'}])
   assert.equal(validNpcMotionSelectionRequest({...body,character:{...character,...patch},schemaVersion:selectionReplaceSchemaVersion}),false);
 }
 const many=[...catalog,...extra];
 assert.equal(newNpcOneStopRequest({...source,motionSelection:many.map(motionSelectionOf)},many).motionSelection.length,12);
 assert.equal(npcAnimationRegenerateRequest('character.seojin',many.map(motionSelectionOf),many).motionSelection.length,12);
 assert.equal(validNpcMotionSelectionRequest({...body,includeCombat:true}),false);
 assert.equal(validMotionSelection([selected[0],{...selected[0],presetId:'RUN-2D'}]),false);
 for(const invalid of [[],[{...selected[0],label:'fake'}],[{...selected[0],presetId:'../run'}],[{...selected[0],assetSetSha256:'e'.repeat(65)}]])
  assert.equal(validMotionSelection(invalid),false);
 assert.throws(()=>newNpcOneStopRequest({...source,motionSelection:[{...selected[0],assetSetSha256:'2'.repeat(64)}]},catalog),/다시 골라/);
 assert.deepEqual(quickMotionSelection('noncombat',catalog),[walk,run].map(motionSelectionOf));
 assert.deepEqual(quickMotionSelection('combat',catalog),[walk,run,attack].map(motionSelectionOf));
 assert.equal(quickMotionSelection('noncombat',[walk,run2d,attack]),null);
 assert.equal(quickMotionSelection('combat',[walk,run,choice('sword-attack','combat')]),null);
 assert.equal(await publishedMotionChoice('walk-flat',manifest('run-flat'),'bad'),null);
 const signal=new AbortController().signal,seen=[];
 assert.deepEqual(await readOneStopMotionPresets(async(path,options)=>{seen.push([path,options.signal]);return {schemaVersion:motionCatalogSchema,presets:catalog};},signal),catalog);
 assert.deepEqual(seen,[['/api/project-workspace?projectId=binari&tab=motion-presets&view=selection',signal]]);
});

test('open modal polls immediately, accepts mixed presets, and blocks stale until deliberately reselected',async t=>{
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.dataset={};this.textContent='';this.isConnected=true;}
  append(...items){this.children.push(...items);}
  before(el){this.parent?.append(el);}
  querySelector(sel){return sel==='h3'?this.children.find(c=>c.tag==='h3'):null;}
  replaceChildren(...items){this.children=items;}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
  remove(){this.isConnected=false;}
  focus(){}
 }
 const previous=globalThis.document,timers=new Map();let timerId=0;
 const oldSet=globalThis.setTimeout,oldClear=globalThis.clearTimeout;
 globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
 globalThis.setTimeout=(fn,ms)=>{assert.equal(ms,4000);const id=++timerId;timers.set(id,fn);return id;};
 globalThis.clearTimeout=id=>timers.delete(id);
 t.after(()=>{globalThis.document=previous;globalThis.setTimeout=oldSet;globalThis.clearTimeout=oldClear;});
 const ac=new AbortController(),owner=new Element('div'),h3=new Element('h3');h3.parent=owner;owner.append(h3);
 const all=(el,tag)=>[...(el.tag===tag?[el]:[]),...el.children.flatMap(next=>next?.children?all(next,tag):[])];
 let catalog=[walk,run,run2d,attack,...extra],seen=[];
 const trigger=mountNpcOneStop(owner,{signal:ac.signal,request:async(url,options)=>{
  assert.match(url,/view=selection$/);assert.equal(options.signal.aborted,false);
  return {schemaVersion:motionCatalogSchema,presets:catalog};
 },submit:async command=>{seen.push(command);return Response.json({queueId:'ngs.local.00000000-0000-4000-8000-000000000000',status:'queued'},{status:202});}});
 trigger.events.click();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 const modal=all(owner,'dialog')[0],form=all(modal,'form')[0],buttons=all(modal,'button');
 const click=label=>buttons.find(b=>b.textContent===label).events.click();
 const check=id=>all(modal,'label').find(c=>c.children[1]?.textContent?.includes(' · '+id))?.children[0];
 const set=(id,checked)=>{const c=check(id);c.checked=checked;c.events.change();};
 assert.equal(timers.size,1);assert.equal(buttons.at(-1).disabled,false);
 click('전투 기본');assert.equal(check('walk-flat').checked,true);assert.equal(check('run-flat').checked,true);assert.equal(check('sword-attack-flat').checked,true);
 set('run-flat',false);set('run-2d',true);
 catalog=[walk,run,choice('run-2d','idle','새 결과','2'),attack,choice('new'),...extra];
 const [timer,next]=timers.entries().next().value;timers.delete(timer);await next();
 assert.equal(check('new').checked,false);
 assert.equal(check('run-2d').checked,true);
 assert.equal(buttons.at(-1).disabled,true,'old fingerprint cannot be silently substituted');
 set('run-2d',false);set('run-2d',true);
 for(const row of extra){assert.equal(check(row.presetId).disabled,false);set(row.presetId,true);}
 assert.equal(buttons.at(-1).disabled,false);
 const requestInputs=all(form,'input').filter(i=>i.type!=='checkbox'),areas=all(form,'textarea');
 Object.assign(requestInputs[0],{value:source.name});Object.assign(requestInputs[1],{value:source.slug});Object.assign(requestInputs[2],{value:source.role});
 areas[0].value=source.intent;areas[1].value=source.sourceRefs;
 await form.events.submit({preventDefault(){}});
 assert.equal(seen.length,1);
 assert.equal(seen[0].payload.schemaVersion,'ngs.npc-one-stop.selection.v1');
 assert.deepEqual(seen[0].payload.motionSelection.map(row=>row.presetId),['walk-flat','sword-attack-flat','run-2d',...extra.map(r=>r.presetId)]);
 assert.equal(seen[0].payload.motionSelection[2].assetSetSha256,'2'.repeat(64));
 ac.abort();assert.equal(timers.size,0);
});

test('Local browser queue validates selected publication hashes without reading absent MP4s',async t=>{
 const tmp=await mkdtemp(join(realpathSync(tmpdir()),'ngs-npc-motion-selection-')),root=join(tmp,'root');
 const project=join(root,'binari'),presets=join(project,'motion-presets','presets');
 await mkdir(presets,{recursive:true,mode:0o700});
 await writeFile(join(project,'project.json'),JSON.stringify({name:'Binari fixture'}),{mode:0o600});
 for(const selected of [run2d,attack,...extra]){
  const raw=manifest(selected.presetId,selected.posePreset,selected===run2d?{variant}:{});
  await writeFile(join(presets,selected.presetId+'.json'),JSON.stringify(raw),{mode:0o600});
 }
 const queue=openLocalRequestQueue(join(tmp,'queue.sqlite')),server=createLocalProjectPageServer({root,requestQueue:queue,poseSelectionV2Enabled:true,npcBasicPortraitEnabled:true,npcScopedPortraitEnabled:true});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));queue.close();await rm(tmp,{recursive:true,force:true});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const r=await fetch(origin+'/__npcgen_session'),cookie=r.headers.get('set-cookie').split(';')[0],session=await r.json();
 assert.equal(session.poseSelectionV2Enabled,true);
 const headers={cookie,origin,'content-type':'application/json','x-npcgen-csrf':session.csrfToken,'x-npcgen-frontend-context':session.contextId};
 const npcPath=join(project,'npcs','npc.ch1_dajeong'),legacyPath=join(project,'npcs','character.seojin');
 await mkdir(npcPath,{mode:0o700,recursive:true});
 await mkdir(legacyPath,{mode:0o700,recursive:true});
 await writeFile(join(legacyPath,'metadata.json'),JSON.stringify({id:'character.seojin',name:'서진'}),{mode:0o600});
 await writeFile(join(project,'npcs','metadata.json'),JSON.stringify({characterOrder:['npc.ch1_dajeong','character.seojin']}),{mode:0o600});
 await writeFile(join(npcPath,'metadata.json'),JSON.stringify({id:'npc.ch1_dajeong',name:'다정'}),{mode:0o600});
 const res=await fetch(origin+'/api/project-workspace?projectId=binari&tab=motion-presets&view=selection',{headers:{cookie}});
 assert.equal(res.status,200);
 const catalog=(await res.json()).presets;
 assert.deepEqual(catalog.map(row=>row.presetId).sort(),[...extra.map(row=>row.presetId),'run-2d','sword-attack-flat'].sort());
 const body=newNpcOneStopRequest({...source,motionSelection:catalog.map(motionSelectionOf)},catalog);
 const send=(id,payload)=>fetch(origin+'/api/requests',{method:'POST',headers,
  body:JSON.stringify({requestType:'npc.workflow',idempotencyKey:id,payload})});
 const malformed=await send('wrong-shape',{...body,includeCombat:false});
 assert.equal(malformed.status,400);assert.equal((await malformed.json()).error,'NGS_ONE_STOP_PAYLOAD_INVALID');
 const stale=await send('stale-motion-selection',{...body,motionSelection:body.motionSelection.map(row=>({...row,assetSetSha256:'1'.repeat(64)}))});
 assert.equal(stale.status,409);assert.equal((await stale.json()).error,'ONE_STOP_MOTION_SELECTION_STALE');
 assert.equal(queue.list().requests.length,0);
 const queued=await send('exact-motion-selection',body);assert.equal(queued.status,202,JSON.stringify(await queued.json()));
 assert.deepEqual(queue.list().requests[0].payload,body);
 const existing={...body,schemaVersion:selectionReplaceSchemaVersion,
  character:{...body.character,npcId:'character.seojin',slug:'seojin',actId:'act01',chapterId:'chapter01'}};
 assert.equal((await send('legacy-create',{...existing,schemaVersion:selectionSchemaVersion})).status,400);
 assert.equal((await send('legacy-unknown',{...existing,character:{...existing.character,npcId:'character.yeonwoo',slug:'yeonwoo'}})).status,404);
 assert.equal((await send('legacy-mismatch',{...existing,character:{...existing.character,slug:'new-id'}})).status,400);
 assert.equal((await send('legacy-exact',existing)).status,202);
 assert.deepEqual(queue.list().requests.at(-1).payload,existing);
 const v1={...existing,schemaVersion:'ngs.npc-one-stop.selection.replace.v1'};
 assert.equal((await send('old-selection-replace',v1)).status,202);
 assert.deepEqual(queue.list().requests.at(-1).payload,v1,'older queued version is not rewritten');
 const regen=motionSelectionPayload(catalog.map(motionSelectionOf));
 const sendRegen=(id,payload)=>fetch(origin+'/api/requests',{method:'POST',headers,
  body:JSON.stringify({requestType:animationRegenerateType,idempotencyKey:id,payload})});
 assert.equal((await sendRegen('no-npc',{...regen,npcId:'npc.nonexistent'})).status,404);
 assert.equal((await sendRegen('stale-npc-motion',{...regen,motionSelection:staleMotionPins(regen)})).status,409);
 const accepted=await sendRegen('npc-motion-only',regen);assert.equal(accepted.status,202,JSON.stringify(await accepted.json()));
 assert.equal(regen.schemaVersion,'ngs.npc-animation.regenerate.v2');
 assert.deepEqual(queue.list().requests.find(row=>row.requestType===animationRegenerateType).payload,regen);
 const base=newNpcBasicRequest({...source,...brief,slug:'seojin-v2',chapterId:'chapter01',includeCombat:true});
 assert.equal((await send('basic-v2',base)).status,202);
 assert.deepEqual(queue.list().requests.at(-1).payload,base);
 assert.equal((await send('basic-extra',{...base,priorNpcId:'character.seojin'})).status,400);
 const scoped={schemaVersion:portraitRegenerateSchema,projectId:'binari',npcId:'character.seojin',posePreset:'idle',scope:'directions',intent:'정면과 실루엣 유지'};
 const sendPortrait=(key,payload)=>fetch(origin+'/api/requests',{method:'POST',headers,
  body:JSON.stringify({requestType:portraitRegenerateType,idempotencyKey:key,payload})});
 assert.equal((await sendPortrait('scoped-no-target',{...scoped,npcId:'npc.missing'})).status,404);
 assert.equal((await sendPortrait('scoped-representative',{...scoped,posePreset:'representative'})).status,400);
 assert.equal((await sendPortrait('scoped-pixel-pin',{...scoped,pixel:true})).status,400);
 assert.equal((await sendPortrait('scoped-idle',scoped)).status,202);
 assert.deepEqual(queue.list().requests.at(-1).payload,scoped);
 const legacyRegen={...regen,schemaVersion:'ngs.npc-animation.regenerate.v1'};
 assert.equal((await sendRegen('legacy-npc-motion-only',legacyRegen)).status,202);
 assert.deepEqual(queue.list().requests.filter(row=>row.requestType===animationRegenerateType).at(-1).payload,legacyRegen);
 const wrongPose={...regen,motionSelection:regen.motionSelection.map(row=>row.posePreset==='combat'?{...row,posePreset:'idle'}:row)};
 assert.equal((await sendRegen('wrong-preset-pose',wrongPose)).status,409);

});

test('Local denies v2 replacement and animation-by-pose before any source read when separate opt-in is absent',async t=>{
 const fixture=await mkdtemp(join(realpathSync(tmpdir()),'ngs-npc-pose-default-'));
 const root=join(fixture,'projects');
 const server=createLocalProjectPageServer({root,audioWorkspaceEnabled:true,audioSeparationEnabled:true});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(fixture,{recursive:true,force:true});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port,r=await fetch(origin+'/__npcgen_session');
 const cookie=r.headers.get('set-cookie').split(';')[0],session=await r.json();
 assert.equal('poseSelectionV2Enabled' in session,false);
 const headers={cookie,origin,'content-type':'application/json','x-npcgen-csrf':session.csrfToken,'x-npcgen-frontend-context':session.contextId};
 const motionSelection=[motionSelectionOf(run)];
 const v2=newNpcOneStopRequest({...source,motionSelection},[run],true);
 const replace={...v2,schemaVersion:selectionReplaceSchemaVersion,character:{...v2.character,npcId:'character.seojin',slug:'seojin',actId:'act01',chapterId:'chapter01'}};
 for(const [requestType,payload] of [['npc.workflow',v2],['npc.workflow',replace],[animationRegenerateType,motionSelectionPayload(motionSelection)]]){
  const response=await fetch(origin+'/api/requests',{method:'POST',headers,
   body:JSON.stringify({requestType,idempotencyKey:'exact-stage-fixture',payload})});
  assert.equal(response.status,404);
  assert.deepEqual(await response.json(),{error:'NPC_POSE_SELECTION_V2_UNAVAILABLE'});
 }
});

test('animation tab picks exact registered variants and queues only those for the current NPC',async t=>{
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.textContent='';this.isConnected=true;}
  append(...items){this.children.push(...items);}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
  remove(){this.isConnected=false;}
  focus(){}
 }
 const previous=globalThis.document;
 globalThis.document={createElement:tag=>new Element(tag)};
 t.after(()=>{globalThis.document=previous;});
 const owner=new Element('section'),seen=[];
 const catalog=[choice('run','idle','달리기'),choice('run-flat','idle','달리기 3D Flat'),choice('run-2d','idle','달리기 2D'),
  choice('run-flat-2d','idle','달리기 Flat 2D'),attack,...extra];
 assert.deepEqual(catalog.slice(0,4).map(row=>npcPublishedMotionLabel('idle',row.presetId,catalog)),['달리기','달리기 3D Flat','달리기 2D','달리기 Flat 2D']);
 assert.equal(npcPublishedMotionLabel('combat','run-2d',catalog),null);
 const dispose=mountNpcAnimationRegenerate(owner,{npc:{id:'npc.ch1_dajeong',name:'다정'},intakes:new Map(),
  request:async url=>{assert.match(url,/view=selection$/);return {schemaVersion:motionCatalogSchema,presets:catalog};},
  submit:async command=>{seen.push(command);return Response.json({queueId:'ngs.local.00000000-0000-4000-8000-000000000000',status:'queued'},{status:202});}});
 const all=(el,tag)=>[...(el.tag===tag?[el]:[]),...el.children.flatMap(next=>all(next,tag))];
 all(owner,'button')[0].events.click();await Promise.resolve();await Promise.resolve();
 const dialog=all(owner,'dialog')[0],form=all(dialog,'form')[0];
 const send=all(form,'button')[0];assert.ok(send.disabled);
 const chosen=['run-flat','run-flat-2d',attack.presetId,...extra.map(row=>row.presetId)];
 for(const id of chosen){
  const item=all(form,'label').find(el=>el.children[1].textContent.endsWith(' · '+id));
  item.children[0].checked=true;
  item.children[0].events.change();
 }
 await form.events.submit({preventDefault(){}});
 assert.equal(seen.length,1);assert.equal(seen[0].requestType,animationRegenerateType);
 const pick=catalog.filter(row=>chosen.includes(row.presetId)).map(motionSelectionOf);
 assert.deepEqual(seen[0].payload,{...motionSelectionPayload(pick),schemaVersion:'ngs.npc-animation.regenerate.v1'});
 assert.equal(seen[0].payload.schemaVersion,'ngs.npc-animation.regenerate.v1');
 assert.equal(seen[0].payload.motionSelection.find(row=>row.presetId===attack.presetId).posePreset,'combat');
 assert.equal(validNpcAnimationRegenerate({...seen[0].payload,intent:'whole NPC'}),false);
 assert.throws(()=>npcAnimationRegenerateRequest('npc.ch1_dajeong',pick.map(row=>({...row,assetSetSha256:'f'.repeat(64)})),catalog));
 dispose();assert.equal(dialog.isConnected,false);
});
function motionSelectionPayload(motionSelection){
 return {schemaVersion:animationRegenerateSchema,projectId:'binari',npcId:'npc.ch1_dajeong',motionSelection};
}

const staleMotionPins=payload=>payload.motionSelection.map(row=>({...row,assetSetSha256:'1'.repeat(64)}));

test('renaming a registered label keeps the source pin and existing output identity',async()=>{
 const source=manifest('run-flat-2d');
 const from=await publishedMotionChoice('run-flat-2d',source,'달리기 Flat 2D');
 const changed=await publishedMotionChoice('run-flat-2d',{...source,label:'새 표시 이름'},'새 표시 이름');
 assert.deepEqual(motionSelectionOf(changed),motionSelectionOf(from));
 assert.equal(npcPublishedMotionLabel('idle','run-flat-2d',[changed]),'새 표시 이름');
 assert.equal(npcPublishedMotionLabel('idle','run-flat',[changed]),null);
 assert.deepEqual(npcAnimationRegenerateRequest('npc.ch1_dajeong',[motionSelectionOf(from)],[changed]),
  {...motionSelectionPayload([motionSelectionOf(from)]),schemaVersion:'ngs.npc-animation.regenerate.v1'});
});

test('empty selection only permits fresh NPC creation',()=>{
 for(const flag of [false,true]){
  const payload=newNpcOneStopRequest({...source,motionSelection:[]},[],flag);
  assert.deepEqual(payload.motionSelection,[]);
  assert.equal(validNpcMotionSelectionRequest(payload),true);
  assert.equal(validNpcMotionSelectionRequest({...payload,schemaVersion:selectionReplaceSchemaVersion}),false);
  assert.equal(validNpcAnimationRegenerate({...motionSelectionPayload([])}),false);
 }
});

test('basic creation is self-contained with optional combat and no inherited version or motion field',()=>{
 for(const includeCombat of [false,true]){
  const body=newNpcBasicRequest({...source,...brief,slug:'seojin-v3',name:'서진 v3',chapterId:'chapter01',includeCombat});
  assert.equal(body.character.npcId,'npc.seojin-v3');
  for(const value of Object.values(brief))assert.ok(body.intent.includes(value));assert.equal(body.includeCombat,includeCombat);
  assert.deepEqual(Object.keys(body).sort(),['character','includeCombat','intent','projectId','schemaVersion','sourceRefs']);
 }
 assert.throws(()=>newNpcBasicRequest({...source,...brief,chapterId:'chapter01',includeCombat:'yes'}));
 for(const key of Object.keys(brief)){
  assert.throws(()=>newNpcBasicRequest({...source,...brief,chapterId:'chapter01',includeCombat:false,[key]:'  '}));
 }
 const optional=newNpcBasicRequest({...source,...brief,chapterId:'chapter01',includeCombat:false,notes:'과한 장신구 금지'});
 assert.match(optional.intent,/추가 요청: 과한 장신구 금지/);
 assert.deepEqual(optional.sourceRefs,['사용자 기획 요청']);
});
test('scoped portrait commands accept just the two mutable poses and two original scopes',()=>{
 const scoped={schemaVersion:portraitRegenerateSchema,projectId:'binari',npcId:'character.seojin',intent:''};
 for(const posePreset of ['idle','combat'])for(const scope of ['reference-and-directions','directions'])
  assert.equal(validNpcPortraitRegeneration({...scoped,posePreset,scope}),true);
 assert.equal(validNpcPortraitRegeneration({...scoped,posePreset:'representative',scope:'directions'}),false);
 assert.equal(validNpcPortraitRegeneration({...scoped,posePreset:'idle',scope:'pixel'}),false);
});

test('combat request box opens only when selected and is sent apart from the common brief',async t=>{
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.dataset={};this.textContent='';this.isConnected=true;}
  append(...items){this.children.push(...items);}
  before(el){this.parent?.append(el);}
  querySelector(sel){return sel==='h3'?this.children.find(c=>c.tag==='h3'):null;}
  replaceChildren(...items){this.children=items;}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
  remove(){this.isConnected=false;}
  focus(){}
 }
 const previous=globalThis.document;
 globalThis.document={createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text})};
 t.after(()=>{globalThis.document=previous;});
 const ac=new AbortController(),owner=new Element('div'),heading=new Element('h3'),seen=[];
 heading.parent=owner;owner.append(heading);
 const all=(el,tag)=>[...(el.tag===tag?[el]:[]),...el.children.flatMap(next=>next?.children?all(next,tag):[])];
 const trigger=mountNpcOneStop(owner,{signal:ac.signal,basic:true,request:()=>assert.fail('no motion catalog access'),
  submit:async command=>{seen.push(command);return Response.json({queueId:'ngs.local.00000000-0000-4000-8000-000000000000',status:'queued'},{status:202});}});
 trigger.events.click();
 const form=all(owner,'form')[0],labels=all(form,'label');
 const combat=all(form,'input').find(el=>el.type==='checkbox');
 const box=labels.find(el=>el.textContent.startsWith('전투 추가 요청'));
 assert.equal(box.hidden,true);assert.equal(box.children[0].disabled,true);
 combat.checked=true;combat.events.change();assert.equal(box.hidden,false);assert.equal(box.children[0].disabled,false);
 box.children[0].value='오른손 환도';
 combat.checked=false;combat.events.change();assert.equal(box.hidden,true);
 combat.checked=true;combat.events.change();
 for(const [label,value] of Object.entries({'이름':'서진 v2','ID (식별 이름)':'seojin-v2','직업·이야기 속 역할 (필수)':'별감',
  '목표·등장 이유 (필수)':brief.goal,'성격·평소 행동 (필수)':brief.behavior,'퍼스널 컬러 (필수)':brief.palette,'외형·복식의 단서 (필수)':brief.appearance})){
  labels.find(el=>el.textContent===label).children[0].value=value;
 }
 await form.events.submit({preventDefault(){}});
 assert.equal(seen.length,1);assert.equal(seen[0].payload.includeCombat,true);
 assert.equal(seen[0].payload.combatRequirements,'오른손 환도');assert.doesNotMatch(seen[0].payload.intent,/환도/);
 assert(!Object.hasOwn(newNpcBasicRequest({...source,...brief,chapterId:'chapter01',includeCombat:false,combatRequirements:'오른손 환도'}),'combatRequirements'));
 ac.abort();
});
