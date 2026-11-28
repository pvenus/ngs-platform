/** Sterile Miniflare integration test; no credentials or live bindings. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const here=base=>new URL(base,import.meta.url);
const {Miniflare}=createRequire(process.env.SPACE_TEST_PACKAGE_JSON??here('../../../sites/npcgen/package.json'))('miniflare');
const receiver=readFileSync(here('../build/space-file-replica.mjs'),'utf8');
const sourcePath='ngs-local/sites/npcgen/build/object-replica.mjs';
const base=existsSync(here('../'+sourcePath))?'../':'../../../';
const core=readFileSync(here(base+sourcePath),'utf8');
const schema=['0014_space_file_replica_versions.sql','0015_replica_sync_progress.sql','0016_audio_result_index.sql']
 .flatMap(file=>readFileSync(here(base+'ngs-local/dev/'+file),'utf8').split('--> statement-breakpoint'));
const module=(path,relative)=>({type:'ESModule',path,contents:readFileSync(here(relative),'utf8')});
const localBuild='ngs-local/sites/npcgen/build/';
const token='a'.repeat(64); // fixture only, no external access

const root='ngs-replica/v1/binari/',other='legacy/untouched';
const mini=new Miniflare({
 d1Databases:['DB'],r2Buckets:['BUCKET'],compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
 modules:[{type:'ESModule',path:'test.mjs',contents:`
 import {createSpaceFileReplica,spaceFileSyncTools} from './build/space-file-replica.mjs';
 import {machineResponse} from './build/space-machine-routes.mjs';
 import {spaceViewerResponse} from './build/space-viewer-export.mjs';
 export default {async fetch(request,env){
  const url=new URL(request.url),binary=url.pathname==='/api/ngs-file-sync-file';
  let put=0,multipart=0;
  const bucket=binary?new Proxy(env.BUCKET,{get(target,key){
   const original=target[key];
   if(typeof original!=='function')return original;
   return (...args)=>{if(key==='put')put++;if(key==='createMultipartUpload')multipart++;return original.apply(target,args);};
  }}):env.BUCKET;
  const replica=createSpaceFileReplica({db:env.DB,bucket});
  if(url.pathname.startsWith('/api/viewer/'))return spaceViewerResponse(request,{replica,
   authorizeParticipant:async user=>user.userId==='test-team',authorizeResource:async (_,project,resource)=>project==='binari'&&resource==='props'});
  if(binary){
   const result=await machineResponse(request,{secret:'a'.repeat(64),fileReplica:replica,fileTools:spaceFileSyncTools});
   const headers=new Headers(result.headers);headers.set('x-test-puts',String(put));headers.set('x-test-multipart',String(multipart));
   return new Response(result.body,{status:result.status,headers});
  }
  if(url.pathname==='/api/space-machine-mcp')
   return machineResponse(request,{secret:'a'.repeat(64),fileReplica:replica,fileTools:spaceFileSyncTools});
  const {method,args}=await request.json();
  try {
   if(method==='read'){
    const item=await replica.get(args.path,args.options);
    return item?new Response(item.body):new Response(null,{status:404});
   }
   const result=method==='list'?await replica.list(args?.prefix):method==='progress'?await replica.progress():await replica.call(method,args);
   return Response.json(result);
  }catch(e){return Response.json({message:e.message},{status:e.status??500});}
 }};
 `},{type:'ESModule',path:'build/space-file-replica.mjs',contents:receiver},
 {type:'ESModule',path:sourcePath,contents:core},
 module('build/space-machine-routes.mjs','../build/space-machine-routes.mjs'),
 module('build/space-browser-auth.mjs','../build/space-browser-auth.mjs'),
 module('build/space-viewer-export.mjs','../build/space-viewer-export.mjs'),
 module('build/space-request-queue.mjs','../build/space-request-queue.mjs'),
 module('build/space-map-assembly.mjs','../build/space-map-assembly.mjs'),
 ...['cinematic-sequence-contract.mjs','cinematic-timeline.mjs','cinematic-player.mjs','cinematic-contract.mjs','prop-workspace-contract.mjs','map-contract.mjs','assembly-contract.mjs','file-update-envelope.mjs','assembly-sprite-layout.mjs','prop-folder-delete-contract.mjs','workspace-map-assembly-admission.mjs','audio-result-index.mjs','replica-whole-file-wire.mjs','local-concept-category-contract.mjs','local-npc-planning-ui.mjs','local-concept-category-ui.mjs',
     'local-request-queue-browser.mjs','local-audio-workspace.mjs','motion-preset-convert-2d.mjs','npc-motion-selection.mjs'].map(f=>module(localBuild+f,base+localBuild+f)),],
});
const send=(method,args)=>mini.dispatchFetch('http://receiver.invalid',{method:'POST',body:JSON.stringify({method,args})});
const rpc=async (method,args,status=200)=>{
 const result=await send('ngs_file_sync_'+method,args),body=await result.json();
 assert.equal(result.status,status,JSON.stringify(body));return body;
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const machine=(name,args,headers={})=>mini.dispatchFetch('http://receiver.invalid/api/space-machine-mcp',{
 method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name,arguments:args}}),
 headers:{'Content-Type':'application/json','X-NGS-Machine-Token':token,...headers},
});
const part=1024*1024;
const envelope=(session,path,data,offset=0,sha=digest(data))=>({
 syncId:session.syncId,path,sha256:sha,size:data.length,offset,dataBase64:data.subarray(offset,offset+part).toString('base64'),
});
try{
 const db=await mini.getD1Database('DB'),bucket=await mini.getR2Bucket('BUCKET');
 for(const sql of schema)await db.prepare(sql).run();
 await bucket.put(other,'untouched');
 await rpc('begin',{scope:'other'},403);
 const a=await rpc('begin',{scope:'binari'});
 assert.deepEqual(a.files,[]);
 const parallel=await rpc('begin',{scope:'binari'});
 const p='assets/large.bin',data=Buffer.alloc(part+91,7),sha=digest(data);
 await rpc('file_chunk',{...envelope(a,p,data),path:'.deleted/private'},400);
 await rpc('file_chunk',{...envelope(a,p,data),path:'a/../private'},400);
 await rpc('file_chunk',{...envelope(a,p,data),path:'a\\private'},400);
 assert.deepEqual(await rpc('file_chunk',envelope(a,p,data)),{nextOffset:part});
 assert.deepEqual(await rpc('file_chunk',envelope(a,p,data)),{nextOffset:part});
 assert.equal((await send('read',{path:p})).status,404);
 const unrelated=Buffer.from('another file');
 assert.deepEqual(await rpc('file_chunk',envelope(parallel,'assets/unrelated.bin',unrelated)),{nextOffset:null});
 assert.equal((await send('read',{path:p})).status,404);
 await rpc('finish',{syncId:parallel.syncId});
 assert.deepEqual(await rpc('file_chunk',envelope(a,p,data,part)),{nextOffset:null});
 assert.deepEqual(await rpc('file_chunk',envelope(a,p,data,part)),{nextOffset:null});
 const range=await send('read',{path:p,options:{range:{offset:part,length:4}}});
 assert.deepEqual(Buffer.from(await range.arrayBuffer()),Buffer.alloc(4,7));
 await rpc('remove',{syncId:a.syncId,path:p,sha256:sha},409);
 assert.deepEqual(await rpc('finish',{syncId:a.syncId}),{ok:true,written:1});
 const b=await rpc('begin',{scope:'binari'});
 assert.deepEqual(b.files,[{path:p,sha256:sha},{path:'assets/unrelated.bin',sha256:digest(unrelated)}]);
 assert.deepEqual(await (await send('list',{prefix:'missing'})).json(),[]);
 assert.deepEqual(await (await send('list',{prefix:'assets'})).json(),b.files);
 assert.equal((await send('list',{prefix:'assets/..'})).status,400);

 assert.deepEqual(await rpc('file_chunk',envelope(b,p,data)),{nextOffset:part});
 assert.deepEqual(await rpc('file_chunk',envelope(b,p,data,part)),{nextOffset:null});
 assert.deepEqual(await rpc('finish',{syncId:b.syncId}),{ok:true,written:0});
 const c=await rpc('begin',{scope:'binari'});
 await rpc('remove',{syncId:c.syncId,path:p,sha256:'0'.repeat(64)},409);
 assert.deepEqual(await rpc('remove',{syncId:c.syncId,path:p,sha256:sha}),{removed:true});
 assert.deepEqual(await rpc('remove',{syncId:c.syncId,path:p,sha256:sha}),{removed:false});
 assert.equal((await send('read',{path:p})).status,404);
 assert.deepEqual(await (await send('list',{})).json(),[{path:'assets/unrelated.bin',sha256:digest(unrelated)}]);
 const prior=await db.prepare('SELECT object_key FROM ngs_replica_version_v2 WHERE path=? AND object_key IS NOT NULL').bind(p).first();
 assert.deepEqual(Buffer.from(await (await bucket.get(prior.object_key)).arrayBuffer()),data);
 assert.equal((await send('read',{path:prior.object_key})).status,404);
 await rpc('finish',{syncId:c.syncId});
 const d=await rpc('begin',{scope:'binari'});
 const minor=Buffer.from('restored');
 assert.deepEqual(await rpc('file_chunk',envelope(d,p,minor)),{nextOffset:null});
 assert.deepEqual(Buffer.from(await (await send('read',{path:p})).arrayBuffer()),minor);
 const bad=await send('ngs_file_sync_file_chunk',envelope(d,'assets/bad.bin',minor,0,'f'.repeat(64)));
 assert.ok(bad.status>=400);
 assert.equal((await send('read',{path:'assets/bad.bin'})).status,404);
 assert.deepEqual(await rpc('file_reset',{syncId:d.syncId,path:'assets/bad.bin'}),{ok:true});
 assert.deepEqual(await rpc('file_chunk',envelope(d,'assets/bad.bin',minor)),{nextOffset:null});
 const inFlight=Buffer.alloc(part*5+7,25),lost='assets/interrupted.bin';
 await rpc('file_chunk',envelope(d,lost,inFlight));
 await rpc('file_chunk',envelope(d,lost,inFlight,part));
 assert.equal((await send('read',{path:lost})).status,404);
 assert.deepEqual(await rpc('file_reset',{syncId:d.syncId,path:lost}),{ok:true});
 await rpc('file_chunk',envelope(d,lost,inFlight,2*part),409);
 for(let offset=0;offset<inFlight.length;offset+=part)await rpc('file_chunk',envelope(d,lost,inFlight,offset));
 assert.equal(digest(Buffer.from(await (await send('read',{path:lost})).arrayBuffer())),digest(inFlight));
 const abandoned='assets/abandoned.bin';
 await rpc('file_chunk',envelope(d,abandoned,inFlight));
 assert.deepEqual(await rpc('finish',{syncId:d.syncId}),{ok:true,written:3});
 assert.equal((await send('read',{path:abandoned})).status,404);
 const startA=await rpc('begin',{scope:'binari'}),startB=await rpc('begin',{scope:'binari'}),race='assets/race.bin';
 const first=Buffer.alloc(part+5,88),second=Buffer.alloc(part+11,89);
 await rpc('file_chunk',envelope(startA,race,first));
 await rpc('file_chunk',envelope(startB,race,second));
 assert.deepEqual(await rpc('file_chunk',envelope(startA,race,first,part)),{nextOffset:null});
 await rpc('file_chunk',envelope(startB,race,second,part),409);
 assert.deepEqual(Buffer.from(await (await send('read',{path:race})).arrayBuffer()),first);
 await rpc('finish',{syncId:startA.syncId});await rpc('finish',{syncId:startB.syncId});
 const legacyPath='legacy-demo.bin',legacyBytes=Buffer.from('pre-existing known source');
 await bucket.put(root+'files/'+legacyPath,legacyBytes,{customMetadata:{sha256:digest(legacyBytes)}});
 const legacy=await rpc('begin',{scope:'binari'});
 assert.ok(legacy.files.some(x=>x.path===legacyPath));
 await rpc('remove',{syncId:legacy.syncId,path:legacyPath,sha256:digest(legacyBytes)});
 assert.equal((await send('read',{path:legacyPath})).status,404);
 assert.deepEqual(Buffer.from(await (await bucket.get(root+'files/'+legacyPath)).arrayBuffer()),legacyBytes);
 await rpc('finish',{syncId:legacy.syncId});
 // Transfer a file larger than the former application cap without whole-file buffering.
 const big=await rpc('begin',{scope:'binari'}),largePath='assets/over-old-limit.bin';
 const block=Buffer.alloc(part,9),blocks=65,rolling=createHash('sha256');
 for(let i=0;i<blocks;i++)rolling.update(block);
 const largeSHA=rolling.digest('hex'),body=block.toString('base64'),total=blocks*part;
 for(let i=0;i<blocks;i++)assert.deepEqual(await rpc('file_chunk',{
  syncId:big.syncId,path:largePath,sha256:largeSHA,size:total,offset:i*part,dataBase64:body,
 }),{nextOffset:i+1===blocks?null:(i+1)*part});
 const suffix=await send('read',{path:largePath,options:{range:{offset:total-2,length:2}}});
 assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),Buffer.from([9,9]));
 assert.deepEqual(await rpc('finish',{syncId:big.syncId}),{ok:true,written:1});
 assert.equal(await (await bucket.get(other)).text(),'untouched');
 assert.deepEqual((await bucket.list({prefix:root+'v2/stage/'})).objects,[]);
 const {syncId}=await rpc('begin',{scope:'binari'});
 const plan='ngs_file_sync_plan',serial='ngs_file_sync_file_chunk';
 const pl={syncId,totalFiles:2};
 assert.equal((await machine(plan,pl,{Origin:'http://receiver.invalid'})).status,403);
 assert.equal((await machine(plan,pl,{'X-NGS-Machine-Token':'b'.repeat(64)})).status,403);
 assert.deepEqual((await (await machine(plan,pl)).json()).result.structuredContent,{ok:true});
 const file='private/folder/safe-name.bin',content=Buffer.alloc(part+30,21);
 const args=envelope({syncId},file,content);
 assert.deepEqual((await (await machine(serial,args)).json()).result.structuredContent,{nextOffset:part});
 const progress=async()=>await (await send('progress',{})).json();
 assert.deepEqual(await progress(),{state:'syncing',fileName:'safe-name.bin',percent:99,completed:0,total:2,failed:0});
 const final=envelope({syncId},file,content,part);
 assert.deepEqual((await (await machine(serial,final)).json()).result.structuredContent,{nextOffset:null});
 assert.deepEqual((await (await machine(serial,final)).json()).result.structuredContent,{nextOffset:null});
 const fail=await machine('ngs_file_sync_file_failed',{syncId,path:'not-published.bin'});
 assert.deepEqual((await fail.json()).result.structuredContent,{ok:true});
 assert.deepEqual((await (await machine('ngs_file_sync_file_failed',{syncId,path:file})).json()).result.structuredContent,
  {status:409,error:'NGS_FILE_SYNC_REPLICA_CHANGED'});
 assert.equal((await (await machine('ngs_file_sync_file_batch',{syncId,files:[]})).json()).error.code,-32602);
 assert.equal((await machine('ngs_file_sync_file_batch',{syncId,data:'x'.repeat(33000)})).status,413);
 assert.deepEqual(await rpc('finish',{syncId}),{ok:true,written:1});
 const partial={state:'partial',fileName:null,percent:null,completed:1,total:2,failed:1};
 assert.deepEqual(await progress(),partial);
 const zero=await rpc('begin',{scope:'binari'});await rpc('plan',{syncId:zero.syncId,totalFiles:0});
 await rpc('finish',{syncId:zero.syncId});
 assert.deepEqual(await progress(),partial);
 const binary=async (id,path,sha256,size,body,{headers={},status=200,puts=1}={})=>{
  const res=await mini.dispatchFetch('http://receiver.invalid/api/ngs-file-sync-file',{
   method:'POST',duplex:'half',body,headers:{'content-type':'application/octet-stream','content-length':String(size),
    'x-ngs-machine-token':token,'x-ngs-sync-id':id,'x-ngs-file-path':Buffer.from(path).toString('base64url'),
    'x-ngs-file-sha256':sha256,...headers}});
  const value=await res.json();
  assert.equal(res.status,status,JSON.stringify(value));
  assert.equal(res.headers.get('x-test-puts'),String(puts));
  assert.equal(res.headers.get('x-test-multipart'),'0');
  if(status===200)assert.deepEqual(value,{ok:true});
  return value;
 };
 const whole=await rpc('begin',{scope:'binari'});
 const sizes=[part+1,3264044,19200000,65*part];
 await rpc('plan',{syncId:whole.syncId,totalFiles:sizes.length+2});
 const sample=Buffer.alloc(part,51);
 for(const size of sizes){
  const planned=createHash('sha256');
  for(let remaining=size;remaining>0;remaining-=part)planned.update(sample.subarray(0,Math.min(remaining,part)));
  const sha=planned.digest('hex'),name='raw/파일-'+size+'.dat';
  let remaining=size;
  const stream=new ReadableStream({pull(c){
   if(remaining<=0){c.close();return;}
   const n=Math.min(part,remaining);remaining-=n;c.enqueue(new Uint8Array(sample.subarray(0,n)));
  }});
  await binary(whole.syncId,name,sha,size,stream);
  const ranged=await send('read',{path:name,options:{range:{offset:size-2,length:2}}});
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),Buffer.alloc(2,51));
 }
 const small=Buffer.from('good content'),correct=digest(small);
 await binary(whole.syncId,'raw/good.bin',correct,small.length,small);
 await binary(whole.syncId,'raw/good.bin',correct,small.length,small,{puts:0});
 assert.equal((await binary(whole.syncId,'raw/blocked.bin',correct,small.length,small,{
   status:403,puts:0,headers:{Origin:'http://receiver.invalid'}})).error,'SPACE_MACHINE_BROWSER_DENIED');
 assert.equal((await binary(whole.syncId,'raw/blocked.bin',correct,small.length,small,{
   status:403,puts:0,headers:{'x-ngs-machine-token':'b'.repeat(64)}})).error,'SPACE_MACHINE_AUTH_REQUIRED');
 assert.equal((await binary(whole.syncId,'raw/bad.bin','0'.repeat(64),small.length,small,{status:409})).error,'NGS_FILE_SYNC_CONTENT_MISMATCH');
 assert.equal((await send('read',{path:'raw/bad.bin'})).status,404);
 await rpc('file_reset',{syncId:whole.syncId,path:'raw/bad.bin'});
 const none=Buffer.alloc(0);
 await binary(whole.syncId,'raw/empty.bin',digest(none),0,undefined);
 assert.deepEqual(await rpc('finish',{syncId:whole.syncId}),{ok:true,written:sizes.length+2});
 assert.deepEqual(await progress(),{state:'completed',fileName:null,percent:100,completed:sizes.length+2,total:sizes.length+2,failed:0});
 const another=await rpc('begin',{scope:'binari'});
 await rpc('plan',{syncId:another.syncId,totalFiles:1});
 assert.equal((await binary(another.syncId,'raw/good.bin','f'.repeat(64),small.length,small,{status:409})).error,'NGS_FILE_SYNC_CONTENT_MISMATCH');
 assert.deepEqual(Buffer.from(await (await send('read',{path:'raw/good.bin'})).arrayBuffer()),small);
 await rpc('abort',{syncId:another.syncId});
 console.log('Space signed whole binary single-PUT sizes',sizes);
 console.log('Space file replica: real workerd D1/R2 integrity, scoped inventory, replay, range, recoverable deletion and no unrelated changes PASS');
 const viewerPath='props/fixture/large.bin',viewerPass=await rpc('begin',{scope:'binari'});
 assert.deepEqual(await rpc('file_chunk',envelope(viewerPass,viewerPath,data)),{nextOffset:part});
 assert.deepEqual(await rpc('file_chunk',envelope(viewerPass,viewerPath,data,part)),{nextOffset:null});
 const native={'oai-authenticated-user-id':'test-team','oai-authenticated-user-email':'test@fixture.invalid'};
 const viewer=(path,query,headers=native)=>mini.dispatchFetch('http://receiver.invalid/api/viewer/'+path+(query?'?'+new URLSearchParams(query):''),{headers});
 assert.equal((await viewer('manifest',null,{})).status,401);
 assert.deepEqual(await (await viewer('manifest')).json(),{projectId:'binari',resources:['project','props','audio'],files:[{path:viewerPath,sha256:sha,size:data.length}]});
 const committed=await viewer('file',{path:viewerPath,sha256:sha,offset:part});
 assert.equal(committed.status,200);
 assert.equal(committed.headers.get('x-ngs-file-size'),String(data.length));
 assert.deepEqual(Buffer.from(await committed.arrayBuffer()),data.subarray(part));
 assert.equal((await viewer('file',{path:p,sha256:sha,offset:0})).status,400);
 await rpc('finish',{syncId:viewerPass.syncId});

}finally{await mini.dispose();}
