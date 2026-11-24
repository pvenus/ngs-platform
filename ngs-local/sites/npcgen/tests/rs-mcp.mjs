import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRSQueueConsumer,createSpaceRSQueueConsumer,sameMacRSQueue,createRSStaticPropReadiness} from '../build/rs-mcp.mjs';
import {createNgsHealthRelay} from '../build/rs-ops-ngs-health.mjs';
import {createSpaceMachineMcp} from '../build/space-machine-mcp.mjs';
import {loopbackJsonMCP} from '../build/folder-mcp-loopback.mjs';

const list='ngs_request_queue_list',ack='ngs_request_queue_ack',submit='request_submit';
const makeQueue=(title='Track')=>{
 const queueId='ngs.local.'+randomUUID();
 return {queueId,idempotencyKey:queueId,requestType:'audio.generate',payload:{
  schemaVersion:'ngs.audio-generate.v1',projectId:'binari',kind:'bgm',title,conceptId:'category.sound',brief:'Quiet track',text:'',durationSeconds:null,
 }};
};
const idFor=key=>'request.official.'+createHash('sha256').update(JSON.stringify(['request.official.v1','local','binari',key])).digest('hex');
const receipt=row=>({officialRequestId:idFor(row.idempotencyKey),status:'registered'});
test('live static control is derived through read-only MCP and never infers a submit capability',async t=>{
 const requests=[];
 let mode='still',duplicate=false,available=true;
 const tool={name:submit,inputSchema:{properties:{requestType:{enum:['prop.generate','prop.regenerate','prop.animation.generate']}},
  oneOf:['generate','regenerate'].map(action=>({properties:{requestType:{const:'prop.'+action},
   payload:{properties:{schemaVersion:{const:'ngs.prop-'+action+'.v1'},projectId:{const:'binari'},motion:{const:'still'}}}}}))}};
 const server=createServer(async (req,res)=>{
  let raw='';for await(const x of req)raw+=x;
  const {id,method}=JSON.parse(raw);requests.push(method);
  if(!available){res.writeHead(503);res.end();return;}
  if(method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  const current=structuredClone(tool);current.inputSchema.oneOf[0].properties.payload.properties.motion={const:mode};
  const result=method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}}}:
   {tools:duplicate?[current,current]:[current]};
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id,result}));
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
 const read=createRSStaticPropReadiness({url:'http://127.0.0.1:'+server.address().port+'/mcp'});
 assert.deepEqual(await read(),['generate','regenerate']);
 mode='subtle';assert.deepEqual(await read(),['regenerate']);
 duplicate=true;assert.deepEqual(await read(),[]);
 available=false;assert.deepEqual(await read(),[]);
 assert.deepEqual(requests,['initialize','notifications/initialized','tools/list','tools/list','tools/list','tools/list']);
});
test('exact success is acknowledged, lost ACK resumes without another submit, unrelated request progresses',async()=>{
 const a=makeQueue('A'),b=makeQueue('B'),rows=new Map([[a.queueId,a],[b.queueId,b]]);
 let time=0,skipA=true;const attempted=[];
 const consumer=createRSQueueConsumer({now:()=>time,callRS:async(name,args)=>{
  assert.equal(name,submit);assert.equal(args.sourceId,'local');const row=rows.get(args.idempotencyKey);
  assert.deepEqual(args.payload,row.payload);attempted.push(args.idempotencyKey);return receipt(row);
 },callNGS:async(name,args)=>{
  if(name===list){assert.deepEqual(args,{limit:16});return {requests:[...rows.values()]};}
  assert.equal(name,ack);assert.deepEqual(args.receipt,receipt(rows.get(args.queueId)));
  if(skipA&&a.queueId===args.queueId){skipA=false;throw Error('ack lost');}
  rows.delete(args.queueId);return {queueId:args.queueId,status:'acknowledged'};
 }});
 assert.deepEqual(await consumer.pollOnce(),{seen:2,acknowledged:1,unresolved:0,rejected:0,deferred:1});
 time=5000;
 assert.deepEqual(await consumer.pollOnce(),{seen:1,acknowledged:1,unresolved:0,rejected:0,deferred:0});
 assert.deepEqual(attempted,[a.idempotencyKey,b.idempotencyKey]);assert.equal(rows.size,0);
});
test('definite rejection, advanced replay and foreign receipt never erase queued rows',async()=>{
 const a=makeQueue('A'),b=makeQueue('B'),c=makeQueue('C'),d=makeQueue('D');let known=0;
 const consumer=createRSQueueConsumer({callNGS:async(name,args)=>{
  if(name===list)return {requests:[a,b,c,d]};
  assert.equal(args.queueId,d.queueId);known++;return {queueId:d.queueId,status:'acknowledged'};
 },callRS:async(_name,args)=>{
  if(args.idempotencyKey===a.idempotencyKey)throw Object.assign(Error(),{rsCode:'OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT'});
  if(args.idempotencyKey===b.idempotencyKey)throw Object.assign(Error(),{rsCode:'NGS_AUDIO_GENERATE_PAYLOAD_INVALID'});
  return receipt(d); // Deliberate foreign receipt for C.
 }});
 assert.deepEqual(await consumer.pollOnce(),{seen:4,acknowledged:1,unresolved:1,rejected:1,deferred:1});
 assert.equal(known,1);
});
test('untrusted queue data fails closed before transport',async()=>{
 const a=makeQueue();
 for(const rows of [[a,a],[{...a,idempotencyKey:'chosen'}]]){
  const pump=createRSQueueConsumer({callNGS:async()=>({requests:rows}),callRS:async()=>assert.fail('must not submit')});
  await assert.rejects(pump.pollOnce(),/QUEUE_RESPONSE_INVALID/);
 }
});
async function listener(t,server){
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port+'/mcp';
}
async function mockQueue(t,rows){
 return listener(t,createServer(async(req,res)=>{
  const parts=[];for await(const c of req)parts.push(c);
  const msg=JSON.parse(Buffer.concat(parts));
  if(!Object.hasOwn(msg,'id')){res.writeHead(202).end();return;}
  function respond(result){
   res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}));
  }
  if(msg.method==='initialize'){respond({protocolVersion:'2025-06-18',capabilities:{tools:{}}});return;}
  const {name,arguments:args}=msg.params;
  let dto;
  if(name===list)dto={requests:[...rows.values()]};
  else{
   assert.equal(name,ack);assert.deepEqual(args.receipt,receipt(rows.get(args.queueId)));
   rows.delete(args.queueId);dto={queueId:args.queueId,status:'acknowledged'};
  }
  respond({isError:false,structuredContent:dto});
 }));
}
test('real unmodified RS MCP plus rollback/restart keeps an already-planned ambiguous row without creating another',
 {skip:!process.env.NGS_LEGACY_RS_SOURCE},async t=>{
 const {createRequestService}=await import(pathToFileURL(join(process.env.NGS_LEGACY_RS_SOURCE,'request-service.mjs')).href);
 const p=mkdtempSync(join(realpathSync(tmpdir()),'ngs-rs-mcp-fixture-'));
 const rsUrl=await listener(t,createRequestService({directory:join(p,'inbox')}));
 t.after(()=>rmSync(p,{recursive:true,force:true}));
 const actual=loopbackJsonMCP(rsUrl);
 const a=makeQueue('Accepted before restart'),b=makeQueue('Independent good row');
 // Model a previous pass committing in RS while reply to the older process was lost.
 const prior=await actual(submit,{sourceId:'local',requestType:a.requestType,idempotencyKey:a.idempotencyKey,payload:a.payload});
 assert.deepEqual(prior,receipt(a));
 await actual('request_update_status',{officialRequestId:prior.officialRequestId,status:'planned'});
 const pending=new Map([[a.queueId,a],[b.queueId,b]]);
 const ngsUrl=await mockQueue(t,pending);
 const result=await sameMacRSQueue({ngsUrl,rsUrl}).pollOnce();
 assert.deepEqual(result,{seen:2,acknowledged:1,unresolved:1,rejected:0,deferred:0});
 assert.deepEqual([...pending.keys()],[a.queueId]);
 const rows=(await actual('request_list',{})).requests;
 assert.equal(rows.length,2);assert.equal(rows.find(row=>row.officialRequestId===prior.officialRequestId).status,'planned');
});

