import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
import {pushProjectFiles,pushSpaceProjectFiles,pushObjectProjectFiles,shareFileTransferSlot,sharePdsCompareSlot,watchPdsMcpFileSync} from '../build/pds-mcp-file-sync.mjs';

const id='ngs.sync.6f56d34f-62ca-42a7-a173-14700d922865';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=(scope,files=[])=>({syncId:id,scope,inventoryAt:1,files});
const row=(path,bytes)=>({path,sha256:sha(bytes),size:bytes.length});

test('uses existing PDS compare/pinned chunk reader; only transfers changed files, including empty',async()=>{
 const scope='binari',a=Buffer.alloc(1024*1024+3,65),b=Buffer.alloc(0);
 const changed=[row('audio/a.wav',a),row('audio/empty.txt',b)],pdsCalls=[],calls=[];
 const replica=[{path:'audio/local-only.wav',sha256:sha('retained')}];
 const pds=createFolderMcpClient({call:async(name,args)=>{
  pdsCalls.push({name,args});
  if(name==='npc_folders_compare'){
   assert.deepEqual(args,{scope,files:replica,includeDeleted:true});
   return {scope,groups:[{folder:'audio',files:changed}],deleted:[]};
  }
  assert.equal(name,'npc_folder_file_chunk');
  const bytes=args.path==='audio/a.wav'?a:b;
  const chunk=bytes.subarray(args.offset,args.offset+1024*1024),end=args.offset+chunk.length;
  return {...args,size:bytes.length,nextOffset:end===bytes.length?null:end,base64:chunk.toString('base64')};
 }});
 const ngs=async(name,args)=>{
  calls.push({name,args});
  if(name==='ngs_file_sync_begin')return receipt(scope,replica);
  if(name==='ngs_file_sync_finish')return {ok:true,written:2};
  const end=args.offset+Buffer.from(args.dataBase64,'base64').length;
  return {nextOffset:end===args.size?null:end};
 };
 assert.deepEqual(await pushProjectFiles({scope,pds,ngs}),{ok:true,written:2});
 assert.deepEqual(pdsCalls.slice(1).map(x=>x.args.offset),[0,1024*1024,0]);
 assert.deepEqual(calls.map(x=>x.name),['ngs_file_sync_begin',...Array(3).fill('ngs_file_sync_file_chunk'),'ngs_file_sync_finish']);
 assert.deepEqual(calls.slice(1,-1).map(x=>[x.args.path,x.args.offset]),[['audio/a.wav',0],['audio/a.wav',1024*1024],['audio/empty.txt',0]]);
});

test('rejects hidden/invalid paths and corrupt bytes, aborting but never finishing',async()=>{
 for(const path of ['.deleted/a','audio/../a','audio/a']){
  const names=[];
  const pds={compare:async()=>({scope:'binari',groups:[{folder:path.split('/')[0],files:[row(path,Buffer.from('wanted'))]}],deleted:[]}),
   file:()=>({body:new ReadableStream({start(c){c.enqueue(Buffer.from('damaged'));c.close();}})})};
  const ngs=async name=>{names.push(name);return name==='ngs_file_sync_begin'?receipt('binari'):{ok:true};};
  await assert.rejects(pushProjectFiles({scope:'binari',pds,ngs}),/PDS_NGS_FILE_SYNC_INVALID/);
  assert.deepEqual(names,['ngs_file_sync_begin','ngs_file_sync_abort']);
 }
});

