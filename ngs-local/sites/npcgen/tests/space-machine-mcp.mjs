import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync,readFileSync,readdirSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSpaceMachineMcp,createSpaceFileSyncUpload,spaceMachineConfiguration,SPACE_SITE_MCP_URL,SPACE_MACHINE_CREDENTIALS_ENV} from '../build/space-machine-mcp.mjs';
import {createSpaceRSQueueConsumer,createRSQueueConsumer} from '../build/rs-mcp.mjs';
import {createSpaceFileSyncDestination} from '../build/pds-mcp-file-sync.mjs';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';

const key='0123456789abcdef'.repeat(4),platform='fixture-platform-token.'+'p'.repeat(32);
const sha=x=>createHash('sha256').update(x).digest('hex');
const ticket=source=>'ngs.'+source+'.'+randomUUID();
const row=source=>{const queueId=ticket(source);return {queueId,idempotencyKey:queueId,requestType:'audio.generate',payload:{
 schemaVersion:'ngs.audio-generate.v1',projectId:'binari',kind:'bgm',title:'fixture',conceptId:'category.fixture',brief:'fixture audio',text:'',durationSeconds:null,
}};};
const receipt=(source,r)=>({officialRequestId:'request.official.'+sha(JSON.stringify(['request.official.v1',source,'binari',r.queueId])),status:'registered'});
function hosted(handler){
 return async(url,request)=>{
  assert.equal(url,SPACE_SITE_MCP_URL);assert.equal(request.redirect,'error');assert.equal(request.method,'POST');
  const h=new Headers(request.headers);
  assert.equal(h.get('x-ngs-machine-token'),key);assert.equal(h.get('origin'),null);
  assert.equal(h.get('oai-sites-authorization'),'Bearer '+platform);
  assert.equal(h.get('mcp-protocol-version'),'2026-07-28');
  const input=JSON.parse(request.body);
  assert.equal(input.jsonrpc,'2.0');assert.equal(input.method,'tools/call');
  const result=await handler(input.params.name,input.params.arguments);
  return Response.json({jsonrpc:'2.0',id:input.id,result:{isError:false,structuredContent:result}});
 };
}

test('private credential file and pinned transport reject mode drift, unsafe tokens, action and unverified response',async t=>{
 assert.throws(()=>spaceMachineConfiguration({}),/CONFIGURATION_REQUIRED/);
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'ngs-space-secret-fixture-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const p=join(dir,'fixture.json'),link=join(dir,'link.json'),options={[SPACE_MACHINE_CREDENTIALS_ENV]:p};
 const write=value=>writeFileSync(p,JSON.stringify(value),{mode:0o600});
 write({token:key,platformToken:key});
 assert.throws(()=>spaceMachineConfiguration(options),/CONFIGURATION_REQUIRED/);
 write({token:key+'\n',platformToken:platform});
 assert.throws(()=>spaceMachineConfiguration(options),/CONFIGURATION_REQUIRED/);
 write({token:key,platformToken:platform});
 chmodSync(p,0o644);assert.throws(()=>spaceMachineConfiguration(options),/CONFIGURATION_REQUIRED/);
 chmodSync(p,0o600);symlinkSync(p,link);
 assert.throws(()=>spaceMachineConfiguration({[SPACE_MACHINE_CREDENTIALS_ENV]:link}),/CONFIGURATION_REQUIRED/);
 const cfg=spaceMachineConfiguration(options);
 let calls=0;
 const call=createSpaceMachineMcp({...cfg,send:hosted(async(name,args)=>{
  calls++;assert.equal(name,'space_requests_pending');assert.deepEqual(args,{limit:16});return {requests:[]};
 })});
 await assert.rejects(call('npc_mirror_dispatch',{}),/MCP_DENIED/);assert.equal(calls,0);
 assert.deepEqual(await call('space_requests_pending',{limit:16}),{requests:[]});assert.equal(calls,1);
 const wrong=createSpaceMachineMcp({token:key,platformToken:platform,send:async()=>Response.json({jsonrpc:'2.0',id:999,result:{isError:false,structuredContent:{requests:[]}}})});
 await assert.rejects(wrong('space_requests_pending',{}),/UNAVAILABLE/);
 const unauthorized=createSpaceMachineMcp({token:key,platformToken:platform,send:async()=>new Response('Sign In',{status:401})});
 await assert.rejects(unauthorized('space_requests_pending',{}),/MCP_DENIED/);
});

