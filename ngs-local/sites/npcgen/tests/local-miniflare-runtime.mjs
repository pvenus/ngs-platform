/** Actual Workerd with a disposable persistent D1/R2 namespace; no production ports. */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtempSync,realpathSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startLocalMiniflareNgs} from '../build/local-miniflare-app.mjs';
import {openLocalMiniflareReplica} from '../build/local-miniflare-runtime.mjs';
import {loopbackJsonMCP} from '../build/folder-mcp-loopback.mjs';
import {createLoopbackFileUpload} from '../build/file-sync-raw-client.mjs';
import {pushProjectFiles} from '../build/pds-mcp-file-sync.mjs';

const dependency=process.env.NGS_MINIFLARE_TEST_PACKAGE_JSON;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const chunk=1024*1024;
const body=bytes=>{let offset=0;return {body:new ReadableStream({pull(c){
 if(offset===bytes.length){c.close();return;}
 const next=Math.min(bytes.length,offset+chunk);c.enqueue(bytes.subarray(offset,next));offset=next;
}})};};

test('real Miniflare keeps data/progress across restart while exact Local auth, official queue and raw upload handlers stay intact',
 {skip:!dependency,timeout:40_000},async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ngs-local-miniflare-fixture-')));
 const env={NGS_FILE_SYNC_MODE:'push',NGS_FILE_SYNC_PROJECTS:'binari',
  NGS_LOCAL_MINIFLARE_ROOT:root,NGS_REQUEST_QUEUE_DB:join(root,'queue.sqlite')};
 const requests=[];
 const Base=createRequire(dependency)('miniflare').Miniflare;
 const load=async()=>class {
  constructor(opts){this.workerd=new Base(opts);}
  dispatchFetch(url,init){
   if(new URL(url).pathname==='/call'&&typeof init.body==='string')requests.push(JSON.parse(init.body).op);
   return this.workerd.dispatchFetch(url,init);
  }
  getD1Database(...args){return this.workerd.getD1Database(...args);}
  dispose(){return this.workerd.dispose();}
 };
 const start=()=>startLocalMiniflareNgs({env,fixture:true,load,browserPort:0,receiverPort:0});
 let running=await start();
 t.after(async()=>{await running.close();rmSync(root,{recursive:true,force:true});});
 function addresses(){
  const origin='http://127.0.0.1:'+running.ports.web,endpoint='http://127.0.0.1:'+running.ports.mcp+'/mcp';
  return {origin,ngs:loopbackJsonMCP(endpoint),upload:createLoopbackFileUpload(endpoint)};
 }
 let {origin,ngs,upload}=addresses();
 const data=new Map([
  ['project.json',Buffer.from('{"name":"Fixture Miniflare","projectId":"binari"}')],
  ['npcs/metadata.json',Buffer.from('{"characterOrder":["fixture"]}')],
  ['npcs/fixture/metadata.json',Buffer.from('{"id":"fixture","name":"Fixture Actor","kind":"npc"}')],
  ['test/control.bin',Buffer.alloc(19_200_000,11)],
 ]);
 const by=new Map(),scope='binari';
 for(const [path,bytes] of data){
  const folder=path.includes('/')?path.split('/')[0]:'';
  if(!by.has(folder))by.set(folder,[]);
  by.get(folder).push({path,sha256:sha(bytes),size:bytes.length});
 }
 const pds={compare:async(_scope,files)=>({scope,groups:files.length?[]:[...by].map(([folder,files])=>({folder,files})),deleted:[]}),
  file:(_scope,path)=>body(data.get(path))};
 const session=async()=>{
  const res=await fetch(origin+'/__npcgen_session');assert.equal(res.status,200);
  return {Cookie:res.headers.get('Set-Cookie').split(';')[0]};
 };
 assert.equal((await fetch(origin+'/api/project-folders')).status,401);
 const initialCheck=await fetch(origin+'/api/project-folders',{headers:await session()});
 assert.deepEqual((await initialCheck.json()).projects,[]);
 assert.deepEqual(await ngs('ngs_request_queue_list',{}),{requests:[]});
 const queueInode=statSync(env.NGS_REQUEST_QUEUE_DB).ino;
 assert.deepEqual(await pushProjectFiles({scope,pds,ngs,upload}),{ok:true,written:4,failed:0});
 const cookie=await session();
 assert.equal((await (await fetch(origin+'/api/project-folders',{headers:cookie})).json()).projects[0].name,'Fixture Miniflare');
 const route='/api/npc-workspace?projectId=binari&npcId=fixture';
 const beforeCold=requests.length;
 let detail=await (await fetch(origin+route,{headers:cookie})).json();
 assert.equal(detail.npc.id,'fixture');
 assert.ok(requests.slice(beforeCold).includes('get'));
 assert.ok(requests.slice(beforeCold).includes('cache-store'));
 const beforeDenied=requests.length;
 assert.equal((await fetch(origin+route)).status,401);
 assert.equal(requests.length,beforeDenied);
 const otherCookie=await session();assert.notDeepEqual(otherCookie,cookie);
 const beforeWarm=requests.length;
 assert.deepEqual(await(await fetch(origin+route,{headers:otherCookie})).json(),detail);
 assert.ok(requests.slice(beforeWarm).includes('cache-read'));
 assert.ok(!requests.slice(beforeWarm).includes('get'));
 assert.deepEqual(await(await fetch(origin+'/api/ngs-sync-progress?projectId=binari',{headers:cookie})).json(),
  {state:'completed',fileName:null,percent:100,completed:4,total:4,failed:0});
 const changed='npcs/fixture/metadata.json',updated=Buffer.from('{"id":"fixture","name":"Changed Fixture","kind":"npc"}');
 data.set(changed,updated);
 const delta={...pds,compare:async()=>({scope,deleted:[],groups:[{folder:'npcs',files:[{path:changed,sha256:sha(updated),size:updated.length}]}]})};
 const beforeCommit=requests.length;
 assert.deepEqual(await pushProjectFiles({scope,pds:delta,ngs,upload}),{ok:true,written:1,failed:0});
 assert.ok(!requests.slice(beforeCommit).includes('cache-store'),'invalidate without rebuilding during publish');
 const beforeRebuild=requests.length;
 detail=await(await fetch(origin+route,{headers:cookie})).json();
 assert.equal(detail.npc.name,'Changed Fixture');
 assert.ok(requests.slice(beforeRebuild).includes('get')&&requests.slice(beforeRebuild).includes('cache-store'));
 await running.close();running=await start();({origin,ngs,upload}=addresses());
 assert.equal((await fetch(origin+route)).status,401);
 const beforeRestartRead=requests.length;
 assert.deepEqual(await(await fetch(origin+route,{headers:await session()})).json(),detail);
 assert.ok(!requests.slice(beforeRestartRead).includes('get'),'warm snapshot persisted in Miniflare R2 across restart');
 assert.equal(statSync(env.NGS_REQUEST_QUEUE_DB).ino,queueInode);
 const read=await ngs('ngs_file_sync_begin',{scope});
 assert.deepEqual(read.files,[...data].map(([path,b])=>({path,sha256:sha(b)})).sort((a,b)=>a.path<b.path?-1:1));
 await ngs('ngs_file_sync_abort',{syncId:read.syncId});
 assert.deepEqual(await pushProjectFiles({scope,pds,ngs,upload}),{ok:true,written:0,failed:0});
 await running.close();
 const direct=await openLocalMiniflareReplica({persistRoot:root,fixture:true,load});
 try{
  const file=await direct.replica.get('test/control.bin',{range:{offset:5*chunk,length:10}});
  assert.deepEqual(Buffer.from(await file.arrayBuffer()),Buffer.alloc(10,11));
  assert.equal(typeof await direct.replica.npcCache.version(),'number');
 }finally{await direct.close();}
});
