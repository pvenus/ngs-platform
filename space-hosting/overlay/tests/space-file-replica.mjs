/** Sterile Miniflare integration test; no credentials or live bindings. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const here=base=>new URL(base,import.meta.url);
const {Miniflare}=createRequire(process.env.SPACE_TEST_PACKAGE_JSON??here('../../../sites/npcgen/package.json'))('miniflare');
const core=readFileSync(here('../build/space-file-replica.mjs'),'utf8');
const schema=readFileSync(here('../drizzle/0012_space_file_replica_sync.sql'),'utf8');
const root='ngs-replica/v1/binari/',other='legacy/untouched';
const mini=new Miniflare({
 d1Databases:['DB'],r2Buckets:['BUCKET'],compatibilityDate:'2025-11-01',
 modules:[{type:'ESModule',path:'test.mjs',contents:`
 import {createSpaceFileReplica} from './core.mjs';
 export default {async fetch(request,env){
  const replica=createSpaceFileReplica({db:env.DB,bucket:env.BUCKET});
  const {method,args}=await request.json();
  try {
   if(method==='read'){
    const item=await replica.get(args.path,args.options);
    return item?new Response(item.body):new Response(null,{status:404});
   }
   const result=method==='list'?await replica.list():await replica.call(method,args);
   return Response.json(result);
  }catch(e){return Response.json({message:e.message},{status:e.status??500});}
 }};
 `},{type:'ESModule',path:'core.mjs',contents:core}],
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
 await db.prepare(schema).run();
 await bucket.put(other,'untouched');
 await rpc('begin',{scope:'other'},403);
 const a=await rpc('begin',{scope:'binari'});
 assert.deepEqual(a.files,[]);
 await rpc('begin',{scope:'binari'},409);
 const p='assets/large.bin',data=Buffer.alloc(part+91,7),sha=digest(data);
 await rpc('file_chunk',{...envelope(a,p,data),path:'.deleted/private'},400);
 await rpc('file_chunk',{...envelope(a,p,data),path:'a/../private'},400);
 await rpc('file_chunk',{...envelope(a,p,data),path:'a\\private'},400);
 assert.deepEqual(await rpc('file_chunk',envelope(a,p,data)),{nextOffset:part});
 assert.deepEqual(await rpc('file_chunk',envelope(a,p,data)),{nextOffset:part});
 assert.equal((await send('read',{path:p})).status,404);
 await rpc('finish',{syncId:a.syncId},409);
 assert.deepEqual(await rpc('file_chunk',envelope(a,p,data,part)),{nextOffset:null});
 assert.deepEqual(await rpc('file_chunk',envelope(a,p,data,part)),{nextOffset:null});
 const range=await send('read',{path:p,options:{range:{offset:part,length:4}}});
 assert.deepEqual(Buffer.from(await range.arrayBuffer()),Buffer.alloc(4,7));
 await rpc('remove',{syncId:a.syncId,path:p,sha256:sha},409);
 assert.deepEqual(await rpc('finish',{syncId:a.syncId}),{ok:true,written:1});
 const b=await rpc('begin',{scope:'binari'});
 assert.deepEqual(b.files,[{path:p,sha256:sha}]);
 assert.deepEqual(await rpc('file_chunk',envelope(b,p,data)),{nextOffset:part});
 assert.deepEqual(await rpc('file_chunk',envelope(b,p,data,part)),{nextOffset:null});
 assert.deepEqual(await rpc('finish',{syncId:b.syncId}),{ok:true,written:0});
 const c=await rpc('begin',{scope:'binari'});
 await rpc('remove',{syncId:c.syncId,path:p,sha256:'0'.repeat(64)},409);
 assert.deepEqual(await rpc('remove',{syncId:c.syncId,path:p,sha256:sha}),{removed:true});
 assert.deepEqual(await rpc('remove',{syncId:c.syncId,path:p,sha256:sha}),{removed:false});
 assert.equal((await send('read',{path:p})).status,404);
 assert.deepEqual(await (await send('list',{})).json(),[]);
 assert.deepEqual(Buffer.from(await (await bucket.get(root+'recovery/'+sha)).arrayBuffer()),data);
 assert.equal((await send('read',{path:'recovery/'+sha})).status,404);
 await rpc('finish',{syncId:c.syncId});
 const d=await rpc('begin',{scope:'binari'});
 const minor=Buffer.from('restored');
 assert.deepEqual(await rpc('file_chunk',envelope(d,p,minor)),{nextOffset:null});
 assert.deepEqual(Buffer.from(await (await send('read',{path:p})).arrayBuffer()),minor);
 const bad=await send('ngs_file_sync_file_chunk',envelope(d,'assets/bad.bin',minor,0,'f'.repeat(64)));
 assert.ok(bad.status>=400);
 assert.equal((await send('read',{path:'assets/bad.bin'})).status,404);
 await rpc('abort',{syncId:d.syncId});
 assert.equal(await (await bucket.get(other)).text(),'untouched');
 assert.deepEqual((await bucket.list({prefix:root+'stage/'})).objects,[]);
 console.log('Space file replica: real workerd D1/R2 integrity, scoped inventory, replay, range, recoverable deletion and no unrelated changes PASS');
}finally{await mini.dispose();}
