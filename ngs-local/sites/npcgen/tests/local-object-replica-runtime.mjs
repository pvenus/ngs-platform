import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {createLocalRequestQueueMcp} from '../build/local-request-queue-mcp.mjs';
import {localReplicaSelection,openLocalObjectReplicaFromEnv} from '../build/local-object-replica-runtime.mjs';
import {loopbackJsonMCP} from '../build/folder-mcp-loopback.mjs';

const hash=v=>createHash('sha256').update(v).digest('hex');
const j=v=>Buffer.from(JSON.stringify(v));
const fixtureS3='/private/fixture/s3.json',fixtureIndex='/private/fixture/index.sqlite';
const env={NGS_REPLICA_STORAGE:'object',NGS_LOCAL_S3_CONFIG:fixtureS3,NGS_LOCAL_REPLICA_DB:fixtureIndex,
 NGS_REQUEST_QUEUE_DB:'/private/fixture/requests.sqlite',NGS_FILE_SYNC_MODE:'push',NGS_FILE_SYNC_PROJECTS:'binari'};

test('object local composition explicit and fail-closed; web index read-only and no public write surface',async()=>{
 assert.equal(localReplicaSelection({}),null);
 assert.equal(await openLocalObjectReplicaFromEnv({},{load:()=>assert.fail('filesystem mode never loads object dependencies')}),null);
 assert.throws(()=>localReplicaSelection({...env,NGS_LOCAL_REPLICA_DB:env.NGS_REQUEST_QUEUE_DB}),/CONFIGURATION_REQUIRED/);
 assert.throws(()=>localReplicaSelection({...env,NGS_LOCAL_S3_CONFIG:'relative.json'}),/CONFIGURATION_REQUIRED/);
 assert.throws(()=>localReplicaSelection({...env,NGS_REPLICA_STORAGE:'fallback'}),/CONFIGURATION_REQUIRED/);
 await assert.rejects(openLocalObjectReplicaFromEnv({...env,NGS_FILE_SYNC_PROJECTS:'binari,unapproved'},{writer:true,load:()=>assert.fail()}),/CONFIGURATION_REQUIRED/);
 const evidence=[],ports={
  async openLocalS3ReplicaBucket({configPath}){assert.equal(configPath,fixtureS3);return {close:()=>evidence.push('bucket closed')};},
  openReplicaSqlite({filename,readOnly}){assert.equal(filename,fixtureIndex);evidence.push(readOnly);return {close:()=>evidence.push('db closed')};},
  createObjectReplica({db,bucket,writePart}){assert.ok(db&&bucket&&writePart);return {list(){},head(){},get(){},progress(){},audioIndex(){},call(){},npcCache:{version(){},read(){},store(){}}};},
  objectReplicaSyncTools:[{name:'fixture'}],
 };
 const web=await openLocalObjectReplicaFromEnv(env,{load:async()=>ports});
 assert.deepEqual(Object.keys(web.replica).sort(),['audioIndex','get','head','list','npcCache','progress']);
 web.close();
 const write=await openLocalObjectReplicaFromEnv(env,{writer:true,load:async()=>ports});
 assert.equal(typeof write.replica.call,'function');
 assert.deepEqual(write.fileSyncToolDefinitions,[{name:'fixture'}]);
 write.close();
 assert.deepEqual(evidence,[true,'db closed','bucket closed',false,'db closed','bucket closed']);
});

async function listen(t,server){
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port;
}
function objectMap(files){
 const counts={head:0,list:0,get:0};
 const shape=(body)=>({size:body.length,etag:hash(body)+'-object',customMetadata:{sha256:hash(body)}});
 const head=async(path)=>{counts.head++;const bytes=files.get(path);return bytes?shape(bytes):null;};
 return {counts,head,
  async list(prefix=''){counts.list++;return [...files].filter(([k])=>!prefix||k.startsWith(prefix+'/')).map(([path,bytes])=>({path,sha256:hash(bytes)}));},
  async get(path,params={}){counts.get++;const bytes=files.get(path),meta=bytes&&shape(bytes);
   if(!meta||params.onlyIf?.etagMatches!==meta.etag)return null;
   const range=params.range,body=range?bytes.subarray(range.offset,range.offset+range.length):bytes;
   const response=new Response(new Uint8Array(body));
   return {...meta,body:response.body,arrayBuffer:()=>response.arrayBuffer()};
  },
 };
}

