import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalRequestQueueMcp} from '../build/local-request-queue-mcp.mjs';
import {createObjectReplica,objectReplicaBatchRpcBytes,objectReplicaSyncTools} from '../build/object-replica.mjs';
import {openReplicaSqlite} from '../build/replica-sqlite.mjs';

const sha=buf=>createHash('sha256').update(buf).digest('hex');
const file=(path,buf,sha256=sha(buf))=>({path,sha256,size:buf.length,dataBase64:buf.toString('base64')});
const ack=(row,status='accepted',code)=>({path:row.path,sha256:row.sha256,status,...(code?{code}:{})});
const spool=1024*1024;
const batch='ngs_file_sync_file_batch';
const jsonRpc=(name,args)=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}});
async function fixture(t){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-batch-local-'));
 const db=openReplicaSqlite({filename:join(root,'replica.sqlite')});
 const values=new Map(),written=[];
 const bucket={
  async list(){return {objects:[],truncated:false};},
  async head(key){return values.get(key)??null;},
  async put(key,body,opts){
   if(values.has(key))return null;
   assert.equal(sha(body),opts.sha256);
   const metadata={key,size:body.length,etag:sha(body),customMetadata:opts.customMetadata};
   values.set(key,metadata);written.push(key);return metadata;
  },
 };
 const replica=createObjectReplica({db,bucket});
 const queue={list:()=>({requests:[]}),ack:()=>assert.fail('never mutate request queue')};
 const server=createLocalRequestQueueMcp(queue,{fileSync:replica,fileSyncToolDefinitions:objectReplicaSyncTools});
 await new Promise((ok,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',ok);});
 t.after(async()=>{await new Promise(ok=>server.close(ok));db.close();rmSync(root,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+server.address().port+'/mcp';
 const send=(body,extra)=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...extra},
  body:typeof body==='string'?body:JSON.stringify(body)});
 const call=async (name,args)=>{
  const response=await send(jsonRpc(name,args));assert.equal(response.status,200);
  return (await response.json()).result;
 };
 return {call,bucket,replica,send,written};
}
test('Local authenticated boundary, full batch preflight, exact per-item ACK, retry and replay',async t=>{
 const {call,replica,send,written}=await fixture(t);
 const {syncId}=(await call('ngs_file_sync_begin',{scope:'binari'})).structuredContent;
 const small=file('other/first.bin',Buffer.from('first'));
 const canonical=Buffer.from('wanted'),bad=file('other/retry.bin',Buffer.from('mutant'),sha(canonical));
 const zero=file('other/empty.bin',Buffer.alloc(0));
 for(const files of [[],Array.from({length:33},(_,i)=>file('x/'+i,Buffer.alloc(0))),[small,small],
  [small,{...zero,path:'../escape'}],[small,{...zero,dataBase64:'!'}],[small,{...zero,size:1}]]){
  const invalid=await call(batch,{syncId,files});
  assert.equal(invalid.isError,true);assert.deepEqual(invalid.structuredContent,{status:400,error:'NGS_FILE_SYNC_INVALID'});
 }
 const large=Buffer.alloc(spool,19);
 const one=file('other/one.bin',large),two=file('other/two.bin',large);
 assert.equal((await call(batch,{syncId,files:[one,two,small]})).isError,true);
 assert.equal((await call(batch,{syncId,files:[file('other/toolarge.bin',Buffer.alloc(spool+1))]})).isError,true);
 assert.deepEqual(await replica.list(),[]);assert.equal(written.length,0);
 assert.equal((await send(jsonRpc(batch,{syncId,files:[small]}),{Origin:'http://untrusted.invalid'})).status,403);
 const responses=(await call(batch,{syncId,files:[small,bad,zero]})).structuredContent;
 assert.deepEqual(responses,{results:[ack(small),ack(bad,'failed','NGS_FILE_SYNC_CONTENT_MISMATCH'),ack(zero)]});
 assert.equal(await replica.head(bad.path),null);
 const retry=file(bad.path,canonical);
 assert.deepEqual((await call(batch,{syncId,files:[retry]})).structuredContent,{results:[ack(retry)]});
 assert.deepEqual((await call(batch,{syncId,files:[small,retry,zero]})).structuredContent,{results:[ack(small),ack(retry),ack(zero)]});
 assert.equal(written.length,3);
 // Both maxima fit in one batch: 30 empty files and 2 x 1 MiB.
 const maximal=[one,two,...Array.from({length:30},(_,i)=>file('other/zero-'+i,Buffer.alloc(0)))];
 const full=await call(batch,{syncId,files:maximal});
 assert.deepEqual(full.structuredContent,{results:maximal.map(row=>ack(row))});
 assert.equal((await send(jsonRpc('ngs_request_queue_list',{padding:'a'.repeat(9000)}))).status,413);
 assert.equal((await send(jsonRpc('ngs_file_sync_file_chunk',{syncId,...one,offset:0,dataBase64:'a'.repeat(1600000)}))).status,413);
 assert.equal((await send(' '.repeat(objectReplicaBatchRpcBytes+1))).status,413);
 assert.deepEqual((await call('ngs_file_sync_finish',{syncId})).structuredContent,{ok:true,written:35});
});