test('bounded ticket-only Space delivery uses distinct provenance and exact receipt, local remains independent',async()=>{
 const remote=row('space'),local=row('local');
 const events=[];
 let remoteSettled=false, release;
 const hostedGate=new Promise(resolve=>release=resolve);
 const remotePump=createSpaceRSQueueConsumer({
  callNGS:createSpaceMachineMcp({token:key,platformToken:platform,send:hosted(async(name,args)=>{
   events.push(name);
   if(name==='space_requests_pending'){assert.deepEqual(args,{limit:16});await hostedGate;return {requests:remoteSettled?[]:[remote]};}
   assert.equal(name,'space_requests_ack');assert.deepEqual(args,{queueId:remote.queueId,receipt:{...receipt('space',remote),status:'completed',registeredAt:12345}});
   remoteSettled=true;return {queueId:remote.queueId,status:'acknowledged'};
  })}),
  callRS:async(name,args)=>{
   events.push(name);assert.equal(name,'request_submit_space');
   assert.deepEqual(args,{queueId:remote.queueId});return {...receipt('space',remote),status:'completed',registeredAt:12345};
  },
 });
 const localPump=createRSQueueConsumer({
  callNGS:async(name,args)=>{
   if(name==='ngs_request_queue_list')return {requests:[local]};
   assert.equal(name,'ngs_request_queue_ack');assert.deepEqual(args,{queueId:local.queueId,receipt:receipt('local',local)});
   return {queueId:local.queueId,status:'acknowledged'};
  },
  callRS:async(name,args)=>{
   assert.equal(name,'request_submit');assert.deepEqual(args,{sourceId:'local',requestType:local.requestType,idempotencyKey:local.queueId,payload:local.payload});
   return receipt('local',local);
  },
 });
 const remoteFlight=remotePump.pollOnce();
 assert.equal((await localPump.pollOnce()).acknowledged,1);
 assert.equal(remoteSettled,false);release();
 assert.equal((await remoteFlight).acknowledged,1);
 assert.deepEqual(events,['space_requests_pending','request_submit_space','space_requests_ack']);
});

test('ambiguous source/provenance does not acknowledge Space queue',async()=>{
 const pending=row('space');
 for(const proof of [receipt('space',pending),{...receipt('local',pending),registeredAt:1234},
   {...receipt('space',pending),status:'unknown',registeredAt:1234}]){
  const pump=createSpaceRSQueueConsumer({callNGS:async(name,args)=>{
   assert.equal(name,'space_requests_pending');return {requests:[pending]};
  },callRS:async()=>proof});
  const r=await pump.pollOnce();
  assert.equal(r.deferred,1);assert.equal(r.acknowledged,0);
 }
});

test('whole hosted binary upload binds both existing scoped credentials, no chunk fallback',async()=>{
 const bytes=Buffer.from('fixture'),path='audio/테스트.wav',syncId='ngs.sync.6f56d34f-62ca-42a7-a173-14700d922865';
 const calls=[];
 const upload=createSpaceFileSyncUpload({token:key,platformToken:platform,send:async(url,init)=>{
  assert.equal(url,new URL('/api/ngs-file-sync-file',SPACE_SITE_MCP_URL).href);
  assert.equal(init.headers['X-NGS-Machine-Token'],key);
  assert.equal(init.headers['OAI-Sites-Authorization'],'Bearer '+platform);
  assert.equal(init.headers['X-NGS-Sync-Id'],syncId);
  assert.equal(init.headers['X-NGS-File-Path'],Buffer.from(path).toString('base64url'));
  assert.equal(init.headers['X-NGS-File-Sha256'],sha(bytes));
  assert.equal(init.headers['Content-Length'],String(bytes.length));
  assert.equal(init.headers['Content-Type'],'application/octet-stream');
  assert.equal(init.headers.Origin,undefined);
  assert.equal(init.redirect,'error');
  assert.deepEqual(Buffer.from(await new Response(init.body).arrayBuffer()),bytes);
  calls.push(init.method);
  return Response.json({ok:true});
 }});
 const meta={syncId,path,sha256:sha(bytes),size:bytes.length};
 assert.deepEqual(await upload(meta,()=>new Response(bytes).body),{ok:true});
 assert.deepEqual(calls,['POST']);
 const mcp=createSpaceMachineMcp({token:key,platformToken:platform,send(){assert.fail('raw file must not use RPC');}});
 await assert.rejects(mcp('ngs_file_sync_file_chunk',{}),/NGS_SPACE_MACHINE_MCP_DENIED/);
 for(const [status,error,definite] of [[409,'NGS_FILE_SYNC_CONTENT_MISMATCH',true],[503,'NGS_FILE_SYNC_CONTENT_MISMATCH',false],[409,'PRIVATE_DETAIL',false]]){
  const rejected=createSpaceFileSyncUpload({token:key,platformToken:platform,send:async()=>Response.json({error},{status})});
  await assert.rejects(rejected(meta,()=>new Response(bytes).body),e=>definite?e.definite===true&&e.message===error:
   e.definite===undefined&&e.message==='NGS_SPACE_FILE_UPLOAD_UNAVAILABLE');
 }
});