test('watch intersects discovery, delivers serial projects, and enforces pass cadence, not task cadence',async()=>{
 const calls=[],errors=[],controller=new AbortController();
 let clock=100,pass=0,scope;
 const pds={
  discover:async()=>{calls.push(['pass',++pass,clock]);return {projects:['binari','extra','spark']};},
  compare:async scope=>({scope,groups:[],deleted:[]}),
 };
 const ngs=async(name,args)=>{
  if(name==='ngs_file_sync_begin'){
   scope=args.scope;calls.push(['begin',scope,clock]);
   if(pass===1&&scope==='binari')throw Error('fixture fail');
   return receipt(scope);
  }
  assert.equal(name,'ngs_file_sync_finish');
  if(pass===2&&scope==='binari')clock+=65_000;
  return {ok:true,written:0};
 };
 await watchPdsMcpFileSync({pds,ngs,projects:['binari','disabled','spark'],signal:controller.signal,
  now:()=>clock,sleep:async ms=>{clock+=ms;},
  onError:scope=>errors.push(scope),
  onResult:scope=>{if(pass===3&&scope==='spark')controller.abort();},
 });
 assert.deepEqual(errors,['binari']);
 assert.deepEqual(calls,[
  ['pass',1,100],['begin','binari',100],['begin','spark',100],
  ['pass',2,60100],['begin','binari',60100],['begin','spark',125100],
  ['pass',3,125100],['begin','binari',125100],['begin','spark',125100],
 ]);
});

test('reconfirms exact tombstones after writes; removes only explicit repeat matches',async()=>{
 const scope='binari',bytes=Buffer.from('updated'),newFile=row('audio/new.wav',bytes);
 const stale={path:'audio/stale.wav',sha256:sha('old')},localOnly={path:'audio/retained.wav',sha256:sha('retained')};
 const calls=[],inventory=[stale,localOnly];
 const pds={
  compare:async (scope,files,opts)=>{
   assert.deepEqual(opts,{includeDeleted:true});
   calls.push(['compare',files]);
   return {scope,groups:[{folder:'audio',files:[newFile]}],deleted:[stale]};
  },
  file:()=>({body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})}),
 };
 const ngs=async (name,args)=>{
  calls.push([name,args]);
  if(name==='ngs_file_sync_begin')return receipt(scope,inventory);
  if(name==='ngs_file_sync_file_chunk')return {nextOffset:null};
  if(name==='ngs_file_sync_remove')return {removed:true};
  return {ok:true,written:1};
 };
 assert.deepEqual(await pushProjectFiles({scope,pds,ngs}),{ok:true,written:1});
 assert.deepEqual(calls.map(c=>c[0]),['ngs_file_sync_begin','compare','ngs_file_sync_file_chunk','compare','ngs_file_sync_remove','ngs_file_sync_finish']);
 assert.deepEqual(calls[3][1],[stale]);
 assert.deepEqual(calls[4][1],{syncId:id,...stale});
});

test('restored or forged tombstones abort before any remove RPC',async()=>{
 const scope='binari',a={path:'a.txt',sha256:sha('a')},b={path:'b.txt',sha256:sha('b')};
 for(const second of [[],[a],[a,{...b,sha256:sha('wrong')}],[a,b,a]]){
  let read=0;const calls=[];
  const pds={compare:async()=>({scope,groups:[],deleted:read++===0?[a,b]:second})};
  const ngs=async name=>{calls.push(name);return name==='ngs_file_sync_begin'?receipt(scope,[a,b]):{ok:true};};
  await assert.rejects(pushProjectFiles({scope,pds,ngs}),/PDS_NGS_FILE_SYNC_(TOMBSTONE_CHANGED|INVALID)/);
  assert.deepEqual(calls,['ngs_file_sync_begin','ngs_file_sync_abort']);
 }
});


test('two destinations share only the one PDS compare slot and recover after a rejected compare',async()=>{
 const events=[];
 const remoteBegin=Promise.withResolvers(),localCompare=Promise.withResolvers(),remoteFinish=Promise.withResolvers();
 const pds=sharePdsCompareSlot({
  async compare(scope,rows){
   events.push(['entered',rows.length]);
   if(rows.length===0){
    await localCompare.promise;
    throw Error('FOLDER_BUSY');
   }
   return {scope,groups:[],deleted:[]};
  },
 });
 const existing=[{path:'audio/x.wav',sha256:sha('same')}];
 const names=[];
 const first=pushProjectFiles({scope:'binari',pds,ngs:async name=>{
  if(name==='ngs_file_sync_begin')return receipt('binari');
  names.push(name);return {ok:true};
 }});
 const firstResult=assert.rejects(first,/FOLDER_BUSY/);
 const second=pushProjectFiles({scope:'binari',pds,ngs:async name=>{
  if(name==='ngs_file_sync_begin'){
   remoteBegin.resolve();return receipt('binari',existing);
  }
  assert.equal(name,'ngs_file_sync_finish');
  await remoteFinish.promise;return {ok:true,written:0};
 }});
 await remoteBegin.promise;
 await new Promise(setImmediate);
 assert.deepEqual(events,[['entered',0]]);
 localCompare.resolve();
 await firstResult;
 assert.deepEqual(names,['ngs_file_sync_abort']);
 // Space is still waiting on its own upload finish, but a local compare can proceed.
 assert.deepEqual(await pds.compare('binari',existing),{scope:'binari',groups:[],deleted:[]});
 assert.deepEqual(events,[['entered',0],['entered',1],['entered',1]]);
 remoteFinish.resolve();
 assert.deepEqual(await second,{ok:true,written:0});
});

