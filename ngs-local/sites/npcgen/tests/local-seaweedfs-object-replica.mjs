/** Opt-in sterile integration. Requires a running, empty test-only loopback SeaweedFS bucket. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {openLocalObjectReplicaFromEnv} from '../build/local-object-replica-runtime.mjs';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {createLocalRequestQueueMcp} from '../build/local-request-queue-mcp.mjs';
import {openLocalRequestQueue} from '../build/local-request-queue.mjs';
import {loopbackJsonMCP} from '../build/folder-mcp-loopback.mjs';
import {pushSpaceProjectFiles} from '../build/pds-mcp-file-sync.mjs';

const configPath=process.env.NGS_ISOLATED_SEAWEED_TEST_CONFIG;
const sha=b=>createHash('sha256').update(b).digest('hex');
const data=v=>Buffer.from(JSON.stringify(v));
async function listen(server){
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 return 'http://127.0.0.1:'+server.address().port;
}

test('actual Mac MCP writer and read-only browser share dedicated SQLite + loopback SeaweedFS', {skip:!configPath,timeout:60_000},async t=>{
 let name;
 try{name=JSON.parse(readFileSync(configPath,'utf8')).bucketName;}catch{}
 assert.equal(typeof name,'string','isolated fixture bucket required');
 assert.ok(/^ngs-(?:test|fixture)(?:-[a-z0-9]+)+$/.test(name),'only a named disposable test bucket is allowed');
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-object-seaweed-fixture-'));
 const env={NGS_REPLICA_STORAGE:'object',NGS_LOCAL_S3_CONFIG:configPath,NGS_LOCAL_REPLICA_DB:join(root,'replica.sqlite'),
  NGS_REQUEST_QUEUE_DB:join(root,'queue.sqlite'),NGS_FILE_SYNC_MODE:'push',NGS_FILE_SYNC_PROJECTS:'binari'};
 const receiver=await openLocalObjectReplicaFromEnv(env,{writer:true});
 const queue=openLocalRequestQueue(env.NGS_REQUEST_QUEUE_DB);
 let mcp,web,reader;
 t.after(async()=>{
  for(const server of [web,mcp])if(server?.listening)await new Promise(ok=>server.close(ok));
  reader?.close();receiver.close();queue.close();
  rmSync(root,{recursive:true,force:true});
 });
 assert.deepEqual(await receiver.replica.list(),[],'fixture bucket must be empty');
 mcp=createLocalRequestQueueMcp(queue,{fileSync:receiver.replica,fileSyncToolDefinitions:receiver.fileSyncToolDefinitions});
 const address=await listen(mcp);
 const ngs=loopbackJsonMCP(address+'/mcp'),scope='binari',npc='npc.synthetic';
 const files=new Map([
  ['project.json',data({name:'S3 fixture'})],
  ['icon.png',Buffer.from([137,80,78,71,13,10,26,10,1])],
  ['concept/metadata.json',data({sectionIds:['example']})],
  ['concept/sections/example/metadata.json',data({id:'example',title:'Example',fieldIds:[]})],
  ['npcs/metadata.json',data({characterOrder:[npc]})],
  ['npcs/'+npc+'/metadata.json',data({id:npc,name:'Synthetic',kind:'npc'})],
  ['motion-presets/presets/walk.json',data({presetId:'walk',label:'Walk'})],
  ['other/large.bin',Buffer.alloc(6*1024*1024+7,87)],
 ]);
 const parents=new Map();
 for(const [path,bytes] of files){
  const folder=path.includes('/')?path.split('/')[0]:'';
  if(!parents.has(folder))parents.set(folder,[]);
  parents.get(folder).push({path,sha256:sha(bytes),size:bytes.length});
 }
 const pds={
  compare:async()=>({scope,deleted:[],groups:[...parents].map(([folder,files])=>({folder,files}))}),
  file(_,path){
   const body=files.get(path);let offset=0;
   return {body:new ReadableStream({pull(c){
    if(offset>=body.length){c.close();return;}
    const end=Math.min(body.length,offset+1024*1024);c.enqueue(body.subarray(offset,end));offset=end;
   }})};
  },
 };
 assert.deepEqual(await pushSpaceProjectFiles({scope,pds,ngs}),{ok:true,written:files.size,failed:0});
 assert.deepEqual(await ngs('ngs_request_queue_list',{}),{requests:[]});
 reader=await openLocalObjectReplicaFromEnv(env);
 const large=await reader.replica.get('other/large.bin',{range:{offset:5*1024*1024,length:10}});
 assert.deepEqual(Buffer.from(await large.arrayBuffer()),Buffer.alloc(10,87));
 web=createLocalProjectPageServer({objectReplica:reader.replica,requestQueue:queue});
 const port=await listen(web);
 const res=await fetch(port+'/__npcgen_session'),cookie=res.headers.get('set-cookie').split(';')[0];
 const get=path=>fetch(port+path,{headers:{cookie}});
 assert.equal((await (await get('/api/project-folders')).json()).projects[0].name,'S3 fixture');
 assert.equal((await (await get('/api/project-workspace?projectId=binari&tab=motion-presets')).json()).items[0].id,'walk');
 assert.equal((await (await get('/api/project-workspace?projectId=binari&tab=concept')).json()).items[0].id,'example');
 assert.equal((await (await get('/api/npc-workspace?projectId=binari&npcId='+npc)).json()).npc.id,npc);
});
