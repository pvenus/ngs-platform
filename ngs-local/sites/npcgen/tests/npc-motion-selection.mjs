import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';import {realpathSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';import {openLocalRequestQueue} from '../build/local-request-queue.mjs';
import {workspaceRead} from '../build/project-workspace-view.mjs';
import {mountNpcOneStop,newNpcOneStopRequest,readOneStopMotionPresets} from '../build/local-npc-one-stop-ui.mjs';
import {motionCatalogSchema,motionDirections,motionSelectionOf,publishedMotionChoice,quickMotionSelection,
 selectionReplaceSchemaVersion,selectionSchemaVersion,validMotionSelection,validNpcMotionSelectionRequest} from '../build/npc-motion-selection.mjs';
const digest=value=>createHash('sha256').update(value).digest('hex');
const variant={kind:'2d',sourcePresetId:'run',sourcePresetHash:'a'.repeat(64)};
const choice=(presetId,posePreset='idle',label=presetId,marker='1')=>({presetId,posePreset,label,assetSetSha256:marker.repeat(64)});
const walk=choice('walk-flat'),run=choice('run-flat'),run2d=choice('run-2d'),attack=choice('sword-attack-flat','combat');
const direct=['walk-flat','run-flat','run-2d','sword-attack-flat'];
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
 assert.equal(body.schemaVersion,selectionSchemaVersion);assert.deepEqual(body.motionSelection,selected);
 assert.equal(validNpcMotionSelectionRequest({...body,schemaVersion:selectionReplaceSchemaVersion}),true);
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
 let catalog=[walk,run,run2d,attack],seen=[];
 const trigger=mountNpcOneStop(owner,{signal:ac.signal,request:async(url,options)=>{
  assert.match(url,/view=selection$/);assert.equal(options.signal.aborted,false);
  return {schemaVersion:motionCatalogSchema,presets:catalog};
 },submit:async command=>{seen.push(command);return Response.json({queueId:'ngs.local.00000000-0000-4000-8000-000000000000',status:'queued'},{status:202});}});
 trigger.events.click();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 const modal=all(owner,'dialog')[0],form=all(modal,'form')[0],buttons=all(modal,'button');
 const click=label=>buttons.find(b=>b.textContent===label).events.click();
 const check=id=>all(modal,'label').find(c=>c.children[1]?.textContent?.includes(' · '+id))?.children[0];
 const set=(id,checked)=>{const c=check(id);c.checked=checked;c.events.change();};
 assert.equal(timers.size,1);assert.equal(buttons.at(-1).disabled,true);
 click('전투 기본');assert.equal(check('walk-flat').checked,true);assert.equal(check('run-flat').checked,true);assert.equal(check('sword-attack-flat').checked,true);
 set('run-flat',false);set('run-2d',true);
 catalog=[walk,run,choice('run-2d','idle','새 결과','2'),attack,choice('new')];
 const [timer,next]=timers.entries().next().value;timers.delete(timer);await next();
 assert.equal(check('new').checked,false);
 assert.equal(check('run-2d').checked,true);
 assert.equal(buttons.at(-1).disabled,true,'old fingerprint cannot be silently substituted');
 set('run-2d',false);set('run-2d',true);
 assert.equal(buttons.at(-1).disabled,false);
 const requestInputs=all(form,'input').filter(i=>i.type!=='checkbox'),areas=all(form,'textarea');
 Object.assign(requestInputs[0],{value:source.name});Object.assign(requestInputs[1],{value:source.slug});Object.assign(requestInputs[2],{value:source.role});
 areas[0].value=source.intent;areas[1].value=source.sourceRefs;
 await form.events.submit({preventDefault(){}});
 assert.equal(seen.length,1);
 assert.deepEqual(seen[0].payload.motionSelection.map(row=>row.presetId),['walk-flat','sword-attack-flat','run-2d']);
 assert.equal(seen[0].payload.motionSelection[2].assetSetSha256,'2'.repeat(64));
 ac.abort();assert.equal(timers.size,0);
});

test('Local browser queue validates selected publication hashes without reading absent MP4s',async t=>{
 const tmp=await mkdtemp(join(realpathSync(tmpdir()),'ngs-npc-motion-selection-')),root=join(tmp,'root');
 const project=join(root,'binari'),presets=join(project,'motion-presets','presets');
 await mkdir(presets,{recursive:true,mode:0o700});
 await writeFile(join(project,'project.json'),JSON.stringify({name:'Binari fixture'}),{mode:0o600});
 for(const selected of [run2d,attack]){
  const raw=manifest(selected.presetId,selected.posePreset,selected===run2d?{variant}:{});
  await writeFile(join(presets,selected.presetId+'.json'),JSON.stringify(raw),{mode:0o600});
 }
 const queue=openLocalRequestQueue(join(tmp,'queue.sqlite')),server=createLocalProjectPageServer({root,requestQueue:queue});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));queue.close();await rm(tmp,{recursive:true,force:true});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const r=await fetch(origin+'/__npcgen_session'),cookie=r.headers.get('set-cookie').split(';')[0],session=await r.json();
 const headers={cookie,origin,'content-type':'application/json','x-npcgen-csrf':session.csrfToken,'x-npcgen-frontend-context':session.contextId};
 const res=await fetch(origin+'/api/project-workspace?projectId=binari&tab=motion-presets&view=selection',{headers:{cookie}});
 assert.equal(res.status,200);
 const catalog=(await res.json()).presets;
 assert.deepEqual(catalog.map(row=>row.presetId),['run-2d','sword-attack-flat']);
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
});