test('Space failed final chunk retries at zero, and repeat failure or uncertain reset never blocks unrelated file',async()=>{
 const scope='binari',two=Buffer.alloc(1024*1024+1,65),names=['recover','defer','no-reset','unrelated'];
 const selections=names.map(x=>row('files/'+x,x==='unrelated'?Buffer.from('ok'):two)),started=new Map(),offsets=[],failed=[],reset=[],marked=[];
 const pds={
  compare:async()=>({scope,groups:[{folder:'files',files:selections}],deleted:[]}),
  file(_scope,path){
   const key=path.split('/').at(-1),b=key==='unrelated'?Buffer.from('ok'):two;
   started.set(key,(started.get(key)??0)+1);
   return {body:new ReadableStream({start(c){c.enqueue(b.subarray(0,1024*1024));if(b.length>1024*1024)c.enqueue(b.subarray(1024*1024));c.close();}})};
  },
 };
 const ngs=async(name,args)=>{
  if(name==='ngs_file_sync_begin')return receipt(scope);
  if(name==='ngs_file_sync_finish')return {ok:true,written:2};
  if(name==='ngs_file_sync_plan'){assert.deepEqual(args,{syncId:id,totalFiles:4});return {ok:true};}
  if(name==='ngs_file_sync_file_failed'){marked.push(args.path);return {ok:true};}
  assert.equal(args.syncId,id);
  const key=args.path.split('/').at(-1);
  if(name==='ngs_file_sync_file_reset'){
   assert.deepEqual(Object.keys(args).sort(),['path','syncId']);
   reset.push(key);
   if(key==='no-reset')throw Error('NGS_FILE_SYNC_BUSY');
   return {ok:true};
  }
  assert.equal(name,'ngs_file_sync_file_chunk');
  offsets.push([key,started.get(key),args.offset]);
  if(args.offset>0&&key!=='unrelated'&&(key!=='recover'||started.get(key)===1))
   throw Error('NGS_FILE_SYNC_CONTENT_MISMATCH');
  const end=args.offset+Buffer.from(args.dataBase64,'base64').byteLength;
  return {nextOffset:end===args.size?null:end};
 };
 const result=await pushSpaceProjectFiles({scope,pds,ngs,onFileError:(_scope,r,e,n)=>failed.push([r.path,e.message,n])});
 assert.deepEqual(result,{ok:true,written:2,failed:2});
 assert.deepEqual([...started],[['recover',2],['defer',2],['no-reset',1],['unrelated',1]]);
 assert.deepEqual(reset,['recover','defer','no-reset']);
 assert.deepEqual(offsets.filter(([key])=>key==='recover'),[['recover',1,0],['recover',1,1024*1024],['recover',2,0],['recover',2,1024*1024]]);
 assert.deepEqual(failed,[['files/defer','NGS_FILE_SYNC_CONTENT_MISMATCH',2],['files/no-reset','NGS_FILE_SYNC_CONTENT_MISMATCH',1]]);
 assert.deepEqual(marked,['files/defer','files/no-reset']);
 assert.deepEqual(offsets.at(-1),['unrelated',1,0]);
});

