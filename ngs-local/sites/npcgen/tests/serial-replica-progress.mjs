import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createObjectReplica,objectReplicaSyncTools} from '../build/object-replica.mjs';
import {parseWholeFileHeaders,wholeFileObjectMaximum,wholeFileError} from '../build/replica-whole-file-wire.mjs';
import {openReplicaSqlite} from '../build/replica-sqlite.mjs';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {createLocalRequestQueueMcp} from '../build/local-request-queue-mcp.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex'),chunkSize=1024*1024;
const idle={state:'idle',fileName:null,percent:null,completed:0,total:0,failed:0};
const tool=kind=>'ngs_file_sync_'+kind;

test('serial planned progress, exact current basename and durable results under replay, failure, no-op and expiry', async t=>{
 let clock=50;
 const db=openReplicaSqlite({filename:':memory:'});t.after(()=>db.close());
 const files=new Map();
 const bucket={
  async list(){return {objects:[],truncated:false}},async head(key){return files.get(key)??null;},
  async put(key,data,options){if(files.has(key))return null;
   const r={etag:sha(data),size:data.length,customMetadata:options.customMetadata};
   files.set(key,r);return r;},
  async createMultipartUpload(){return {uploadId:'temp',async abort(){}};},
  resumeMultipartUpload(){return {async abort(){}};},async delete(){},
 };
 const core=createObjectReplica({db,bucket,now:()=>clock});
 assert.equal(objectReplicaSyncTools.some(x=>x.name===tool('file_batch')),false);
 const rpc=(name,params)=>core.call(tool(name),params);
 const begin=async totalFiles=>{
  const {syncId}=await rpc('begin',{scope:'binari'});
  assert.deepEqual(await rpc('plan',{syncId,totalFiles}),{ok:true});return syncId;
 };
 const bytes=Buffer.from('valid'),part=Buffer.alloc(chunkSize,4),whole=Buffer.concat([part,part,part]);
 const item=(syncId,path,content,offset=0,full=content)=>({syncId,path,offset,size:full.length,sha256:sha(full),
  dataBase64:content.toString('base64')});
 assert.deepEqual(await core.progress(),idle);
 const id=await begin(3),path='very/private/folder/sound.wav';
 assert.deepEqual(await rpc('plan',{syncId:id,totalFiles:3}),{ok:true});
 await assert.rejects(rpc('plan',{syncId:id,totalFiles:4}),{status:409});
 assert.deepEqual(await rpc('file_chunk',item(id,path,part,0,whole)),{nextOffset:chunkSize});
 assert.deepEqual(await core.progress(),{state:'syncing',fileName:'sound.wav',percent:33,completed:0,total:3,failed:0});
 await rpc('file_reset',{syncId:id,path});
 for(let i=0;i<2;i++)assert.deepEqual(await rpc('file_failed',{syncId:id,path}),{ok:true});
 const a=item(id,'project/a.bin',bytes),b=item(id,'project/b.bin',bytes);
 for(let i=0;i<2;i++)assert.deepEqual(await rpc('file_chunk',a),{nextOffset:null});
 await assert.rejects(rpc('file_failed',{syncId:id,path:a.path}),{status:409});
 assert.deepEqual(await rpc('file_chunk',b),{nextOffset:null});
 assert.equal((await core.progress()).completed,2);
 assert.equal((await core.progress()).failed,1);
 assert.deepEqual(await rpc('finish',{syncId:id}),{ok:true,written:2});
 const partial={state:'partial',fileName:null,percent:null,completed:2,total:3,failed:1};
 assert.deepEqual(await core.progress(),partial);
 const noWork=await begin(0);await rpc('finish',{syncId:noWork});
 assert.deepEqual(await core.progress(),partial);
 const good=await begin(1),single=item(good,'project/last.bin',bytes);
 await rpc('file_chunk',single);await rpc('finish',{syncId:good});
 assert.deepEqual(await core.progress(),{state:'completed',fileName:null,percent:100,completed:1,total:1,failed:0});
 await begin(2);clock+=3600001;
 assert.deepEqual(await core.progress(),{state:'failed',fileName:null,percent:null,completed:0,total:2,failed:2});
});
async function listen(t,server){
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 t.after(()=>new Promise(ok=>server.close(ok)));return 'http://127.0.0.1:'+server.address().port;
}
test('Local project grant and no-store progress, serial-only machine cap',async t=>{
 const objectReplica={list:async()=>[],head:async()=>null,get:async()=>null,progress:async()=>idle};
 const url=await listen(t,createLocalProjectPageServer({objectReplica}));
 const api='/api/ngs-sync-progress?projectId=binari';
 assert.equal((await fetch(url+api)).status,401);
 const auth=await fetch(url+'/__npcgen_session');
 const headers={cookie:auth.headers.get('set-cookie').split(';')[0]};
 const success=await fetch(url+api,{headers});
 assert.deepEqual(await success.json(),idle);assert.match(success.headers.get('cache-control'),/no-store/);
 assert.equal((await fetch(url+api.replace('binari','other'),{headers})).status,403);
 assert.equal((await fetch(url+api+'&projectId=binari',{headers})).status,400);
 const queue={list:()=>({requests:[]})};
 const mcp=await listen(t,createLocalRequestQueueMcp(queue,{fileSync:{async call(){assert.fail('not called');}},fileSyncToolDefinitions:objectReplicaSyncTools}));
 const send=body=>fetch(mcp+'/mcp',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 const request={jsonrpc:'2.0',id:1,method:'tools/call',params:{name:tool('file_batch'),arguments:{}}};
 assert.equal((await (await send(request)).json()).error.code,-32602);
 assert.equal((await send({...request,params:{...request.params,arguments:{data:'z'.repeat(10000)}}})).status,413);
});

test('Local companion binary route verifies one whole private object, keeps MCP cap and pointer intact',async t=>{
 const db=openReplicaSqlite({filename:':memory:'});t.after(()=>db.close());
 const objects=new Map();let puts=0;
 const replica=createObjectReplica({db,bucket:{
  async list(){return {objects:[],truncated:false};},
  async head(path){return objects.get(path)??null;},
  async put(path,body,options){
   puts++;
   const raw=body instanceof Uint8Array?body:new Uint8Array(await new Response(body).arrayBuffer());
   const o={size:raw.length,etag:sha(raw),customMetadata:options.customMetadata};
   assert.equal(sha(raw),options.sha256);
   objects.set(path,o);return o;
  },
  createMultipartUpload(){assert.fail('whole-file route must not split');},async delete(){},
 }});
 const mcp=await listen(t,createLocalRequestQueueMcp({list:()=>({requests:[]})},{fileSync:replica,fileSyncToolDefinitions:objectReplicaSyncTools}));
 const {syncId}=await replica.call(tool('begin'),{scope:'binari'});
 await replica.call(tool('plan'),{syncId,totalFiles:1});
 const body=Buffer.alloc(3264044,20),path='scope/한국어 음원.wav',sha256=sha(body);
 const h={'Content-Type':'application/octet-stream','Content-Length':String(body.length),
  'X-NGS-Sync-Id':syncId,'X-NGS-File-Path':Buffer.from(path).toString('base64url'),'X-NGS-File-Sha256':sha256};
 const route=mcp+'/api/ngs-file-sync-file';
 assert.equal((await fetch(route,{method:'POST',headers:{...h,Origin:'http://untrusted.invalid'},body})).status,403);
 assert.equal((await fetch(route,{method:'POST',headers:{...h,'Content-Type':'application/json'},body})).status,415);
 const sent=await fetch(route,{method:'POST',headers:h,body});
 assert.equal(sent.status,200);assert.deepEqual(await sent.json(),{ok:true});assert.equal(puts,1);
 assert.equal((await replica.head(path)).size,body.length);
 assert.deepEqual(await (await fetch(route,{method:'POST',headers:h,body})).json(),{ok:true});
 assert.equal(puts,1);
 assert.deepEqual(await replica.call(tool('finish'),{syncId}),{ok:true,written:1});
});

test('whole-file native size limit is explicit without changing generic MCP caps',()=>{
 const headers={'content-type':'application/octet-stream','content-length':String(wholeFileObjectMaximum+1)};
 assert.throws(()=>parseWholeFileHeaders(key=>headers[key]),e=>e.status===413&&e.message==='NGS_FILE_SYNC_BODY_TOO_LARGE');
 assert.deepEqual(wholeFileError({$metadata:{httpStatusCode:413}}),{status:413,error:'NGS_FILE_SYNC_BODY_TOO_LARGE'});
});