test('paired exact Site browser queue + machine transport + genuine official Space RS over loopback', {
 skip:!process.env.NGS_SPACE_QUEUE_OVERLAY||!process.env.NGS_SPACE_BACKEND_SOURCE,
},async t=>{
 const {DatabaseSync}=await import('node:sqlite');
 const {copyFileSync,symlinkSync}=await import('node:fs');
 const {pathToFileURL,fileURLToPath}=await import('node:url');
 const {loopbackJsonMCP}=await import('../build/folder-mcp-loopback.mjs');
 const hostedRoot=process.env.NGS_SPACE_QUEUE_OVERLAY;
 const backend=process.env.NGS_SPACE_BACKEND_SOURCE;
 const fixture=mkdtempSync(join(realpathSync(tmpdir()),'ngs-space-real-queue-'));
 mkdirSync(join(fixture,'build'),{mode:0o700});
 for(const f of ['space-machine-routes.mjs','space-request-queue.mjs'])copyFileSync(join(hostedRoot,'build',f),join(fixture,'build',f));
 symlinkSync(fileURLToPath(new URL('../../../',import.meta.url)),join(fixture,'ngs-local'),'dir');
 const {machineResponse,browserQueueResponse}=await import(pathToFileURL(join(fixture,'build','space-machine-routes.mjs')).href);
 const {createRequestService}=await import(pathToFileURL(join(backend,'request-service','request-service.mjs')).href);
 const sql=new DatabaseSync(':memory:');
 sql.exec(readFileSync(join(hostedRoot,'drizzle','0013_space_request_queue.sql'),'utf8'));
 const db={prepare(query){return {bind(...args){const stmt=sql.prepare(query);return {
  run:async()=>stmt.run(...args),first:async()=>stmt.get(...args),all:async()=>({results:stmt.all(...args)}),
 };}};}};
 let ownerReads=0,receipts=0;
 const callNGS=createSpaceMachineMcp({token:key,platformToken:platform,send:async(url,req)=>{
  const h=new Headers(req.headers);assert.equal(h.get('oai-sites-authorization'),'Bearer '+platform);
  h.delete('oai-sites-authorization'); // Fixture models platform consumption, not platform auth coverage.
  const name=JSON.parse(req.body).params.name;
  if(name==='space_requests_get')ownerReads++;
  if(name==='space_requests_ack')receipts++;
  return machineResponse(new Request(url,{...req,headers:h}),{db,secret:key});
 }});
 const rs=createRequestService({directory:join(fixture,'official'),readSpaceRequest:id=>callNGS('space_requests_get',{queueId:id})});
 await new Promise(resolve=>rs.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(ok=>rs.close(ok));sql.close();rmSync(fixture,{recursive:true,force:true});});
 const callRS=loopbackJsonMCP('http://127.0.0.1:'+rs.address().port+'/mcp');
 const origin=new URL(SPACE_SITE_MCP_URL).origin;
 const actor={'oai-authenticated-user-id':'fixture-id','oai-authenticated-user-email':'fixture@example.invalid'};
 const browser=(path,init={})=>browserQueueResponse(new Request(origin+path,{...init,headers:{...actor,...init.headers}}),
  {db,secret:key,authorize:async u=>u.userId==='fixture-id',authorizeWrite:async u=>u.userId==='fixture-id'});
 const session=await (await browser('/__npcgen_session')).json();
 const draft=row('space');
 const submitted=await browser('/api/requests',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',
  'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId},
  body:JSON.stringify({idempotencyKey:draft.idempotencyKey,requestType:draft.requestType,payload:draft.payload})});
 assert.equal(submitted.status,202);
 const {queueId,status}=await submitted.json();assert.equal(status,'queued');
 const prior=await callRS('request_submit_space',{queueId});
 assert.equal(prior.status,'registered');
 await callRS('request_update_status',{officialRequestId:prior.officialRequestId,status:'planned'});
 const consumer=createSpaceRSQueueConsumer({callNGS,callRS});
 assert.equal((await consumer.pollOnce()).acknowledged,1);
 assert.equal(ownerReads,2);assert.equal(receipts,1);
 assert.deepEqual(await callNGS('space_requests_pending',{limit:16}),{requests:[]});
 assert.deepEqual(await (await browser('/api/requests?queueId='+queueId)).json(),
  {queueId,status:'registered',receipt:{officialRequestId:prior.officialRequestId,status:'registered'}});
 const {requests}=await callRS('request_list',{});
 assert.equal(requests.length,1);assert.equal(requests[0].sourceId,'space');assert.equal(requests[0].status,'planned');
});