test('actual Local/Space users of the same FIFO slot alternate complete files and never overlap chunks',async()=>{
 const scope='binari',fileSlot=shareFileTransferSlot(),bytes=Buffer.alloc(1024*1024+1,5),events=[];
 const first=Promise.withResolvers(),wait=Promise.withResolvers(),spacePlanned=Promise.withResolvers();
 const pds={
  compare:async()=>({scope,groups:[{folder:'',files:['one','two'].map(path=>row(path,bytes))}],deleted:[]}),
  file(_scope,path){events.push(['open',path]);return {body:new ReadableStream({start(c){c.enqueue(bytes.subarray(0,1024*1024));c.enqueue(bytes.subarray(1024*1024));c.close();}})};},
 };
 const endpoint=label=>async(name,args)=>{
  if(name==='ngs_file_sync_begin')return receipt(scope);
  if(name==='ngs_file_sync_plan'){
   assert.deepEqual(args,{syncId:id,totalFiles:2});
   if(label==='space')spacePlanned.resolve();
   return {ok:true};
  }
  if(name==='ngs_file_sync_finish')return {ok:true,written:2};
  assert.equal(name,'ngs_file_sync_file_chunk');
  events.push([label,args.path,args.offset]);
  if(label==='local'&&args.path==='one'&&args.offset===0){first.resolve();await wait.promise;}
  return {nextOffset:args.offset===0?1024*1024:null};
 };
 const local=pushObjectProjectFiles({scope,pds,ngs:endpoint('local'),fileSlot});
 await first.promise;
 const space=pushSpaceProjectFiles({scope,pds,ngs:endpoint('space'),fileSlot});
 await spacePlanned.promise;
 await new Promise(setImmediate);
 assert.deepEqual(events,[['open','one'],['local','one',0]]);
 wait.resolve();
 assert.deepEqual(await Promise.all([local,space]),Array(2).fill({ok:true,written:2,failed:0}));
 assert.deepEqual(events.filter(x=>x[0]!=='open'),[
  ['local','one',0],['local','one',1024*1024],['space','one',0],['space','one',1024*1024],
  ['local','two',0],['local','two',1024*1024],['space','two',0],['space','two',1024*1024],
 ]);
});

test('unknown final ACK retries from zero, then aborts without failed marker, tombstones, or finish if unresolved',async()=>{
 const scope='binari',bytes=Buffer.alloc(1024*1024+1,4),stale={path:'old',sha256:sha('old')};
 const pds={
  compare:async()=>({scope,groups:[{folder:'',files:[row('new',bytes)]}],deleted:[stale]}),
  file:()=>({body:new ReadableStream({start(c){c.enqueue(bytes.subarray(0,1024*1024));c.enqueue(bytes.subarray(1024*1024));c.close();}})}),
 };
 for(const lost of [1,2]){
  const calls=[];let final=0;
  const ngs=async(name,args)=>{
   calls.push([name,args?.offset]);
   if(name==='ngs_file_sync_begin')return receipt(scope,[stale]);
   if(name==='ngs_file_sync_file_chunk'){
    if(args.offset===0)return {nextOffset:1024*1024};
    if(++final<=lost)throw Error('NGS_SPACE_MACHINE_MCP_UNAVAILABLE');
    return {nextOffset:null};
   }
   if(name==='ngs_file_sync_finish')return {ok:true,written:1};
   if(name==='ngs_file_sync_remove')return {removed:true};
   return {ok:true};
  };
  const work=pushSpaceProjectFiles({scope,pds,ngs});
  if(lost===1)assert.deepEqual(await work,{ok:true,written:1,failed:0});
  else await assert.rejects(work,/NGS_FILE_SYNC_FILE_ACK_UNRESOLVED/);
  assert.deepEqual(calls.filter(x=>x[0].endsWith('file_chunk')).map(x=>x[1]),[0,1024*1024,0,1024*1024]);
  assert.equal(calls.filter(x=>x[0].endsWith('file_failed')).length,0);
  assert.equal(calls.filter(x=>x[0].endsWith('remove')).length,lost===1?1:0);
  assert.equal(calls.at(-1)[0],lost===1?'ngs_file_sync_finish':'ngs_file_sync_abort');
 }
});
