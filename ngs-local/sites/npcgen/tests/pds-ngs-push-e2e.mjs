import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
import {loopbackJsonMCP} from '../build/folder-mcp-loopback.mjs';
import {createLoopbackFileUpload} from '../build/file-sync-raw-client.mjs';
import {createObjectReplica,objectReplicaSyncTools} from '../build/object-replica.mjs';
import {openReplicaSqlite} from '../build/replica-sqlite.mjs';
import {pushProjectFiles} from '../build/pds-mcp-file-sync.mjs';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function memoryBucket(){
 const objects=new Map();
 return {
  head:async key=>objects.get(key)??null,
  list:async({prefix=''})=>({objects:[...objects.values()].filter(v=>v.key.startsWith(prefix)),truncated:false}),
  async get(key){
   const x=objects.get(key);
   return x?{...x,body:new Response(x.bytes).body,arrayBuffer:()=>new Response(x.bytes).arrayBuffer()}:null;
  },
  async put(key,raw,o){
   if(o.onlyIf&&objects.has(key))return null;
   const bytes=Buffer.from(raw instanceof Uint8Array?raw:await new Response(raw).arrayBuffer());
   const x={key,bytes,etag:sha(bytes),size:bytes.length,customMetadata:o.customMetadata};objects.set(key,x);return x;
  },
  async delete(keys){for(const key of [keys].flat())objects.delete(key);},
 };
}
const pdsSource=process.env.NGS_EXISTING_PDS_SOURCE;
const pdsPython=process.env.NGS_EXISTING_PDS_PYTHON??'python3';
const realPds=`
from http.server import ThreadingHTTPServer
from project_data_service.http_server import Handler
from project_data_service.project_folders import configured
import sys
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
server.project_folders=configured(sys.argv[1],'127.0.0.1',validate_mount=False)
print(server.server_port,flush=True)
server.serve_forever(poll_interval=.01)
`;
const listen=async server=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return 'http://127.0.0.1:'+server.address().port;
};