test('actual local HTTP serves the same private object projections with no filesystem and range-pinned BGM',async t=>{
 const png=Buffer.from([137,80,78,71,13,10,26,10,1]),wav=Buffer.alloc(64);
 wav.write('RIFF',0);wav.write('WAVE',8);wav[12]=99;
 const id='request.official.'+'a'.repeat(64),npc='npc.fixture';
 const files=new Map([
  ['project.json',j({name:'Object Binari'})],['icon.png',png],
  ['concept/metadata.json',j({sectionIds:['character']})],['concept/sections/character/metadata.json',j({id:'character',title:'Fixture concept',fieldIds:[]})],
  ['motion-presets/presets/walk.json',j({presetId:'walk',label:'Fixture walk'})],
  ['npcs/metadata.json',j({characterOrder:[npc]})],['npcs/'+npc+'/metadata.json',j({id:npc,name:'Fixture NPC',kind:'npc',chapters:[]})],
  ['audio/'+id+'/metadata.json',j({schemaVersion:'workflow.audio-result.v1',officialRequestId:id,projectId:'binari',kind:'bgm',
   taskId:'workflow.task.'+hash(JSON.stringify([id,'audio_generate'])),payloadSha256:'a'.repeat(64),
   conceptId:'concept-item',source:{conceptId:'concept-item',sectionSha256:'b'.repeat(64)},title:'Fixture score',generatedAt:3,
   audio:{path:'audio.wav',mimeType:'audio/wav',sha256:hash(wav),bytes:wav.length,channels:1,bitsPerSample:16,
    frames:10,sampleRate:8000,durationSeconds:10/8000}})],
  ['audio/'+id+'/audio.wav',wav],
 ]);
 const replica=objectMap(files),indexedArgs=[];
 replica.audioIndex=async args=>{
  indexedArgs.push(args);
  const result={title:'Fixture score',durationSeconds:10/8000,bpm:null,bpmBasis:'unavailable',
   url:'/api/audio-workspace?'+new URLSearchParams({projectId:'binari',id,sha256:hash(wav)})};
  return {projectId:'binari',results:[result],nextCursor:null};
 };
 const server=createLocalProjectPageServer({objectReplica:replica,audioWorkspaceEnabled:true});
 const url=await listen(t,server);
 for(const path of ['/api/project-folders','/api/project-workspace?projectId=binari&tab=concept','/api/audio-workspace?projectId=binari'])
  assert.equal((await fetch(url+path)).status,401);
 assert.deepEqual(replica.counts,{head:0,list:0,get:0});
 const session=await fetch(url+'/__npcgen_session'),cookie=session.headers.get('set-cookie').split(';')[0];
 const get=(path,headers={})=>fetch(url+path,{headers:{cookie,...headers}});
 const catalog=await (await get('/api/project-folders')).json();
 assert.equal(catalog.projects[0].name,'Object Binari');
 assert.deepEqual(Buffer.from(await (await get(catalog.projects[0].iconUrl)).arrayBuffer()),png);
 const concept=await get('/api/project-workspace?projectId=binari&tab=concept');
 assert.equal(concept.status,200);assert.equal((await concept.json()).items[0].label,'Fixture concept');
 const motion=await get('/api/project-workspace?projectId=binari&tab=motion-presets');
 assert.equal(motion.status,200);assert.equal((await motion.json()).items[0].id,'walk');
 const n=await get('/api/npc-workspace?projectId=binari&npcId='+npc);
 assert.equal(n.status,200);assert.equal((await n.json()).npc.id,npc);
 const priorCounts={...replica.counts},playlist=await (await get('/api/audio-workspace?projectId=binari')).json();
 assert.equal(playlist.results[0].title,'Fixture score');
 assert.equal(playlist.nextCursor,null);
 assert.deepEqual(indexedArgs,[{projectId:'binari'}]);assert.deepEqual(replica.counts,priorCounts);
 const part=await get(playlist.results[0].url,{Range:'bytes=8-12'});
 assert.equal(part.status,206);assert.equal(part.headers.get('content-range'),'bytes 8-12/64');
 assert.deepEqual(Buffer.from(await part.arrayBuffer()),wav.subarray(8,13));
 assert.equal((await get(playlist.results[0].url,{Range:'bytes=1000-'})).status,416);
 assert.equal((await get('/api/npc-workspace?projectId=unapproved')).status,403);
});

test('ordinary local MCP advertises exact injected object sync definitions without queue mutation',async t=>{
 const calls=[];
 const type={name:'ngs_file_sync_file_reset',inputSchema:{type:'object'}};
 const queue={list:()=>({requests:[]}),ack:()=>assert.fail('no queue mutation')};
 const url=await listen(t,createLocalRequestQueueMcp(queue,{
  fileSyncToolDefinitions:[type],fileSync:{async call(name,args){calls.push([name,args]);return {ok:true};}},
 }));
 const mcp=loopbackJsonMCP(url+'/mcp');
 assert.deepEqual(await mcp('ngs_request_queue_list',{}),{requests:[]});
 assert.deepEqual(await mcp(type.name,{syncId:'only fixture',path:'x'}),{ok:true});
 assert.deepEqual(calls,[[type.name,{syncId:'only fixture',path:'x'}]]);
});