test('full first page of unresolved work does not block the next independent page',async()=>{
 const first=Array.from({length:16},()=>makeQueue()),last=makeQueue('later');
 const acks=[];
 const consumer=createRSQueueConsumer({callNGS:async(name,args)=>{
  if(name===list){
   if(args.cursor){assert.equal(args.cursor,'q1.16');return {requests:[last]};}
   return {requests:first,nextCursor:'q1.16'};
  }
  acks.push(args.queueId);return {queueId:args.queueId,status:'acknowledged'};
 },callRS:async(_name,args)=>{
  if(args.idempotencyKey===last.idempotencyKey)return receipt(last);
  throw Object.assign(Error(),{rsCode:'OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT'});
 }});
 assert.equal((await consumer.pollOnce()).unresolved,16);
 assert.equal((await consumer.pollOnce()).acknowledged,1);
 assert.deepEqual(acks,[last.queueId]);
});
test('malformed own payload is rejected without blocking the next row',async()=>{
 const bad=makeQueue(),good=makeQueue(),acks=[];
 bad.payload.projectId='foreign';
 const consumer=createRSQueueConsumer({callNGS:async(name,args)=>{
  if(name===list)return {requests:[bad,good]};
  acks.push(args.queueId);return {queueId:args.queueId,status:'acknowledged'};
 },callRS:async(_name,args)=>{assert.equal(args.idempotencyKey,good.queueId);return receipt(good);}});
 const res=await consumer.pollOnce();assert.equal(res.rejected,1);assert.deepEqual(acks,[good.queueId]);
});