test('unchanged PDS MCP pushes changed files, confirms recoverable removals, and sends no bytes on an unchanged pass',
 {skip:!pdsSource,timeout:20_000},async()=>{
  const temp=mkdtempSync(join(realpathSync(tmpdir()),'ngs-file-push-e2e-'));
  const canonical=join(temp,'canonical-files');
  const path='audio/fixture.wav',original=Buffer.concat([Buffer.alloc(1024*1024,0x21),Buffer.from('end')]);
  mkdirSync(join(canonical,'binari/audio/.deleted'),{recursive:true,mode:0o700});
  const obsolete='audio/obsolete.wav',oldBytes=Buffer.from('previous local copy');
  writeFileSync(join(canonical,'binari/project.json'),JSON.stringify({projectId:'binari',name:'비나리 테스트'}),{mode:0o600});
  writeFileSync(join(canonical,'binari',path),original,{mode:0o600});
  writeFileSync(join(canonical,'binari/audio/.deleted/old.wav'),'excluded',{mode:0o600});
  const py=spawn(pdsPython,['-u','-c',realPds,canonical],{
   env:{...process.env,PYTHONPATH:pdsSource,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
  let stderr='';py.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4096);});
  const ready=createInterface(py.stdout);
  const exited=once(py,'exit');
  const servers=[];
  try{
   const port=await Promise.race([once(ready,'line').then(([line])=>Number(line)),
    exited.then(([code])=>{throw Error('Fixture PDS exited '+code+' '+stderr);})]);
   assert.ok(port>0);
   const pdsCall=loopbackJsonMCP('http://127.0.0.1:'+port+'/mcp');
   let chunks=0;
   const pds=createFolderMcpClient({call:async(name,...args)=>{
    if(name==='npc_folder_file_chunk')chunks++;
    return pdsCall(name,...args);
   }});
   const {openLocalRequestQueue}=await import('../build/local-request-queue.mjs');
   const {createLocalRequestQueueMcp}=await import('../build/local-request-queue-mcp.mjs');
   const queue=openLocalRequestQueue(join(temp,'draft.sqlite'));
   const db=openReplicaSqlite({filename:':memory:'}),bucket=memoryBucket();
   const store=createObjectReplica({db,bucket});
   const seed=async (path,bytes)=>{
    const {syncId}=await store.call('ngs_file_sync_begin',{scope:'binari'});
    await store.call('ngs_file_sync_plan',{syncId,totalFiles:1});
    await store.receiveWholeFile({syncId,path,sha256:sha(bytes),size:bytes.length},new Response(bytes).body);
    await store.call('ngs_file_sync_finish',{syncId});
   };
   const lookup=path=>db.prepare('SELECT object_key FROM ngs_replica_version_v2 WHERE path=? ORDER BY version DESC LIMIT 1').bind(path).first();
   await seed(obsolete,oldBytes);
   const oldKey=(await lookup(obsolete)).object_key;
   const receiver=createLocalRequestQueueMcp(queue,{fileSync:store,fileSyncToolDefinitions:objectReplicaSyncTools});
   receiver.on('close',()=>{db.close();queue.close();});servers.push(receiver);
   const endpoint=await listen(receiver)+'/mcp';
   const ngs=loopbackJsonMCP(endpoint),rawUpload=createLoopbackFileUpload(endpoint);
   let requests=0;
   const upload=(...args)=>{requests++;return rawUpload(...args);};
   const page=createLocalProjectPageServer({objectReplica:store,requestQueue:queue});
   servers.push(page);
   const web=await listen(page),scope='binari';
   assert.deepEqual(await pds.discover(),{projects:[scope]});
   assert.deepEqual(await pushProjectFiles({scope,pds,ngs,upload}),{ok:true,written:2,failed:0});
   assert.equal((await lookup(obsolete)).object_key,null);
   assert.deepEqual((await bucket.get(oldKey)).bytes,oldBytes);
   assert.equal(chunks,3);
   const inode=(await lookup(path)).object_key;
   const read=async()=>Buffer.from(await (await store.get(path)).arrayBuffer());
   assert.deepEqual(await read(),original);
   assert.deepEqual(await pushProjectFiles({scope,pds,ngs,upload}),{ok:true,written:0,failed:0});
   assert.equal(chunks,3);assert.equal(requests,2);assert.equal((await lookup(path)).object_key,inode);
   const updated=Buffer.from('only this file changed');
   writeFileSync(join(canonical,'binari',path),updated,{mode:0o600});
   assert.deepEqual(await pushProjectFiles({scope,pds,ngs,upload}),{ok:true,written:1,failed:0});
   assert.equal(chunks,4);assert.equal(requests,3);assert.deepEqual(await read(),updated);
   const orphan='audio/local-extra.wav',prior=Buffer.from('local extra');
   await seed(orphan,prior);
   let comparisons=0;
   const incomplete={...pds,async compare(...args){
    const result=await pds.compare(...args);
    return ++comparisons===2?{...result,deleted:[]}:result;
   }};
   await assert.rejects(pushProjectFiles({scope,pds:incomplete,ngs,upload}),/TOMBSTONE_CHANGED/);
   assert.deepEqual(Buffer.from(await (await store.get(orphan)).arrayBuffer()),prior);
   const next=Buffer.from('intervening edit');
   const changedDuringPush=async(name,args,...rest)=>{
    if(name==='ngs_file_sync_remove')await seed(orphan,next);
    return ngs(name,args,...rest);
   };
   await assert.rejects(pushProjectFiles({scope,pds,ngs:changedDuringPush,upload}));
   assert.deepEqual(Buffer.from(await (await store.get(orphan)).arrayBuffer()),next);
   assert.deepEqual((await bucket.get(oldKey)).bytes,oldBytes);
   const session=await fetch(web+'/__npcgen_session');
   const local=await(await fetch(web+'/api/project-folders',{headers:{cookie:session.headers.get('set-cookie').split(';')[0]}})).json();
   assert.equal(local.projects[0].name,'비나리 테스트');
  }finally{
   await Promise.all(servers.reverse().map(server=>new Promise(resolve=>server.close(resolve))));
   ready.close();py.kill();await exited.catch(()=>{});
   rmSync(temp,{recursive:true,force:true});
  }
 });
