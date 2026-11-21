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
const schema=readFileSync(here(base+'ngs-local/dev/0014_space_file_replica_versions.sql'),'utf8');
const root='ngs-replica/v1/binari/',other='legacy/untouched';
const mini=new Miniflare({
 d1Databases:['DB'],r2Buckets:['BUCKET'],compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
 modules:[{type:'ESModule',path:'test.mjs',contents:`
 import {createSpaceFileReplica} from './build/space-file-replica.mjs';
 export default {async fetch(request,env){
  const replica=createSpaceFileReplica({db:env.DB,bucket:env.BUCKET});
  const {method,args}=await request.json();
  try {
   if(method==='read'){
    const item=await replica.get(args.path,args.options);
    return item?new Response(item.body):new Response(null,{status:404});
   }
   const result=method==='list'?await replica.list(args?.prefix):await replica.call(method,args);
   return Response.json(result);
  }catch(e){return Response.json({message:e.message},{status:e.status??500});}
 }};
 `},{type:'ESModule',path:'build/space-file-replica.mjs',contents:receiver},
 {type:'ESModule',path:sourcePath,contents:core}],
});
const send=(method,args)=>mini.dispatchFetch('http://receiver.invalid',{method:'POST',body:JSON.stringify({method,args})});
const rpc=async (method,args,status=200)=>{
 const result=await send('ngs_file_sync_'+method,args),body=await result.json();
 assert.equal(result.status,status,JSON.stringify(body));return body;
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const part=1024*1024;
const envelope=(session,path,data,offset=0,sha=digest(data))=>({
 syncId:session.syncId,path,sha256:sha,size:data.length,offset,dataBase64:data.subarray(offset,offset+part).toString('base64'),
});
try{
 const db=await mini.getD1Database('DB'),bucket=await mini.getR2Bucket('BUCKET');
 for(const sql of schema.split('--> statement-breakpoint'))await db.prepare(sql).run();
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
 console.log('Space file replica: real workerd D1/R2 integrity, scoped inventory, replay, range, recoverable deletion and no unrelated changes PASS');
}finally{await mini.dispose();}