test('genuine PDS MCP → pinned machine HTTP envelope → actual hosted D1/R2 receiver and recoverable tombstone', {
 skip:!process.env.NGS_SPACE_QUEUE_OVERLAY||!process.env.NGS_SPACE_FILE_OVERLAY||
  !process.env.NGS_SPACE_TEST_PACKAGE_JSON||!process.env.NGS_EXISTING_PDS_SOURCE,
},async t=>{
 const {createRequire}=await import('node:module');
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {createInterface}=await import('node:readline');
 const {fileURLToPath}=await import('node:url');
 const {loopbackFolderMCP}=await import('../build/folder-mcp-loopback.mjs');
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-space-real-file-')),canonical=join(root,'canonical-files');
 const scope='binari',target='assets/result.bin',physical=join(canonical,scope,target);
 const original=Buffer.alloc(Math.round(19.2*1024*1024),37);
 mkdirSync(join(canonical,scope,'assets'),{recursive:true,mode:0o700});
 writeFileSync(join(canonical,scope,'project.json'),'{"name":"fixture"}',{mode:0o600});
 writeFileSync(physical,original,{mode:0o600});
 const child=spawn(process.env.NGS_EXISTING_PDS_PYTHON??'python3',['-u','-B','-c',`
import sys
from http.server import ThreadingHTTPServer
from project_data_service.http_server import Handler
from project_data_service.project_folders import configured
with ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
    server.project_folders=configured(sys.argv[1],'127.0.0.1',validate_mount=False)
    print(server.server_port,flush=True)
    server.serve_forever()
`,canonical],{env:{...process.env,PYTHONPATH:process.env.NGS_EXISTING_PDS_SOURCE},stdio:['ignore','pipe','ignore']});
 const done=once(child,'close');
 let mini;
 t.after(async()=>{child.kill();await done;await mini?.dispose();rmSync(root,{recursive:true,force:true});});
 const lines=createInterface({input:child.stdout}),[port]=await Promise.race([once(lines,'line'),done.then(()=>{throw Error('PDS fixture exited');})]);
 lines.close();
 const pds=createFolderMcpClient({call:loopbackFolderMCP('http://127.0.0.1:'+port+'/mcp')});
 const fileOverlay=process.env.NGS_SPACE_FILE_OVERLAY;
 const mod=(path,url)=>({type:'ESModule',path,contents:readFileSync(url,'utf8')});
 const {pushSpaceProjectFiles}=await import('../build/pds-mcp-file-sync.mjs');
 const {Miniflare}=createRequire(process.env.NGS_SPACE_TEST_PACKAGE_JSON)('miniflare');
 mini=new Miniflare({d1Databases:['DB'],r2Buckets:['BUCKET'],compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
  modules:[{type:'ESModule',path:'test.mjs',contents:`
   import {createSpaceFileReplica,spaceFileSyncTools} from './build/space-file-replica.mjs';
   import {machineResponse} from './build/space-machine-routes.mjs';
   export default {async fetch(req,env){
    const replica=createSpaceFileReplica({db:env.DB,bucket:env.BUCKET});
    return await machineResponse(req,{db:env.DB,secret:${JSON.stringify(key)},fileReplica:replica,fileTools:spaceFileSyncTools})
     ?? new Response(null,{status:404});
   }};
  `},
   ...['space-file-replica','space-machine-routes','space-request-queue'].map(name=>mod('build/'+name+'.mjs',join(fileOverlay,'build',name+'.mjs'))),
   ...['object-replica','replica-whole-file-wire'].map(name=>mod('ngs-local/sites/npcgen/build/'+name+'.mjs',new URL('../build/'+name+'.mjs',import.meta.url))),
  ]});
 const db=await mini.getD1Database('DB'),bucket=await mini.getR2Bucket('BUCKET');
 const stages=[
  join(fileOverlay,'drizzle','0014_space_file_replica_versions.sql'),
  fileURLToPath(new URL('../../../dev/0015_replica_sync_progress.sql',import.meta.url)),
 ];
 for(const stage of stages)for(const sql of readFileSync(stage,'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql).run();
 await bucket.put('legacy/untouched','older untouched bytes');
 const wires=[];
 const send=(url,req)=>{
  if(new URL(url).pathname==='/api/ngs-file-sync-file')wires.push(Number(req.headers['Content-Length']));
  return mini.dispatchFetch(url,req);
 };
 const ngs=createSpaceFileSyncDestination({token:key,platformToken:platform,send});
 const upload=createSpaceFileSyncUpload({token:key,platformToken:platform,send});
 assert.deepEqual(await pushSpaceProjectFiles({scope,pds,ngs,upload}),{ok:true,written:2,failed:0});
 assert.equal(wires.length,2);
 assert.ok(wires.includes(original.length));
 const currentVersion=()=>db.prepare('SELECT object_key FROM ngs_replica_version_v2 WHERE path=? ORDER BY version DESC LIMIT 1').bind(target).first();
 const published=(await currentVersion()).object_key,current=await bucket.get(published);
 assert.deepEqual(Buffer.from(await current.arrayBuffer()),original);
 assert.deepEqual(await pushSpaceProjectFiles({scope,pds,ngs,upload}),{ok:true,written:0,failed:0});
 rmSync(physical); // Only the disposable fixture defines this authoritative removal.
 assert.deepEqual(await pushSpaceProjectFiles({scope,pds,ngs,upload}),{ok:true,written:0,failed:0});
 assert.equal((await currentVersion()).object_key,null);
 assert.equal(wires.length,2,'no file bodies used for rebroadcast or tombstone');
 const previous=await bucket.get(published);
 assert.deepEqual(Buffer.from(await previous.arrayBuffer()),original);
 assert.equal(await (await bucket.get('legacy/untouched')).text(),'older untouched bytes');
});

test('Space file transport exposes only an exact allowed error, not arbitrary remote detail',async()=>{
 for(const [result,want] of [
  [{status:409,error:'NGS_FILE_SYNC_BUSY'},'NGS_FILE_SYNC_BUSY'],
  [{status:400,error:'NGS_FILE_SYNC_BUSY'},'NGS_SPACE_MACHINE_MCP_UNAVAILABLE'],
  [{status:409,error:'PRIVATE_DETAIL'},'NGS_SPACE_MACHINE_MCP_UNAVAILABLE'],
  [{status:409,error:'NGS_FILE_SYNC_BUSY',extra:'private'},'NGS_SPACE_MACHINE_MCP_UNAVAILABLE'],
 ]){
  const call=createSpaceMachineMcp({token:key,platformToken:platform,send:async(_url,init)=>{
   const body=JSON.parse(init.body);
   assert.equal(body.params.name,'ngs_file_sync_file_reset');
   return Response.json({jsonrpc:'2.0',id:body.id,result:{isError:true,structuredContent:result}});
  }});
  await assert.rejects(call('ngs_file_sync_file_reset',{syncId:'fixture',path:'a'}),{message:want});
 }
});

test('wire accepts progress controls but no obsolete batching or oversized non-file call',async()=>{
 const sends=[];
 const call=createSpaceMachineMcp({token:key,platformToken:platform,send:async(_url,init)=>{
  const req=JSON.parse(init.body);sends.push(req.params.name);
  return Response.json({jsonrpc:'2.0',id:req.id,result:{isError:false,structuredContent:{ok:true}}});
 }});
 const syncId='ngs.sync.6f56d34f-62ca-42a7-a173-14700d922865';
 await call('ngs_file_sync_plan',{syncId,totalFiles:1});
 await call('ngs_file_sync_file_failed',{syncId,path:'fixture'});
 await assert.rejects(call('ngs_file_sync_file_batch',{syncId,files:[]}),/NGS_SPACE_MACHINE_MCP_DENIED/);
 await assert.rejects(call('ngs_file_sync_plan',{syncId,totalFiles:1,payload:'x'.repeat(96*1024)}),/NGS_SPACE_MACHINE_MCP_DENIED/);
 assert.deepEqual(sends,['ngs_file_sync_plan','ngs_file_sync_file_failed']);
});