test('real durable queue + unchanged RS: 16 unresolved accepted IDs do not starve row 17',
 {skip:!process.env.NGS_LEGACY_RS_SOURCE||!process.env.NGS_REQUEST_QUEUE_SOURCE},async t=>{
 const load=(root,name)=>import(pathToFileURL(join(root,name)).href);
 const {createRequestService}=await load(process.env.NGS_LEGACY_RS_SOURCE,'request-service.mjs');
 const {openLocalRequestQueue}=await load(process.env.NGS_REQUEST_QUEUE_SOURCE,'local-request-queue.mjs');
 const {createLocalRequestQueueMcp}=await load(process.env.NGS_REQUEST_QUEUE_SOURCE,'local-request-queue-mcp.mjs');
 const p=mkdtempSync(join(realpathSync(tmpdir()),'rs-mcp-paired-'));
 const queue=openLocalRequestQueue(join(p,'queue.sqlite'),{now:()=>1});
 const rsUrl=await listener(t,createRequestService({directory:join(p,'official')}));
 const ngsUrl=await listener(t,createLocalRequestQueueMcp(queue));
 t.after(()=>{queue.close();rmSync(p,{recursive:true,force:true});});
 const actual=loopbackJsonMCP(rsUrl);
 const created=[];
 for(let i=0;i<17;i++){
  const r=makeQueue('Track '+i);
  const enqueued=queue.enqueue({idempotencyKey:r.idempotencyKey,requestType:r.requestType,payload:r.payload});
  created.push(enqueued.queueId);
  if(i<16){
   const result=await actual(submit,{sourceId:'local',requestType:r.requestType,idempotencyKey:enqueued.queueId,payload:r.payload});
   await actual('request_update_status',{officialRequestId:result.officialRequestId,status:'planned'});
  }
 }
 const pump=sameMacRSQueue({ngsUrl,rsUrl});
 assert.deepEqual(await pump.pollOnce(),{seen:16,acknowledged:0,unresolved:16,rejected:0,deferred:0});
 assert.deepEqual(await pump.pollOnce(),{seen:1,acknowledged:1,unresolved:0,rejected:0,deferred:0});
 assert.equal(queue.read(created[0]).status,'queued');
 assert.deepEqual(queue.read(created[16]),{queueId:created[16],status:'registered',
  receipt:{officialRequestId:idFor(created[16]),status:'registered'}});
 const results=await actual('request_list',{});
 assert.equal(results.requests.length,17);
});


