import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {localProjectWorkspace,openLocalWorkspaceProject} from '../ngs-local/sites/npcgen/build/local-project-workspace.mjs';
import {canonicalPropPackage} from '../ngs-local/sites/npcgen/build/prop-package-contract.mjs';
import {workspaceReadRegistry,dispatchWorkspaceRead} from '../ngs-local/sites/npcgen/build/workspace-read-registry.mjs';
import {spaceWorkspaceReadResponse} from '../build/space-workspace-read-response.mjs';
import {openSpaceWorkspaceProject} from '../build/space-workspace-read-storage.mjs';

const hash=raw=>createHash('sha256').update(raw).digest('hex'),official='request.official.'+'d'.repeat(64);
function fixture(t){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'read-parity-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const project=join(root,'binari');mkdirSync(project,{mode:0o700});
 const files=new Map(),logo=Buffer.from([137,80,78,71,13,10,26,10,1]),name=hash(logo)+'.png';
 const content=Buffer.from('# Project premise\nA shared concept.\n');
 const itemId='tone',motionId='walk',mediaName=hash(Buffer.from('1234ftyp...'))+'.mp4';
 function add(path,raw){
  const value=Buffer.isBuffer(raw)?raw:Buffer.from(JSON.stringify(raw));files.set(path,value);
  mkdirSync(dirname(join(project,path)),{recursive:true,mode:0o700});writeFileSync(join(project,path),value,{mode:0o600});
 }
 add('project.json',{name:'Binari'});
 add('concept/metadata.json',{sectionIds:[itemId,'archive'],document:{hierarchy:{schemaVersion:'npc-concept-groups.v1',
  groups:[{id:'group.sound',title:'Sound',categoryIds:[itemId]}],archivedCategoryIds:['archive']}},
  _markdownSections:{[itemId]:{mode:'authored',priority:1,sha256:hash(content),title:'Tone'}}});
 add('concept/sections/tone/content.md',content);
 add('concept/sections/archive/metadata.json',{id:'archive',title:'Unpublished'});
 add('npcs/da/metadata.json',{id:'da',name:'Dajeong',activePortraitId:name,portraits:[{assetId:name}]});
 add('npcs/da/assets/'+name,logo);
 add('motion-presets/presets/'+motionId+'.json',{presetId:motionId,label:'Walk',posePreset:'idle',
  directions:[{direction:'n',assetId:mediaName,sha256:mediaName.slice(0,64)}]});
 add('motion-presets/assets/'+mediaName,Buffer.from('1234ftyp...'));
 const variantMarker={kind:'2d',sourcePresetId:motionId,sourcePresetHash:'f'.repeat(64)};
 const variantDirections=['n','ne','e','se','s','sw','w','nw'].map(direction=>{
  const raw=Buffer.from('1234ftyp-clip-'+direction),sha256=hash(raw),assetId=sha256+'.mp4';
  add('motion-presets/assets/'+assetId,raw);
  return {direction,assetId,sha256,bytes:raw.length,frameCount:25,fps:24,cycleCount:1};
 });
 add('motion-presets/presets/walk-2d.json',{schemaVersion:'ngs.motion-preset.v1',presetId:'walk-2d',label:'Walk 2D',posePreset:'idle',variant:variantMarker,directions:variantDirections});
 for(const [id,variant] of Object.entries({
  'bad-extra':{...variantMarker,wrong:'unexpected'},'bad-hash':{...variantMarker,sourcePresetHash:'x'.repeat(64)},
  'bad-path':{...variantMarker,sourcePresetId:'../walk'},'bad-null':null,
  'bad-case':{...variantMarker,sourcePresetId:'BAD-CASE'},
 })){
  add('motion-presets/presets/'+id+'.json',{presetId:id,label:id,posePreset:'combat',variant,directions:variantDirections});
 }

 add('audio/'+official+'/metadata.json',{private:'not visible from any workspace tab'});
 const metric={list:0,head:0,get:0},prefixes=[],touches=[];
 const space={
  async list(prefix=''){metric.list++;prefixes.push(prefix);return [...files].filter(([p])=>!prefix||p.startsWith(prefix+'/')).map(([path,x])=>({path,sha256:hash(x)}));},
  async head(path){touches.push(path);metric.head++;const x=files.get(path);return x?{size:x.length,etag:hash(x),customMetadata:{sha256:hash(x)}}:null;},
  async get(path,{onlyIf}){touches.push(path);metric.get++;const x=files.get(path);return x&&onlyIf.etagMatches===hash(x)?{
   size:x.length,etag:hash(x),customMetadata:{sha256:hash(x)},arrayBuffer:async()=>new Uint8Array(x).buffer,
  }:null;},
 };
 return {root,space,metric,prefixes,touches,add,asset:'npcs/da/assets/'+name,clip:'motion-presets/assets/'+mediaName};
}
const request=(query,auth=true)=>new Request('https://fixture.invalid/api/project-workspace?'+query,{headers:auth?{
 'oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'fixture@example.invalid',
}:{}});
test('all project tabs and authorized files use identical DTOs from disk and hosted replica',async t=>{
 const {root,space,asset,clip,prefixes}=fixture(t);
 for(const query of [
  'tab=concept','tab=concept&item=tone','tab=concept&item=tone&file=concept/sections/tone/content.md','tab=npcs',
  'tab=npcs&item=da','tab=npcs&item=da&file='+asset,'tab=motion-presets','tab=motion-presets&item=walk',
  'tab=motion-presets&item=walk&file='+clip,
 ]){
  const req='projectId=binari&'+query,local=await localProjectWorkspace({root,query:new URLSearchParams(req),authorize:id=>assert.equal(id,'binari')});
  const response=await spaceWorkspaceReadResponse(request(req),space,{authorize:async(_u,p)=>p==='binari'});
  assert.equal(response.status,200,query);
  if(local.json)assert.deepEqual(await response.json(),local.json,query);
  else{
   assert.equal(response.headers.get('Content-Type'),local.mime);
   assert.deepEqual(Buffer.from(await response.arrayBuffer()),local.bytes);
  }
 }
 const local=openLocalWorkspaceProject(root,'binari'),remote=openSpaceWorkspaceProject(space,'binari');
 const a=(await local.listFiles('npcs')).map(x=>x.path).sort(),b=(await remote.listFiles('npcs')).map(x=>x.path).sort();
 assert.deepEqual(a,b);
 assert.ok(prefixes.includes('npcs'));assert.ok(prefixes.includes('motion-presets/presets'));
 assert.ok(prefixes.every(Boolean),'detail views must not enumerate the whole project');
});
test('ungranted visitors cannot run storage reads, and files outside selected assets stay hidden',async t=>{
 const {space,metric}=fixture(t);
 const query='projectId=binari&tab=concept';
 assert.equal((await spaceWorkspaceReadResponse(request(query,false),space,{authorize:async()=>true})).status,401);
 assert.equal((await spaceWorkspaceReadResponse(request(query),space,{authorize:async()=>false})).status,403);
 assert.deepEqual(metric,{list:0,head:0,get:0});
 for(const string of [
  query+'&item=archive',
  query+'&item=tone&file=audio/'+official+'/metadata.json',
  query+'&item=tone&file=concept/sections/archive/metadata.json',
 ])assert.equal((await spaceWorkspaceReadResponse(request(string),space,{authorize:async()=>true})).status,404);
});
test('one registry declares workspace routes and the view cannot import either storage engine',()=>{
 assert.deepEqual(workspaceReadRegistry,{'/api/project-workspace':'project','/api/npc-workspace':'npc','/api/prop-workspace':'prop'});
 for(const path of ['project-workspace-view','workspace-read-storage','workspace-read-registry']){
  const source=readFileSync(new URL('../ngs-local/sites/npcgen/build/'+path+'.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(source,/(?:from ['"](?:node:fs|node:path|cloudflare:workers)|\b(?:process\.env|R2Bucket|D1Database)\b)/);
 }
});

test('shared NPC conflict and its exact error are not downgraded by the hosted adapter',async()=>{
 const response=await spaceWorkspaceReadResponse(new Request('https://fixture.invalid/api/npc-workspace?projectId=binari',{
  headers:{'oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'fixture@example.invalid'}
 }),undefined,{
  authorize:async()=>true,npcRead:async()=>{throw Object.assign(Error('NPC_WORKSPACE_MEDIA_CHANGED'),{status:409});}
 });
 assert.equal(response.status,409);
 assert.deepEqual(await response.json(),{error:'NPC_WORKSPACE_MEDIA_CHANGED'});
});

test('strict canonical 2D lineage retains all previews on both hosts; corrupt markers never become eligible originals',async t=>{
 const {root,space}=fixture(t);
 const base='projectId=binari&tab=motion-presets';
 const local=async query=>(await localProjectWorkspace({root,query:new URLSearchParams(query),authorize:()=>true})).json;
 const hosted=async query=>spaceWorkspaceReadResponse(request(query),space,{authorize:async()=>true});
 const list=await local(base);
 assert.deepEqual(list.items.map(i=>i.id).sort(),['walk','walk-2d']);
 assert.deepEqual(await (await hosted(base)).json(),list);
 const query=base+'&item=walk-2d',loaded=await local(query);
 assert.deepEqual(await (await hosted(query)).json(),loaded);
 assert.deepEqual(loaded.motionPreset.variant,{kind:'2d',sourcePresetId:'walk',sourcePresetHash:'f'.repeat(64)});
 assert.equal(loaded.motionPreset.directions.length,8);
 assert.ok(loaded.motionPreset.directions.every(d=>d.path));
 assert.equal(Object.hasOwn((await local(base+'&item=walk')).motionPreset,'variant'),false);
 for(const id of ['bad-extra','bad-hash','bad-path','bad-null','bad-case']){
  await assert.rejects(local(base+'&item='+id),e=>e.status===404);
  assert.equal((await hosted(base+'&item='+id)).status,404);
 }
});

test('Local and Space selection manifests match; neither probes MP4 assets',async t=>{
 const {root,space,touches,prefixes}=fixture(t),query='projectId=binari&tab=motion-presets&view=selection';
 const local=await localProjectWorkspace({root,query:new URLSearchParams(query),authorize:()=>true});
 const r=await spaceWorkspaceReadResponse(request(query),space,{authorize:async()=>true});
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),local.json);
 assert.deepEqual(local.json.presets.map(row=>row.presetId),['walk-2d']);
 assert.ok(touches.every(path=>path.startsWith('motion-presets/presets/')&&path.endsWith('.json')));
 assert.deepEqual(prefixes,['motion-presets/presets']);
});

test('same prop roster and pinned detail across Local/Space; hosted denies before touching replica',async t=>{
 const {root,space,metric,touches,add}=fixture(t);
 const propId='paper-candle',p='props/'+propId, h='a'.repeat(64);
 const img=(sha256,width)=>({assetId:sha256+'.png',sha256,bytes:80,width,height:width,
  mediaType:'image/png',frameDurationsMs:[]});
 const doc=Buffer.from(canonicalPropPackage({schemaVersion:'ngs.prop-package.v1',projectId:'binari',propId,revision:1,
  officialRequestId:official,requestSha256:h,designContextSha256:h,title:'Candle fixture',parentSha256:null,
  media:{detail:img(h,40),pixel:img('b'.repeat(64),20)},interaction:{pixelOpen:null,detailTrigger:null},animations:[]}));
 const pointer={schemaVersion:'ngs.prop-pointer.v1',projectId:'binari',propId,title:'Candle fixture',revision:1,sha256:hash(doc)};
 add(p+'/metadata.json',pointer);
 add(p+'/releases/1/manifest.json',doc);
 add(p+'/assets/'+h+'.png',Buffer.alloc(80));
 const endpoint='/api/prop-workspace';
 const get=qs=>new Request('https://fixture.invalid'+endpoint+'?'+qs,{headers:{
  'oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'fixture@example.invalid',
 }});
 assert.equal((await spaceWorkspaceReadResponse(get('projectId=binari'),space,{authorize:async()=>false})).status,403);
 assert.deepEqual(metric,{list:0,head:0,get:0});
 const authorize=async(_u,project,resource)=>project==='binari'&&resource==='props';
 for(const q of ['projectId=binari','projectId=binari&propId='+propId]){
  const actual=await spaceWorkspaceReadResponse(get(q),space,{authorize});
  const local=await dispatchWorkspaceRead({pathname:endpoint,query:new URLSearchParams(q),
    openProject:id=>openLocalWorkspaceProject(root,id),authorize:(project,resource)=>{
     assert.equal(project,'binari');assert.equal(resource,'props');
    }});
  assert.equal(actual.status,200);
  assert.deepEqual(await actual.json(),local.json);
 }
 assert.ok(touches.length>0&&touches.every(path=>path.startsWith(p+'/')&&!path.includes('/assets/')));
});
