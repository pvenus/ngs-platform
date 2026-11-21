import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {machineResponse,browserQueueResponse} from '../build/space-machine-routes.mjs';
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
 assert.deepEqual(methods.result.tools.map(tool=>tool.name),['space_requests_pending','space_requests_get','space_requests_ack']);
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
