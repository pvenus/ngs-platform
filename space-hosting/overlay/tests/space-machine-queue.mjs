import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {machineResponse,browserQueueResponse,spaceQueueParticipant,authorizeSpaceQueueWrite} from '../build/space-machine-routes.mjs';
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
  {...command,payload:{...command.payload,targetDurationSeconds:60}},
  {...command,actorId:'owner'},
 ]) assert.equal((await write('viewer',viewer,bad)).status,400);
 assert.equal((await write('owner',owner,{...command,payload:{...command.payload,targetDurationSeconds:60}})).status,400);
 assert.equal((await browser('/api/requests','GET',headers('owner')).then(r=>r.json())).requests.length,0);
 assert.equal((await browser('/api/requests','GET',headers('viewer')).then(r=>r.json())).requests.length,commands.length);
 for(const path of ['/api/space/audio-requests','/api/npc-one-stop','/mcp','/api/site/access']){
  assert.equal(await browser(path,'POST',headers('viewer'),command),null);
 }
});

test('one private authenticated email exception is queue-only and cannot override the active project or existing policy denial',async t=>{
 const db=store(t),email='queue-only@example.invalid';
 const digest=createHash('sha256').update(email).digest('hex');
 const owner='owner',guest='guest';
 const auth=(id,address=id+'@example.invalid')=>({...headers(id),'oai-authenticated-user-email':address});
 const missing=()=>Object.assign(Error('MASTER_CONCEPT_PARTICIPANT_DENIED'),{status:403});
 const participant=async({userId})=>{
  if(userId===owner)return {projectId:'binari',role:'owner'};
  if(userId==='badGrant')return {projectId:'other',role:'owner'};
  if(userId==='exception')throw Object.assign(Error('UNAVAILABLE'),{status:503});
  throw missing();
 };
 const route=(setting,project=()=>true)=> (path,method,h,body)=>browserQueueResponse(request(path,method,h,body),{
  db,secret:token,authorize:async user=>project(user),authorizeWrite:user=>authorizeSpaceQueueWrite(user,participant,setting)});
 const session=(browser,h)=>browser('/__npcgen_session','GET',h);
 const configured=route(digest),named=auth(guest,email.toUpperCase());
 const deniedMedia=await session(configured,{'oai-authenticated-user-email':email});
 assert.equal(deniedMedia.status,401);
 const selected=await (await session(configured,named)).json();
 const ordinary=await (await session(configured,auth('visitor'))).json();
 assert.equal(selected.requestWritable,true);
 assert.equal(ordinary.requestWritable,false);
 assert.ok(!JSON.stringify(selected).includes(digest));
 assert.ok(!JSON.stringify(selected).includes(email));
 assert.equal((await session(route(digest,()=>false),named)).status,403);
 for(const id of ['badGrant','exception'])
  assert.equal((await (await session(configured,auth(id,email))).json()).requestWritable,false);
 for(const bad of [undefined,null,digest.toUpperCase(),digest+'\n',digest.slice(1),digest+'x',
  digest+','+digest,JSON.stringify([digest]),' '+digest])
  assert.equal((await (await session(route(bad),named)).json()).requestWritable,false);
 assert.equal((await (await session(route('malformed'),auth(owner))).json()).requestWritable,true);
 const post=(browser,authn,c,cmd=command,more={})=>browser('/api/requests','POST',{
  ...authn,Origin:origin,'X-NPCGen-Csrf':c.csrfToken,'X-NPCGen-Frontend-Context':c.contextId,...more},cmd);
 assert.equal((await post(configured,auth('visitor'),ordinary,command,{'X-Email':email,'X-Email-Sha256':digest})).status,403);
 assert.equal((await post(configured,auth('visitor'),selected)).status,403);
 assert.equal((await post(route(digest,()=>false),named,selected)).status,403);
 assert.equal((await post(configured,named,selected,command,{'X-NPCGen-Csrf':'x'})).status,403);
 assert.equal((await post(configured,named,selected,{...command,payload:{...command.payload,projectId:'other'}})).status,400);
 assert.equal((await post(configured,named,selected,{...command,requestType:'site.deploy'})).status,400);
 const accepted=await post(configured,named,selected);
 assert.equal(accepted.status,202);
 const path='/api/requests?queueId='+(await accepted.json()).queueId;
 assert.equal((await configured(path,'GET',auth('visitor'))).status,404);
 assert.equal((await configured(path,'GET',named)).status,200);
 for(const path of ['/api/space/audio-requests','/api/npc-one-stop','/mcp','/api/site/access'])
  assert.equal(await configured(path,'POST',named,command),null);
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
 for(const [i,payload] of [{...base,text:lyric},{...base,lyricsRequest:'이야기를 가사로'}].entries()){
  const response=await browser('/api/requests','POST',auth,{...command,idempotencyKey:'lyrics-'+i,payload});
  assert.equal(response.status,202);
  const {queueId}=await response.json();
  assert.deepEqual((await queue.get({queueId})).payload,payload);
 }
 for(const payload of [{...base,text:lyric,lyricsRequest:'conflict'}, {...base,conceptText:''},
  {...base,lyricsRequest:'이야기를 가사로',durationSeconds:23},{...base,targetDurationSeconds:60}]){
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

test('Space only queues a replacement for the exact published legacy ID and retains any-sized selection within transport',async t=>{
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
 assert.equal((await submit('matched-slug-absent-id',{...payload,character:{...payload.character,npcId:'character.missing',slug:'missing'}})).status,404);
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
 assert.deepEqual(seen,[['a','character.missing'],['a','character.seojin'],['a','character.seojin'],['a','character.yeonwoo']]);
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
