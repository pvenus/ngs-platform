import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {machineResponse,browserQueueResponse,spaceQueueParticipant,spaceWorkspacePrincipal,authorizeSpaceQueueWrite} from '../build/space-machine-routes.mjs';
import {workspaceReleaseCapabilities} from '../ngs-local/sites/npcgen/build/workspace-release-capabilities.mjs';
import {SpaceRequestQueue,officialIdForSpace} from '../build/space-request-queue.mjs';

const origin='https://site.example';
const token='a'.repeat(64);
const headers=id=>({'oai-authenticated-user-id':id,'oai-authenticated-user-email':id+'@example.invalid'});
const command={requestType:'audio.generate',idempotencyKey:'sample',payload:{schemaVersion:'ngs.audio-generate.v1',projectId:'binari',
 kind:'bgm',title:'test',brief:'fixture',conceptId:'sound',text:'',durationSeconds:null}};
const request=(path,method='GET',headers={},value)=>new Request(origin+path,{method,headers:{
 ...(method==='POST'?{'Content-Type':'application/json'}:{}),...headers},...(value===undefined?{}:{body:JSON.stringify(value)})});
const migration=new URL('../drizzle/0013_space_request_queue.sql',import.meta.url);
function store(t){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(migration,'utf8'));t.after(()=>db.close());
 return {prepare(sql){return {bind(...args){const s=db.prepare(sql);return {
  first:async()=>s.get(...args),all:async()=>({results:s.all(...args)}),run:async()=>s.run(...args),
 };}};}};
}
function fixture(t){
 const db=store(t),options={db,secret:token,authorize:async user=>user.userId!=='denied',authorizeWrite:async user=>user.userId==='a'};
 const browser=(...input)=>browserQueueResponse(request(...input),options);
 const machine=(method,params={},extra={})=>machineResponse(request('/api/space-machine-mcp','POST',{'X-NGS-Machine-Token':token,...extra},
  {jsonrpc:'2.0',id:1,method,params}),options);
 return {db,browser,machine};
}
test('native browser queue is actor-bound, same-origin only, idempotent, and not an official receipt',async t=>{
 const {browser}=fixture(t),a=headers('a'),b=headers('b');
 assert.equal((await browser('/__npcgen_session')).status,401);
 assert.equal((await browser('/__npcgen_session','GET',headers('denied'))).status,403);
 const session=await (await browser('/__npcgen_session','GET',a)).json();
 assert.equal(session.readOnly,true);assert.equal(session.backend,'space');assert.equal(session.queueEnabled,true);assert.equal(session.requestWritable,true);
 assert.ok(!JSON.stringify(session).includes(token));
 const h={...a,Origin:origin,'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId};
 assert.equal((await browser('/api/requests','POST',{...h,Origin:'https://wrong.example'},command)).status,403);
 assert.equal((await browser('/api/requests','POST',{...h,'X-NPCGen-Csrf':'x'},command)).status,403);
 assert.equal((await browser('/api/requests','POST',{...h,...b},command)).status,403);
 const bs=await (await browser('/__npcgen_session','GET',b)).json();assert.equal(bs.requestWritable,false);
 assert.equal((await browser('/api/requests','POST',{...b,Origin:origin,
  'X-NPCGen-Csrf':bs.csrfToken,'X-NPCGen-Frontend-Context':bs.contextId},command)).status,403);
 const submit=await browser('/api/requests','POST',h,command),receipt=await submit.json(),q=receipt.queueId;
 assert.equal(submit.status,202);assert.deepEqual(receipt,{queueId:q,status:'queued'});assert.match(q,/^ngs\.space\./);
 assert.deepEqual(await (await browser('/api/requests','POST',h,command)).json(),receipt);
 assert.equal((await browser('/api/requests','POST',h,{...command,payload:{...command.payload,title:'changed'}})).status,409);
 assert.equal((await browser('/api/requests','POST',h,{...command,payload:{...command.payload,projectId:'other'}})).status,400);
 assert.equal((await browser('/api/requests','GET',b)).status,200);
 assert.deepEqual(await (await browser('/api/requests','GET',b)).json(),{requests:[]});
 assert.equal((await browser('/api/requests?queueId='+q,'GET',b)).status,404);
 assert.deepEqual(await (await browser('/api/requests?queueId='+q,'GET',a)).json(),receipt);
});
test('only authenticated active Binari participants can use the existing formal queue, independent of Site role',async t=>{
 const db=store(t);
 const grants={owner:{projectId:'binari',role:'owner'},viewer:{projectId:'binari',role:'viewer'},
  editor:{projectId:'binari',role:'editor'},revoked:{projectId:'binari',role:'viewer'},
  otherProject:{projectId:'other',role:'owner'},unknownRole:{projectId:'binari',role:'admin'}};
 const options={db,secret:token,replicaReads:true,workspaceReady:true,
  authorize:async user=>user.userId!=='revoked',
  authorizeWrite:async user=>spaceQueueParticipant(grants[user.userId])};
 const browser=(...args)=>browserQueueResponse(request(...args),options);
 const load=id=>browser('/__npcgen_session','GET',headers(id));
 const write=(id,c,cmd=command,h={})=>browser('/api/requests','POST',{
  ...headers(id),Origin:origin,'X-NPCGen-Csrf':c?.csrfToken,'X-NPCGen-Frontend-Context':c?.contextId,...h},cmd);
 for(const id of ['owner','viewer','editor']){
  const c=await (await load(id)).json();
  assert.equal(c.workspaceReady,true);assert.equal(c.requestWritable,true);
 }
 const viewer=await (await load('viewer')).json(),owner=await (await load('owner')).json();
 const base={projectId:'binari'};
 const concept={...base,schemaVersion:'ngs.concept-category-workflow.v1',title:'Fixture',categoryId:'sample',
  groupId:null,outline:'',requirements:''};
 const commands=[
  command,
  {requestType:'motion-preset.convert-2d',payload:{...base,schemaVersion:'ngs.motion-preset-convert-2d.v1',
   sourcePresetId:'walk',variantPresetId:'walk-2d',label:'걷기 · 2D 마네킹'}},
  {requestType:'audio.delete',payload:{...base,schemaVersion:'ngs.audio-delete.v1',officialRequestId:'request.official.'+'a'.repeat(64)}},
  {requestType:'npc.workflow',payload:{...base,schemaVersion:'ngs.npc-one-stop.v1',character:{
   npcId:'npc.sample',slug:'sample',name:'Fixture',role:'test',actId:'act1',chapterId:'ch1'},intent:'Fixture',sourceRefs:['Test'],includeCombat:false}},
  {requestType:'npc.workflow',payload:{...base,schemaVersion:'ngs.npc-one-stop.selection.v1',character:{
   npcId:'npc.sample',slug:'sample',name:'Fixture',role:'test',actId:'act1',chapterId:'ch1'},intent:'Fixture',sourceRefs:['Test'],
   motionSelection:[{presetId:'run-2d',posePreset:'idle',assetSetSha256:'a'.repeat(64)},
    {presetId:'sword-attack-flat',posePreset:'combat',assetSetSha256:'b'.repeat(64)}]}},
  {requestType:'npc.planning.add',payload:{...base,schemaVersion:'ngs.npc-planning-add.v1',npcId:'npc.sample',
   categoryId:'category.add.'+'a'.repeat(32),title:'Fixture',outline:'Test',requirements:'',requiredSections:['Test']}},
  {requestType:'npc.planning.update',payload:{...base,schemaVersion:'ngs.npc-planning-update.v1',npcId:'npc.sample',role:'overview',requirements:'Test'}},
  {requestType:'concept.category.workflow',payload:{...concept,operation:'remove'}},
  {requestType:'concept.category.workflow',payload:{...concept,operation:'update',requirements:'Test'}},
  {requestType:'concept.category.workflow',payload:{...concept,operation:'add',categoryId:'category.add.'+'b'.repeat(32),
   outline:'Test',groupId:'group.sound',requiredSections:['Test']}},
  {requestType:'npc.animation.regenerate',payload:{...base,schemaVersion:'ngs.npc-animation.regenerate.v1',npcId:'npc.sample',
   motionSelection:[{presetId:'run-flat',posePreset:'idle',assetSetSha256:'a'.repeat(64)},
    {presetId:'run-flat-2d',posePreset:'idle',assetSetSha256:'b'.repeat(64)}]}},

 ];
 const oldSelection=commands.find(({payload})=>payload.schemaVersion==='ngs.npc-one-stop.selection.v1');

 for(const [i,cmd] of commands.entries()){
  const response=await write('viewer',viewer,{...cmd,idempotencyKey:'fixture-'+i});
  assert.equal(response.status,202,JSON.stringify(await response.json()));
 }
 for(const id of ['audienceOnly','otherProject','unknownRole']){
  const c=await (await load(id)).json();
  assert.equal(c.requestWritable,false);
  assert.equal((await write(id,c,command,{'X-Role':'owner'})).status,403);
 }
 assert.equal((await load('revoked')).status,403);
 assert.equal((await write('revoked',viewer)).status,403);
 assert.equal((await write('viewer',owner)).status,403);
 assert.equal((await write('viewer',viewer,command,{Origin:'https://other.example'})).status,403);
 for(const bad of [
  {...commands[4],idempotencyKey:'bad-motion-legacy-field',payload:{...commands[4].payload,includeCombat:false}},
  {...commands[4],idempotencyKey:'bad-motion-hash',payload:{...commands[4].payload,
   motionSelection:[{presetId:'run-2d',posePreset:'idle',assetSetSha256:'unverified'}]}},

  {requestType:'motion-preset.convert-2d',idempotencyKey:'bad-missing-target',payload:{projectId:'binari',schemaVersion:'ngs.motion-preset-convert-2d.v1',sourcePresetId:'walk',variantPresetId:'walk',label:'겹치는 원본'}},
  {...command,requestType:'site.deploy'},
  {...command,requestType:'project.member.add'},
  {...command,payload:{...command.payload,projectId:'outside'}},
  {...command,payload:{...command.payload,targetDurationSeconds:59}},
  {...command,actorId:'owner'},
 ]) assert.equal((await write('viewer',viewer,bad)).status,400);
 assert.equal((await write('owner',owner,{...command,payload:{...command.payload,targetDurationSeconds:60}})).status,202);
 assert.equal((await browser('/api/requests','GET',headers('owner')).then(r=>r.json())).requests.length,1);
 assert.equal((await browser('/api/requests','GET',headers('viewer')).then(r=>r.json())).requests.length,commands.length);
 for(const path of ['/api/space/audio-requests','/api/npc-one-stop','/mcp','/api/site/access']){
  assert.equal(await browser(path,'POST',headers('viewer'),command),null);
 }
});

test('an old extra email setting does not grant a non-member access',async t=>{
 const db=store(t);
 const digest=createHash('sha256').update('guest@example.invalid').digest('hex');
 const participant=async({userId})=>{
  if(userId==='viewer')return {projectId:'binari',role:'viewer'};
  throw Object.assign(Error('MASTER_CONCEPT_PARTICIPANT_DENIED'),{status:403});
 };
 const route=(...args)=>browserQueueResponse(request(...args),{
  db,secret:token,authorize:async()=>true,
  authorizeWrite:user=>authorizeSpaceQueueWrite(user,participant,digest)});
 const guest=await (await route('/__npcgen_session','GET',headers('guest'))).json();
 assert.equal(guest.requestWritable,false);
 assert.equal((await route('/api/requests','POST',{...headers('guest'),Origin:origin,
  'X-NPCGen-Csrf':guest.csrfToken,'X-NPCGen-Frontend-Context':guest.contextId},command)).status,403);
 const viewer=await (await route('/__npcgen_session','GET',headers('viewer'))).json();
 assert.equal(viewer.requestWritable,true);
});

test('machine auth cannot come from visitor headers, browser Origin, or wrong token; discovers only narrow approved tools',async t=>{
 const {machine,db}=fixture(t);
 assert.equal(await machineResponse(request('/mcp','POST',headers('a'),{}),{db,secret:token}),null);
 assert.equal((await machineResponse(request('/api/space-machine-mcp','POST',headers('a'),{}),{db,secret:token})).status,403);
 assert.equal((await machineResponse(request('/mcp','POST',{'X-NGS-Machine-Token':token},{}),{db,secret:token})).status,404);
 assert.equal((await machine('tools/list',{}, {'X-NGS-Machine-Token':'c'.repeat(64),...headers('a')})).status,403);
 assert.equal((await machine('tools/list',{}, {Origin:origin})).status,403);
 assert.equal((await machine('tools/list',{}, {'Sec-Fetch-Site':'same-origin'})).status,403);
 assert.equal((await machineResponse(request('/api/requests','POST',{'X-NGS-Machine-Token':token},{}),{db,secret:token})).status,404);
 const methods=await (await machine('tools/list')).json();
 assert.deepEqual(methods.result.tools.map(tool=>tool.name),['space_requests_pending','space_requests_get','space_requests_ack','space_ngs_deployment_status']);
 assert.equal((await (await machine('tools/call',{name:'npc_mirror_dispatch',arguments:{}})).json()).error.code,-32602);
 assert.equal((await (await machine('tools/call',{name:'space_requests_pending',arguments:{projectId:'other'}})).json()).result.isError,true);
});
test('machine exact pending/get and ack verify official source hash, clear payload, and preserve own browser receipt',async t=>{
 const {db,machine,browser}=fixture(t),queue=new SpaceRequestQueue(db),a=headers('a');
 const session=await (await browser('/__npcgen_session','GET',a)).json();
 const q=(await (await browser('/api/requests','POST',{...a,Origin:origin,
  'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId},command)).json()).queueId;
 async function call(name,args){return (await (await machine('tools/call',{name,arguments:args})).json()).result;}
 const expected={queueId:q,idempotencyKey:q,requestType:command.requestType,payload:command.payload};
 const list=(await call('space_requests_pending',{limit:1})).structuredContent;
 assert.deepEqual(list.requests,[expected]);assert.match(list.nextCursor,/^q1\./);
 assert.deepEqual((await call('space_requests_pending',{cursor:list.nextCursor})).structuredContent,{requests:[]});
 assert.deepEqual((await call('space_requests_get',{queueId:q})).structuredContent,expected);
 const officialRequestId=await officialIdForSpace(q),receipt={officialRequestId,status:'planned',registeredAt:Date.now()};
 assert.equal((await call('space_requests_ack',{queueId:q,receipt:{...receipt,officialRequestId:'request.official.'+'f'.repeat(64)}})).isError,true);
 assert.equal((await call('space_requests_ack',{queueId:q,receipt:{officialRequestId,status:'registered'}})).isError,true);
 for(let i=0;i<2;i++)assert.deepEqual((await call('space_requests_ack',{queueId:q,receipt})).structuredContent,{queueId:q,status:'acknowledged'});
 assert.deepEqual(await queue.pending({}),{requests:[]});
 assert.equal((await call('space_requests_get',{queueId:q})).structuredContent.status,404);
 assert.deepEqual(await (await browser('/api/requests?queueId='+q,'GET',a)).json(),{queueId:q,status:'registered',receipt:{officialRequestId,status:'registered'}});
 assert.equal((await db.prepare('SELECT payload FROM ngs_space_request_queue_v1 WHERE queue_id=?').bind(q).first()).payload,null);
});

test('Space browser and machine preserve direct concept and both lyric modes',async t=>{
 const {db,browser}=fixture(t),queue=new SpaceRequestQueue(db),a=headers('a');
 const session=await (await browser('/__npcgen_session','GET',a)).json();
 const auth={...a,Origin:origin,'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId};
 const base={...command.payload,conceptId:'direct',conceptText:'새 사운드 컨셉\n악기는 자유'};
 const lyric='  첫 줄\n\n  다음 줄 \n';
 for(const [i,payload] of [{...base,text:lyric},{...base,lyricsRequest:'이야기를 가사로',targetDurationSeconds:60}].entries()){
  const response=await browser('/api/requests','POST',auth,{...command,idempotencyKey:'lyrics-'+i,payload});
  assert.equal(response.status,202);
  const {queueId}=await response.json();
  assert.deepEqual((await queue.get({queueId})).payload,payload);
 }
 for(const payload of [{...base,text:lyric,lyricsRequest:'conflict'}, {...base,conceptText:''},
  {...base,lyricsRequest:'이야기를 가사로',durationSeconds:23},{...base,targetDurationSeconds:61}]){
  assert.equal((await browser('/api/requests','POST',auth,{...command,idempotencyKey:'reject',payload})).status,400);
 }
});

test('only successful authorized pending responses carry compiled canonical source identity',async t=>{
 const db=store(t),sha='a12c'.repeat(10),forged='f'.repeat(40);
 const args={name:'space_requests_pending',arguments:{}};
 const probe=(commitSha,method='tools/call',params=args,extra={})=>machineResponse(
  request('/api/space-machine-mcp','POST',{'X-NGS-Machine-Token':token,'X-NGS-Commit-Sha':forged,...extra},
   {jsonrpc:'2.0',id:1,method,params}),{db,secret:token,commitSha});
 const ok=await probe(sha);
 assert.equal(ok.headers.get('X-NGS-Commit-Sha'),sha);
 assert.deepEqual((await ok.json()).result.structuredContent,{requests:[]});
 for(const untrusted of [undefined,sha.toUpperCase(),sha+'\n','1'.repeat(7)])
  assert.equal((await probe(untrusted)).headers.get('X-NGS-Commit-Sha'),null);
 const denied=await probe(sha,'tools/call',args,{'X-NGS-Machine-Token':'d'.repeat(64)});
 assert.equal(denied.status,403);assert.equal(denied.headers.get('X-NGS-Commit-Sha'),null);
 assert.equal((await probe(sha,'tools/list',{})).headers.get('X-NGS-Commit-Sha'),null);
 assert.equal((await probe(sha,'tools/call',{...args,arguments:{projectId:'other'}})).headers.get('X-NGS-Commit-Sha'),null);
});


test('authenticated deployment status reports only the serving artifact and no invented deployment time',async ()=>{
 const sha='b7e1'.repeat(10),forged='f'.repeat(40),name='space_ngs_deployment_status';
 const probe=(commitSha,extra={},arguments_={},route='/api/space-machine-mcp')=>machineResponse(
  request(route,'POST',{'X-NGS-Machine-Token':token,'X-NGS-Commit-Sha':forged,...extra},
   {jsonrpc:'2.0',id:12,method:'tools/call',params:{name,arguments:arguments_}}),{secret:token,commitSha});
 const expected={commitSha:sha,deployedAt:null};
 const valid=await probe(sha);
 assert.equal(valid.status,200);
 assert.equal(valid.headers.get('Cache-Control'),'private, no-store');
 assert.equal(valid.headers.get('X-NGS-Commit-Sha'),null); // Existing queue wire is separate.
 const reply=await valid.json();
 assert.deepEqual(reply.result.structuredContent,expected);
 assert.deepEqual(JSON.parse(reply.result.content[0].text),expected);
 for(const value of [undefined,sha.toUpperCase(),sha+'\n',sha.slice(0,7)])
  assert.deepEqual((await (await probe(value)).json()).result.structuredContent,{commitSha:null,deployedAt:null});
 assert.equal((await probe(sha,{'X-NGS-Machine-Token':'wrong'})).status,403);
 assert.equal((await probe(sha,{Origin:origin})).status,403);
 assert.equal((await probe(sha,{}, {},'/mcp')).status,404);
 const malformed=await probe(sha,{}, {commitSha:forged});
 assert.equal((await malformed.json()).error.code,-32602);
});

test('Space queues shape-valid replacement and animation without reading replicas',async t=>{
 const db=store(t),seen=[];
 const options={db,secret:token,authorize:async()=>true,authorizeWrite:async()=>true,
  replicaReads:true,workspaceReady:true,poseSelectionV2Enabled:true,
  hasPublishedNpc:async(user,id)=>{seen.push([user.userId,id]);return ['character.seojin','character.yeonwoo'].includes(id);}};
 const browser=(...args)=>browserQueueResponse(request(...args),options);
 const a=headers('a'),session=await (await browser('/__npcgen_session','GET',a)).json();
 const auth={...a,Origin:origin,'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId};
 const inputs=Array.from({length:11},(_,i)=>({presetId:'preset-'+i,posePreset:'idle',assetSetSha256:'a'.repeat(64)}));
 const payload={schemaVersion:'ngs.npc-one-stop.selection.replace.v2',projectId:'binari',intent:'기존 NPC의 전체 재생성',sourceRefs:['기획'],
  character:{npcId:'character.seojin',slug:'seojin',name:'서진',role:'암행어사',actId:'act01',chapterId:'chapter01'},motionSelection:inputs};
 const submit=(id,p)=>browser('/api/requests','POST',auth,{requestType:'npc.workflow',idempotencyKey:id,payload:p});
 assert.equal(session.poseSelectionV2Enabled,true);
 const denied=await browserQueueResponse(request('/api/requests','POST',auth,{requestType:'npc.workflow',
  idempotencyKey:'v2-disabled',payload}),{...options,poseSelectionV2Enabled:false});
 assert.equal(denied.status,404);
 assert.deepEqual(await denied.json(),{error:'NPC_POSE_SELECTION_V2_UNAVAILABLE'});

 assert.equal((await submit('incorrect-slug',{...payload,character:{...payload.character,slug:'yeonwoo'}})).status,400);
 assert.equal((await submit('cannot-create-character',{...payload,schemaVersion:'ngs.npc-one-stop.selection.v2'})).status,400);
 assert.deepEqual(seen,[]);
 assert.equal((await submit('matched-slug-absent-id',{...payload,character:{...payload.character,npcId:'character.missing',slug:'missing'}})).status,202);
 const {queueId}=await (await submit('keep-exact-legacy-id',payload)).json();
 assert.ok(queueId);
 const stored=await new SpaceRequestQueue(db).get({queueId});
 assert.deepEqual(stored.payload,payload);
 const v1={...payload,schemaVersion:'ngs.npc-one-stop.selection.replace.v1'};
 const replayable=await submit('keep-old-selection-replace',v1);
 assert.equal(replayable.status,202);
 assert.deepEqual((await new SpaceRequestQueue(db).get({queueId:(await replayable.json()).queueId})).payload,v1);
 const {motionSelection,...legacy}=payload;
 const old={...legacy,schemaVersion:'ngs.npc-one-stop.replace.v1',includeCombat:false,
  character:{...legacy.character,npcId:'character.yeonwoo',slug:'yeonwoo',name:'연우'}};
 assert.equal((await submit('legacy-wire',old)).status,202);
 assert.deepEqual(seen,[]);
 const regen={schemaVersion:'ngs.npc-animation.regenerate.v2',projectId:'binari',npcId:'character.seojin',
  motionSelection:[...motionSelection,{presetId:'sword-attack-flat',posePreset:'combat',assetSetSha256:'b'.repeat(64)}]};
 const receipt=await browser('/api/requests','POST',auth,{requestType:'npc.animation.regenerate',idempotencyKey:'regen-many',payload:regen});
 assert.equal(receipt.status,202);
 assert.deepEqual((await new SpaceRequestQueue(db).get({queueId:(await receipt.json()).queueId})).payload,regen);
 const legacyRegen={...regen,schemaVersion:'ngs.npc-animation.regenerate.v1'};
 const legacyReceipt=await browser('/api/requests','POST',auth,{requestType:'npc.animation.regenerate',
  idempotencyKey:'regen-legacy',payload:legacyRegen});
 assert.equal(legacyReceipt.status,202);
 assert.deepEqual((await new SpaceRequestQueue(db).get({queueId:(await legacyReceipt.json()).queueId})).payload,legacyRegen);
});


test('Space separation is opt-in and binds one exact authorized original source through the existing queue',async t=>{
 const db=store(t),seen=[];
 const sourceOfficialRequestId='request.official.'+'a'.repeat(64),sourceSha256='b'.repeat(64);
 const payload={schemaVersion:'ngs.audio-separate.v1',projectId:'binari',sourceOfficialRequestId,sourceSha256};
 const options={db,secret:token,authorize:async()=>true,authorizeWrite:async u=>u.userId==='editor',replicaReads:true,workspaceReady:true};
 const session=async (user,enabled)=>{
  const auth=headers(user),env={...options,hasAudioSeparationSource:enabled?async p=>{seen.push(p);return p.sourceSha256===sourceSha256;}:undefined};
  const send=(path,method,headers,body)=>browserQueueResponse(request(path,method,headers,body),env);
  const capability=await (await send('/__npcgen_session','GET',auth)).json();
  const post=p=>send('/api/requests','POST',{...auth,Origin:origin,'X-NPCGen-Csrf':capability.csrfToken,
   'X-NPCGen-Frontend-Context':capability.contextId},{requestType:'audio.separate',idempotencyKey:'one',payload:p});
  return {capability,post};
 };
 const readonly=await session('viewer',true);assert.equal(readonly.capability.audioSeparationEnabled,undefined);
 assert.equal((await readonly.post(payload)).status,403);
 const off=await session('editor',false);assert.equal(off.capability.audioSeparationEnabled,undefined);
 assert.equal((await off.post(payload)).status,404);
 const on=await session('editor',true);assert.equal(on.capability.audioSeparationEnabled,true);
 assert.equal((await on.post({...payload,prompt:'cannot override'})).status,400);
 assert.equal((await on.post({...payload,sourceSha256:'c'.repeat(64)})).status,404);
 const accepted=await on.post(payload);assert.equal(accepted.status,202);
 const {queueId}=await accepted.json();assert.deepEqual((await new SpaceRequestQueue(db).get({queueId})).payload,payload);
 assert.equal(seen.length,2);
});

test('Space prop mutation requires its own explicit capability and existing browser CSRF/actor grants',async t=>{
 const db=store(t),a=headers('a'),seen=[];
 const options={db,secret:token,authorize:async()=>true,authorizeWrite:async user=>user.userId==='a',
  replicaReads:true,workspaceReady:true,propActions:['animation','scale','regenerate']};
 const admitProp=async (user,cmd,actions)=>{assert.equal(user.userId,'a');assert.deepEqual(actions,['animation','scale']);seen.push(cmd);};
 const inactive=(...args)=>browserQueueResponse(request(...args),options);
 const active=(...args)=>browserQueueResponse(request(...args),{...options,admitProp});
 const cfg=async browser=>(await (await browser('/__npcgen_session','GET',a)).json());
 const cmd={requestType:'prop.animation.generate',idempotencyKey:'prop-case',payload:{schemaVersion:'ngs.prop-animation-generate.v1',
  projectId:'binari',propId:'paper-candle',source:{revision:1,sha256:'a'.repeat(64)},motionId:'flicker',prompt:'Flame flickers once.'}};
 const send=(browser,cfg,cmd)=>browser('/api/requests','POST',{...a,Origin:origin,'X-NPCGen-Csrf':cfg.csrfToken,
  'X-NPCGen-Frontend-Context':cfg.contextId},cmd);
 const off=await cfg(inactive),on=await cfg(active);
 assert.equal(off.propActions,undefined);assert.deepEqual(on.propActions,['animation','scale']);
 assert.equal((await send(inactive,off,cmd)).status,404);
 assert.equal((await send(active,on,{...cmd,payload:{...cmd.payload,preset:'not allowed'}})).status,400);
 // This fixture inspects dispatch and payload whitelist; the true scoped
 // admission in Local and the shared registry's separate tests bind the pin.
 const good=await send(active,on,cmd);
 assert.equal(good.status,202);assert.equal((await good.json()).status,'queued');
 assert.equal(seen.at(-1).payload.prompt,'Flame flickers once.');
 const repair={requestType:'prop.scale.generate',idempotencyKey:'scale-case',payload:{schemaVersion:'ngs.prop-scale-generate.v1',
  projectId:'binari',propId:'paper-candle',source:cmd.payload.source,scalePercents:[5,20]}};
 assert.equal((await send(active,on,repair)).status,202);
 assert.deepEqual(seen.at(-1),repair);
 assert.equal((await send(active,on,{...repair,requestType:'prop.regenerate'})).status,400);
});

test('cinematic queue requires opt-in and exact source admission under existing Site auth',async t=>{
 const db=store(t),a=headers('a'),seen=[];
 const options={db,secret:token,authorize:async()=>true,authorizeWrite:async user=>user.userId==='a',
  replicaReads:true,workspaceReady:true,admitCinematic:async(user,cmd)=>{
   assert.equal(user.userId,'a');seen.push(cmd.payload.sourceSha256);
   if(cmd.payload.sourceSha256!=='a'.repeat(64))throw Object.assign(Error('CINEMATIC_SOURCE_NOT_FOUND'),{status:404});
  }};
 const call=(on,...args)=>browserQueueResponse(request(...args),{...options,cinematicEnabled:on});
 const cfg=async on=>(await (await call(on,'/__npcgen_session','GET',a)).json());
 const payload={schemaVersion:'ngs.cinematic-generate.v1',projectId:'binari',sourceSha256:'a'.repeat(64),motionPrompt:'The folded jacket opens.'};
 const send=(on,cfg,payload)=>call(on,'/api/requests','POST',{...a,Origin:origin,'X-NPCGen-Csrf':cfg.csrfToken,
  'X-NPCGen-Frontend-Context':cfg.contextId},{requestType:'cinematic.generate',idempotencyKey:'one-cinematic',payload});
 const off=await cfg(false),on=await cfg(true);
 assert.equal(off.cinematicEnabled,undefined);assert.equal(on.cinematicEnabled,true);
 assert.equal((await send(false,off,payload)).status,404);
 assert.equal((await send(true,on,{...payload,sourceSha256:'b'.repeat(64)})).status,404);
 const accept=await send(true,on,payload);assert.equal(accept.status,202);
 const {queueId}=await accept.json();assert.deepEqual((await new SpaceRequestQueue(db).get({queueId})).payload,payload);
 assert.deepEqual(seen,['b'.repeat(64),'a'.repeat(64)]);
});

test('Space Basic NPC uses the same browser payload contract and relays it unchanged',async t=>{
 const {newNpcBasicRequest}=await import('../ngs-local/sites/npcgen/build/local-npc-one-stop-ui.mjs');
 const db=store(t),options={db,secret:token,replicaReads:true,workspaceReady:true,npcBasicPortraitEnabled:true,
  authorize:async()=>true,authorizeWrite:async user=>user.userId==='basic-owner'};
 const viewer=headers('read-only'),owner=headers('basic-owner');
 const call=(opts,...args)=>browserQueueResponse(request(...args),opts);
 const cfg=async(opts,h)=>(await(await call(opts,'/__npcgen_session','GET',h)).json());
 assert.equal((await cfg(options,owner)).npcBasicPortraitEnabled,true);
 assert.equal((await cfg(options,viewer)).npcBasicPortraitEnabled,undefined);
 assert.equal((await cfg({...options,replicaReads:false},owner)).npcBasicPortraitEnabled,undefined);
 assert.equal((await cfg({...options,workspaceReady:false},owner)).npcBasicPortraitEnabled,undefined);
 assert.equal((await cfg({...options,npcBasicPortraitEnabled:false},owner)).npcBasicPortraitEnabled,undefined);
 const session=await cfg(options,owner),h={...owner,Origin:origin,'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId};
 const submit=(opts,value)=>call(opts,'/api/requests','POST',h,value);
 const input={name:'주모 테스트',slug:'tavern-keeper-test',role:'주막 주인',actId:'act01',chapterId:'chapter01',
  goal:'소문을 모은다',behavior:'상대의 눈치를 본다',palette:'짙은 빨강',appearance:'걷어 올린 치마'};
 const first=newNpcBasicRequest({...input,includeCombat:false});
 const extra=newNpcBasicRequest({...input,slug:'tavern-keeper-test-combat',includeCombat:true,combatRequirements:'부채를 펼쳐 든다'});
 const command=p=>({idempotencyKey:p.character.slug,requestType:'npc.workflow',payload:p});
 const rejected=await submit({...options,npcBasicPortraitEnabled:false},command(first));
 assert.equal(rejected.status,404);
 assert.deepEqual(await rejected.json(),{error:'NPC_BASIC_PORTRAIT_UNAVAILABLE'});
 for(const payload of [
  {...first,character:{...first.character,actId:'story.main.act01'}},
  {...first,motionSelection:[]},
  {...first,combatRequirements:'전투 미선택'},
  {...extra,combatRequirements:'  '},
 ]){
  assert.equal((await submit(options,command(payload))).status,400);
 }
 for(const payload of [first,extra]){
  const r=await submit(options,command(payload)),receipt=await r.json();assert.equal(r.status,202);
  assert.equal(receipt.status,'queued');assert.match(receipt.queueId,/^ngs\.space\./u);
  assert.deepEqual(await (await submit(options,command(payload))).json(),receipt);
  const live=await machineResponse(request('/api/space-machine-mcp','POST',{'X-NGS-Machine-Token':token},
   {jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'space_requests_get',arguments:{queueId:receipt.queueId}}}),options);
  const rpc=await live.json();assert.equal(rpc.result.isError,false);
  assert.deepEqual(rpc.result.structuredContent,{queueId:receipt.queueId,idempotencyKey:receipt.queueId,requestType:'npc.workflow',payload});
 }
 const queue=new SpaceRequestQueue(db);
 assert.equal((await queue.pending({})).requests.length,2);
});

test('verified workspace team editor role is independent of legacy read and queue-only roles',async()=>{
 const email='approved.team@example.com';
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(email))),x=>x.toString(16).padStart(2,'0')).join('');
 const legacy=async user=>{if(user.email==='old-reader@example.com')return {projectId:'binari',role:'viewer'};
  throw Object.assign(Error('MASTER_CONCEPT_PARTICIPANT_DENIED'),{status:403});};
 const resolve=user=>spaceWorkspacePrincipal(user,[digest],legacy);
 assert.deepEqual(await resolve({email:' Approved.Team@example.com '}),{projectId:'binari',role:'editor'});
 assert.deepEqual(await resolve({email:'old-reader@example.com'}),{projectId:'binari',role:'viewer'});
 await assert.rejects(resolve({email:'unknown@example.com',role:'editor'}),/MASTER_CONCEPT_PARTICIPANT_DENIED/);
 assert.equal(await authorizeSpaceQueueWrite({email},resolve),true);
});

test('file deletes and map/assembly rights use the native Binari roster, never queue-only write',async t=>{
 const grants=Object.fromEntries(['owner','editor','viewer'].map(role=>[role,{role,projectId:'binari'}]));
 const options={db:store(t),secret:token,replicaReads:true,workspaceReady:true,
  authorize:async u=>u.userId!=='revoked',authorizeWrite:async()=>true,
  mapAssemblyGrant:async u=>grants[u.userId]??null,admitMapAssembly:async()=>{}};
 const browser=(...args)=>browserQueueResponse(request(...args),options);
 const session=async who=>(await browser('/__npcgen_session','GET',headers(who))).json();
 const post=(who,s,cmd,extra={})=>browser('/api/requests','POST',{...headers(who),Origin:origin,
  'X-NPCGen-Csrf':s.csrfToken,'X-NPCGen-Frontend-Context':s.contextId,...extra},cmd);
 const fixtureId='request.official.'+'c'.repeat(64);
 const room=(id,c)=>({id,name:'Room '+id,description:'Fixture',backgroundId:'background.'+c.repeat(64),imageSha256:c.repeat(64)});
 const graph={title:'Map',startRegionId:'a',regions:[room('a','a'),room('b','b')],connections:[
  {id:'portal',from:'a',to:'b',hit:null,spawn:null,label:'Portal'}]};
 const map={requestType:'map.generate',idempotencyKey:'map-generate',payload:{
  schemaVersion:'ngs.map-generate.v1',projectId:'binari',graph,intent:'Fixture'}};
 const mapUpdate={requestType:'map.update',idempotencyKey:'map-update',payload:{
  schemaVersion:'ngs.map-update.v1',projectId:'binari',mapId:fixtureId,expectedRevision:1,
  graph:{...graph,connections:[{...graph.connections[0],hit:{x:500,y:500,width:10,height:10},spawn:{x:200,y:500}}]}}};
 const fileUpdate={requestType:'file.update',idempotencyKey:'file-update',payload:{
  schemaVersion:'ngs.file-update.v1',projectId:'binari',target:{root:'canonical-files/binari/cinematics/maps',path:fixtureId,kind:'metadata'},
  expected:{revision:1,officialRequestId:fixtureId},content:mapUpdate.payload.graph}};
 const assembly={requestType:'assembly.generate',idempotencyKey:'assembly-generate',payload:{
  schemaVersion:'ngs.assembly-generate.v1',projectId:'binari',mapId:fixtureId,title:'Assembly',
  puzzleType:'binari.ritual-well-water-demo',intent:'Fixture'}};
 const assemblyUpdate={requestType:'assembly.update',idempotencyKey:'assembly-update',payload:{
  schemaVersion:'ngs.assembly-update.v1',projectId:'binari',assemblyId:fixtureId,expectedRevision:1,puzzles:[]}};
 const deletes=['maps','assemblies'].map(kind=>({requestType:'file.delete',idempotencyKey:'delete-'+kind,payload:{
  schemaVersion:'ngs.file-delete.v1',projectId:'binari',target:{root:'canonical-files/binari/cinematics/'+kind,path:fixtureId,kind:'directory'},
  expected:{revision:1,officialRequestId:fixtureId}}}));
 const deletesWithPin=[
  ['npcs','character.fixture','directory',{creationTaskId:'workflow.task.'+'d'.repeat(64)}],
  ['props','test-prop','directory',{revision:1,sha256:'a'.repeat(64)}],
  ['cinematics/backgrounds','b'.repeat(64)+'.png','file',{sourceRequestId:fixtureId}],
 ];
 for(const [root,path,kind,expected] of deletesWithPin)deletes.push({
  requestType:'file.delete',idempotencyKey:'roster-delete-'+root.replace('/','-'),
  payload:{schemaVersion:'ngs.file-delete.v1',projectId:'binari',target:{root:'canonical-files/binari/'+root,path,kind},expected}});

 for(const who of ['owner','editor','viewer','queue-only']){
  const s=await session(who);
  assert.equal(s.requestWritable,true);
  assert.equal(s.mapReadEnabled,who==='queue-only'?undefined:true);
  assert.equal(s.assemblyReadEnabled,who==='queue-only'?undefined:true);
  assert.equal(s.mapEnabled,who!=='queue-only'?true:undefined);
  assert.equal(s.fileUpdateEnabled,who!=='queue-only'?true:undefined);
  assert.equal(s.assemblyEnabled,who!=='queue-only'?true:undefined);
  assert.equal(s.mapDeleteEnabled,who!=='queue-only'?true:undefined);
  assert.equal(s.assemblyDeleteEnabled,who!=='queue-only'?true:undefined);
  for(const cap of ['npcFolderDeleteEnabled','propFolderDeleteEnabled','backgroundDeleteEnabled'])
   assert.equal(s[cap],who!=='queue-only'?true:undefined);
  for(const cmd of [map,mapUpdate,fileUpdate,assembly,assemblyUpdate]){
   const out=await post(who,s,cmd);
   assert.equal(out.status,who!=='queue-only'?202:403,JSON.stringify(await out.json()));
  }
  for(const cmd of deletes){
   const permitted=who!=='queue-only';
   assert.equal((await post(who,s,cmd)).status,permitted?202:403);
  }
 }
 const owner=await session('owner');
 assert.equal((await post('owner',owner,deletes[0],{'X-NPCGen-Csrf':'wrong'})).status,403);
 assert.equal((await post('owner',owner,deletes[1],{Origin:'https://other.example'})).status,403);
 for(const root of ['canonical-files/binari/cinematics','canonical-files/binari/cinematics/backgrounds']){
  const cmd=structuredClone(deletes[0]);cmd.payload.target.root=root;
  assert.equal((await post('owner',owner,cmd)).status,400);
 }
 const stale=structuredClone(deletes[1]);stale.payload.expected.revision=0;
 assert.equal((await post('owner',owner,stale)).status,400);
 assert.equal((await browser('/__npcgen_session','GET',headers('revoked'))).status,403);
});

test('map/assembly admission uses replica pins and keeps title, revision and reachability checks',async()=>{
 const {admitSpaceMapAssembly}=await import('../build/space-map-assembly.mjs');
 const official='request.official.'+'f'.repeat(64),char='a'.repeat(64),backgroundId='background.'+char;
 const graph={title:'Pinned Map',startRegionId:'start',regions:[{id:'start',name:'Start',description:'Fixture',backgroundId,imageSha256:char}],connections:[]};
 const map={requestType:'map.update',payload:{schemaVersion:'ngs.map-update.v1',projectId:'binari',mapId:official,expectedRevision:1,graph}};
 const latest={map:{revision:1,graph},assembly:{revision:1,map:{mapId:official}},backgrounds:[{title:'Fixture',backgroundId,sha256:char}]};
 const visit=[];
 const read=async(path,q)=>{
  visit.push(path);
  if(path==='/api/background-workspace')return {backgrounds:latest.backgrounds};
  assert.equal(q.get('item'),official);
  if(path==='/api/map-workspace')return {map:latest.map};
  return {assembly:latest.assembly};
 };
 await admitSpaceMapAssembly({command:map,read});
 assert.deepEqual(visit.splice(0),['/api/background-workspace','/api/map-workspace']);
 latest.map.revision=2;
 await assert.rejects(admitSpaceMapAssembly({command:map,read}),{status:409,message:'MAP_REVISION_CONFLICT'});
 latest.map.revision=1;latest.map.graph={...graph,title:'Other'};
 await assert.rejects(admitSpaceMapAssembly({command:map,read}),{status:409,message:'MAP_TITLE_IMMUTABLE'});
 latest.map.graph=graph;latest.backgrounds[0].sha256='b'.repeat(64);
 await assert.rejects(admitSpaceMapAssembly({command:map,read}),{status:404,message:'MAP_BACKGROUND_NOT_FOUND'});
 const assemble={requestType:'assembly.update',payload:{schemaVersion:'ngs.assembly-update.v1',projectId:'binari',assemblyId:official,expectedRevision:1,puzzles:[]}};
 await admitSpaceMapAssembly({command:assemble,read});
 latest.assembly.revision=2;
 await assert.rejects(admitSpaceMapAssembly({command:assemble,read}),{status:409,message:'ASSEMBLY_REVISION_CONFLICT'});
 latest.assembly.revision=1;
 const slot={propId:'fixture',revision:1,sha256:char};
 assemble.payload.puzzles=[{id:'fixture',type:'binari.ritual-well-water-demo',
  layout:{altar:{regionId:'start',x:50,y:50},well:{regionId:'unreachable',x:50,y:50}},
  attachments:{bowl:{x:0,y:0},lid:{x:0,y:0}},bindings:{table:slot,bowl:slot,well:slot,lid:slot}}];
 await assert.rejects(admitSpaceMapAssembly({command:assemble,read}),{status:400,message:'ASSEMBLY_LAYOUT_UNREACHABLE'});
});


test('Space browser and Viewer MCP share background generation and animation admission',async t=>{
 const {spaceViewerMcpResponse}=await import('../build/space-viewer-mcp.mjs');
 const {backgroundPixelType,backgroundPixelSchema,backgroundAnimationType,backgroundAnimationSchema,backgroundLoopPrompt,validBackgroundAnimation}=
  await import('../ngs-local/sites/npcgen/build/cinematic-sequence-contract.mjs');
 const {backgroundLoopPlayback}=await import('../ngs-local/sites/npcgen/build/cinematic-timeline.mjs');
 const db=store(t),seen=[],a=headers('a');
 const opts={db,secret:token,replicaReads:true,workspaceReady:true,backgroundSourceEnabled:true,puzzleCoreVersion:"c".repeat(64),
  authorize:async()=>true,authorizeWrite:async u=>u.userId==='a',
  admitCinematic:async(u,command)=>{assert.equal(u.userId,'a');
   if(command.requestType===backgroundAnimationType&&!validBackgroundAnimation(command.payload))
    throw Object.assign(Error('NGS_CINEMATIC_PAYLOAD_INVALID'),{status:400});
   seen.push(command.requestType);}};
 const call=(path,method,headers,body,changes={})=>browserQueueResponse(request(path,method,headers,body),{...opts,...changes});
 const on=await (await call('/__npcgen_session','GET',a)).json();
 const off=await (await call('/__npcgen_session','GET',a,undefined,{backgroundSourceEnabled:false})).json();
 assert.equal(on.backgroundPixelEnabled,true);assert.equal(on.backgroundAnimationEnabled,true);
 assert.equal(off.backgroundPixelEnabled,undefined);
 const macMcp=async(name,args,identity=a)=>spaceViewerMcpResponse(request('/mcp','POST',identity,
  {jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}}),{
  authorizeParticipant:async u=>u.userId==='a',
  requestQueue:async (url,identity,cmd)=>cmd===undefined
   ?call(url.pathname,'GET',identity)
   :call(url.pathname,'POST',{...identity,Origin:origin,'X-NPCGen-Csrf':on.csrfToken,
     'X-NPCGen-Frontend-Context':on.contextId},cmd)
 });
 const legacyBridge=await (await macMcp('ngs_viewer_request_session',{})).json();
 assert.equal(legacyBridge.result.structuredContent.data.backgroundSourceEnabled,true);
 assert.equal(legacyBridge.result.structuredContent.data.backgroundPixelEnabled,undefined);
 const bridge=await (await macMcp('ngs_viewer_request_session',{workspaceProtocol:2})).json();
 assert.equal(bridge.result.structuredContent.data.backgroundPixelEnabled,true);
 assert.equal(bridge.result.structuredContent.data.backgroundAnimationEnabled,true);
 assert.equal(bridge.result.structuredContent.data.csrfToken,undefined);
 assert.equal(bridge.result.structuredContent.data.puzzleCoreVersion,undefined);
 const versioned=await (await macMcp('ngs_viewer_request_session',{workspaceProtocol:3})).json();
 assert.equal(versioned.result.structuredContent.data.puzzleCoreVersion,'c'.repeat(64));
 const projectId='binari', pixel='a'.repeat(64);
 const inputs=[
  {requestType:backgroundPixelType,idempotencyKey:'full-background',payload:{schemaVersion:backgroundPixelSchema,projectId,
   title:'뜰',timeOfDay:'밤',season:'가을',mood:'스산함',color:'먹색',location:'대문',requirements:'마당 확보',additionalNotes:''}},
  {requestType:backgroundAnimationType,idempotencyKey:'loop-background',payload:{schemaVersion:backgroundAnimationSchema,projectId,
   backgroundSha256:pixel,references:{pixel,cinematic:'b'.repeat(64)},motionPrompt:backgroundLoopPrompt('바람'),playback:backgroundLoopPlayback()}}
 ];
 const auth={...a,Origin:origin,'X-NPCGen-Csrf':on.csrfToken,'X-NPCGen-Frontend-Context':on.contextId};
 for(const cmd of inputs){
  assert.equal((await call('/api/requests','POST',auth,cmd,{backgroundSourceEnabled:false})).status,404);
  assert.equal((await call('/api/requests','POST',auth,cmd)).status,202);
  const bridged=await (await macMcp('ngs_viewer_request_submit',{command:cmd})).json();
  assert.equal(bridged.result.structuredContent.status,202);
 }
 assert.equal((await call('/api/requests','POST',auth,{...inputs[1],payload:{...inputs[1].payload,motionPrompt:'non loop'}})).status,400);
 assert.deepEqual(seen,inputs.flatMap(cmd=>[cmd.requestType,cmd.requestType]));
});

test('cinematic scene folder deletion uses one protected file.delete for every team role',async t=>{
 const {cinematicSceneDeletePayload,cinematicSequenceDeletePayload}=await import('../ngs-local/sites/npcgen/build/prop-folder-delete-contract.mjs');
 const db=store(t),seen=[];
 const opts={db,secret:token,replicaReads:true,workspaceReady:true,cinematicSceneDeleteEnabled:true,
  authorize:async()=>true,authorizeWrite:async()=>true,mapAssemblyGrant:async u=>['editor','viewer'].includes(u.userId)?{projectId:'binari',role:u.userId}:null,
  admitMapAssembly:async(_user,c)=>seen.push(c)};
 const call=(path,method,identity,body)=>browserQueueResponse(request(path,method,identity,body),opts);
 const send=async (actor,payload)=>{
  const h=headers(actor),s=await (await call('/__npcgen_session','GET',h)).json();
  assert.equal(s.cinematicDeleteEnabled,['editor','viewer'].includes(actor)?true:undefined);
  return call('/api/requests','POST',{...h,Origin:origin,'X-NPCGen-Csrf':s.csrfToken,'X-NPCGen-Frontend-Context':s.contextId},
   {requestType:'file.delete',idempotencyKey:'cinematic-delete-'+(payload.expected.sequenceId??'scene'),payload});
 };
 const payload=cinematicSceneDeletePayload('a'.repeat(64));
 assert.equal((await send('other',payload)).status,403);
 assert.equal((await send('editor',{...payload,target:{...payload.target,path:'scenes/'+'b'.repeat(64)}})).status,400);
 assert.equal((await send('editor',payload)).status,202);
 assert.equal((await send('viewer',payload)).status,202);
 const sequenceId='request.official.'+'b'.repeat(64);
 const animation=cinematicSequenceDeletePayload({sourceSha256:'a'.repeat(64),sequenceId,sceneFolder:true});
 assert.equal((await send('other',animation)).status,403);
 assert.equal((await send('editor',{...animation,expected:{...animation.expected,sequenceId:'request.official.'+'c'.repeat(64)}})).status,400);
 assert.equal((await send('editor',animation)).status,202);
 assert.equal((await send('viewer',animation)).status,202);
 const legacy={...payload,target:{...payload.target,path:'results/'+sequenceId+'.mp4',kind:'file'}};
 assert.equal((await send('editor',legacy)).status,400);
 assert.deepEqual(seen.map(command=>command.payload),[payload,payload,animation,animation]);
});


test('published workspace capability list is identical for all signed-in team roles, not available to non-members',async t=>{
 const db=store(t),roles=['owner','editor','viewer'];
 const principal=async user=>roles.includes(user.userId)?{projectId:'binari',role:user.userId}:null;
 const opts={db,secret:token,replicaReads:true,workspaceReady:true,releaseCapabilities:workspaceReleaseCapabilities,
  authorize:async()=>true,authorizeWrite:user=>authorizeSpaceQueueWrite(user,principal),
  mapAssemblyGrant:principal,admitMapAssembly:async()=>{}};
 for(const role of roles){
  const session=await (await browserQueueResponse(request('/__npcgen_session','GET',headers(role)),opts)).json();
  assert.equal(session.requestWritable,true);
  for(const [key,value] of Object.entries(workspaceReleaseCapabilities))assert.deepEqual(session[key],value);
 }
 const nonTeam=await (await browserQueueResponse(request('/__npcgen_session','GET',headers('other')),opts)).json();
 assert.equal(nonTeam.requestWritable,false);
 for(const key of Object.keys(workspaceReleaseCapabilities))assert.equal(nonTeam[key],undefined);
});

test('C# proof requests enter the formal hosted queue when the release provides the core',async t=>{
 const {admitSpaceMapAssembly}=await import('../build/space-map-assembly.mjs');
 const puzzleCoreVersion='a'.repeat(64),db=store(t);
 const grant=async()=>({projectId:'binari',role:'viewer'});
 const mapId='request.official.'+'b'.repeat(64);
 const opts={db,secret:token,replicaReads:true,workspaceReady:true,puzzleCoreVersion,authorize:async()=>true,
  authorizeWrite:async()=>true,mapAssemblyGrant:grant,admitMapAssembly:async(_user,command)=>admitSpaceMapAssembly({
   command,puzzleProofReady:true,read:async(path,query)=>{
    assert.equal(path,'/api/map-workspace');assert.equal(query.get('item'),mapId);return {};
   }})};
 const h=headers('viewer');
 const session=await (await browserQueueResponse(request('/__npcgen_session','GET',h),opts)).json();
 assert.equal(session.puzzleCoreVersion,puzzleCoreVersion);
 const c={requestType:'assembly.generate',idempotencyKey:'puzzle-proof',payload:{
  schemaVersion:'ngs.assembly-generate.v4',projectId:'binari',title:'Fixture',mapId,intent:'Verify',
  puzzles:[{id:'water',type:'binari.ritual-well-water-demo',intent:''}]}};
 const a={...h,Origin:origin,'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId};
 const response=await browserQueueResponse(request('/api/requests','POST',a,c),opts);
 assert.equal(response.status,202,JSON.stringify((await response.clone().json())));
 assert.deepEqual((await new SpaceRequestQueue(db).get({queueId:(await response.json()).queueId})).payload,c.payload);
});