test('non-progressing or false continuation is rejected rather than looping forever',async()=>{
 const first=Array.from({length:16},()=>makeQueue()),cursor='q1.16';
 let requests=0;
 const consumer=createRSQueueConsumer({callNGS:async()=>{requests++;return {requests:first,nextCursor:cursor};},
  callRS:async()=>{throw Object.assign(Error(),{rsCode:'OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT'});}});
 assert.equal((await consumer.pollOnce()).unresolved,16);
 await assert.rejects(consumer.pollOnce(),/QUEUE_RESPONSE_INVALID/);assert.equal(requests,2);
});

test('empty authenticated Local and Space lists relay version observations; bad payload does not',async t=>{
 const sha='a'.repeat(40),calls=[];
 const observeNgs=(...args)=>calls.push(args);
 const ngsUrl=await listener(t,createServer(async(req,res)=>{
  const parts=[];for await(const c of req)parts.push(c);
  const msg=JSON.parse(Buffer.concat(parts));
  if(!Object.hasOwn(msg,'id')){res.writeHead(202).end();return;}
  const result=msg.method==='initialize'?{protocolVersion:'2025-06-18',capabilities:{tools:{}}}:
   {isError:false,structuredContent:{requests:[]}};
  res.writeHead(200,{'Content-Type':'application/json','X-NGS-Commit-Sha':sha});
  res.end(JSON.stringify({jsonrpc:'2.0',id:msg.id,result}));
 }));
 // An empty queue never contacts RS (port 1 intentionally unusable).
 const local=sameMacRSQueue({ngsUrl,rsUrl:'http://127.0.0.1:1/mcp',observeNgs});
 assert.equal((await local.pollOnce()).seen,0);
 let state='legacy';
 const space= createSpaceMachineMcp({token:'c'.repeat(64),platformToken:'test'.repeat(8),send:async(_url,wire)=>{
  const {id,params}=JSON.parse(wire.body);
  assert.equal(params.name,'space_requests_pending');
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result:{isError:false,
   structuredContent:state==='bad'?{invalid:true}:{requests:[]}}}),
   {headers:{'Content-Type':'application/json',...(state==='legacy'?{}:{'X-NGS-Commit-Sha':sha})}});
 }});
 const pump=createSpaceRSQueueConsumer({callNGS:space,callRS:()=>assert.fail('empty queue touched RS'),observeNgs});
 assert.equal((await pump.pollOnce()).seen,0);
 state='new';assert.equal((await pump.pollOnce()).seen,0);
 state='bad';await assert.rejects(pump.pollOnce(),/RESPONSE_INVALID/);
 assert.deepEqual(calls,[['local',sha],['space',null],['space',sha]]);
});

test('RS observer sends common OPS heartbeats for each source, coalesces stable replies, and tolerates OPS failure',async()=>{
 const hits=[]; let time=0,status=200;
 const relay=createNgsHealthRelay({now:()=>time,send:async(url,opts)=>{
  assert.equal(url,'http://127.0.0.1:8090/api/service-heartbeat');
  hits.push(JSON.parse(opts.body));return new Response(null,{status});
 }});
 const sha='a'.repeat(40),newSha='b'.repeat(40);
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 relay('local',sha);relay('local',sha);relay('space','bad');relay('other',sha);await flush();
 relay('local',sha);relay('local',newSha);await flush();
 status=503; time=60_000;relay('space',undefined);await flush();
 relay('space',sha);assert.equal(hits.length,4);
 status=200; time+=5000;relay('space',sha);await flush();
 assert.deepEqual(hits,[{serverName:'ngs-local',commitSha:sha},{serverName:'ngs-space'},
  {serverName:'ngs-local',commitSha:newSha},{serverName:'ngs-space'},{serverName:'ngs-space',commitSha:sha}]);
});

test('a slow or unavailable health receiver never delays handing off queue contents',async()=>{
 const a=makeQueue();let release;
 const busy=new Promise(resolve=>{release=resolve;});
 try{
  const pump=createRSQueueConsumer({observeNgs:()=>busy,callNGS:async name=>name===list?{requests:[a]}:
   {queueId:a.queueId,status:'acknowledged'},callRS:async()=>receipt(a)});
  assert.equal((await pump.pollOnce()).acknowledged,1);
 }finally{release();}
});
