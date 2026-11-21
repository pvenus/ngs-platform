import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
import {fileSyncDestinationOptions,pushProjectFiles,pushSpaceProjectFiles,pushObjectProjectFiles,sharePdsChunkSlots,sharePdsCompareSlot,watchPdsMcpFileSync} from '../build/pds-mcp-file-sync.mjs';

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

test('Space failed middle chunk retries at zero, and repeat failure or uncertain reset never blocks unrelated file',async()=>{
 const scope='binari',two=Buffer.alloc(1024*1024+1,65),names=['recover','defer','no-reset','unrelated'];
 const selections=names.map(x=>row('files/'+x,x==='unrelated'?Buffer.from('ok'):two)),started=new Map(),offsets=[],failed=[],reset=[];
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
   throw Error('SPACE_MACHINE_OPERATION_UNAVAILABLE');
  const end=args.offset+Buffer.from(args.dataBase64,'base64').byteLength;
  return {nextOffset:end===args.size?null:end};
 };
 const result=await pushSpaceProjectFiles({scope,pds,ngs,onFileError:(_scope,r,e,n)=>failed.push([r.path,e.message,n])});
 assert.deepEqual(result,{ok:true,written:2,failed:2});
 assert.deepEqual([...started],[['recover',2],['defer',2],['no-reset',1],['unrelated',1]]);
 assert.deepEqual(reset,['recover','defer','defer','no-reset']);
 assert.deepEqual(offsets.filter(([key])=>key==='recover'),[['recover',1,0],['recover',1,1024*1024],['recover',2,0],['recover',2,1024*1024]]);
 assert.deepEqual(failed,[['files/defer','SPACE_MACHINE_OPERATION_UNAVAILABLE',2],['files/no-reset','SPACE_MACHINE_OPERATION_UNAVAILABLE',1]]);
 assert.deepEqual(offsets.at(-1),['unrelated',1,0]);
});

test('independent object lanes begin siblings while one slow file waits; all files join before finish',async()=>{
 const scope='binari',data=Buffer.from('payload'),rows=Array.from({length:9},(_,i)=>row('f'+i,data));
 const gate=Promise.withResolvers(),started=[],completed=[],numbers=[];
 let active=0;
 const pds={
  async compare(){return {scope,groups:[{folder:'',files:rows}],deleted:[]};},
  file(){return {body:new ReadableStream({start(c){c.enqueue(data);c.close();}})};},
 };
 const ngs=async(name,args)=>{
  if(name==='ngs_file_sync_begin')return receipt(scope);
  if(name==='ngs_file_sync_finish'){
   assert.equal(active,0);assert.equal(completed.length,9);return {ok:true,written:completed.length};
  }
  assert.equal(name,'ngs_file_sync_file_chunk');assert.equal(args.offset,0);
  started.push(args.path);numbers.push(++active);
  if(args.path==='f0')await gate.promise;
  await new Promise(setImmediate);
  --active;completed.push(args.path);
  return {nextOffset:null};
 };
 const pass=pushObjectProjectFiles({scope,pds,ngs,concurrency:4});
 await new Promise(setImmediate);
 assert.deepEqual(started,['f0','f1','f2','f3']);
 assert.equal(completed.length,0);
 gate.resolve();
 assert.deepEqual(await pass,{ok:true,written:9,failed:0});
 assert.equal(new Set(started).size,9);
 assert.equal(Math.max(...numbers),4);
 assert.ok(completed.length===9);
 await assert.rejects(pushObjectProjectFiles({scope,pds,ngs,concurrency:9}),/PDS_NGS_FILE_SYNC_INVALID/);
});

test('source chunk concurrency capped globally and unrelated compare is never queued behind chunks',async()=>{
 const release=Promise.withResolvers(),seen=[],max=[];
 let count=0;
 const call=sharePdsChunkSlots(async(name,i)=>{
  if(name==='npc_folders_compare'){seen.push(name);return;}
  seen.push(i);max.push(++count);
  try{
   if(i===0)await release.promise;
   if(i===1){await release.promise;throw Error('fixture source failure');}
   await new Promise(setImmediate);
  }finally{--count;}
 });
 const work=Promise.allSettled(Array.from({length:8},(_,i)=>call('npc_folder_file_chunk',i)));
 await new Promise(setImmediate);
 await call('npc_folders_compare');
 assert.deepEqual(seen,[0,1,'npc_folders_compare']);
 release.resolve();
 assert.equal((await work).filter(x=>x.status==='fulfilled').length,7);
 assert.equal(Math.max(...max),2);
 assert.deepEqual(seen,[0,1,'npc_folders_compare',2,3,4,5,6,7]);
});

test('batch count and byte bounds retain order, with larger files on their original stream',async()=>{
 const scope='binari',big=Buffer.alloc(1024*1024+1,42),mid=Buffer.alloc(260*1024,45),tiny=Buffer.from('1');
 const files=new Map([
  ...Array.from({length:34},(_,i)=>['f'+i,tiny]),['mid1',mid],['mid2',mid],
  ['large',big],['tail1',mid],['tail2',mid],
 ]);
 const rows=[...files].map(([name,bytes])=>row(name,bytes)),passes=[],reads=[];
 const pds={
  async compare(){return {scope,groups:[{folder:'',files:rows}],deleted:[]};},
  file(_scope,path){
   reads.push(path);const data=files.get(path);
   return {body:new ReadableStream({start(c){c.enqueue(data.subarray(0,1024*1024));
    if(data.length>1024*1024)c.enqueue(data.subarray(1024*1024));c.close();}})};
  },
 };
 const ngs=async(name,args)=>{
  if(name==='ngs_file_sync_begin')return receipt(scope);
  if(name==='ngs_file_sync_finish')return {ok:true,written:files.size};
  assert.equal(args.syncId,id);
  if(name==='ngs_file_sync_file_batch'){
   assert.ok(args.files.length<=32);
   assert.ok(args.files.reduce((n,f)=>n+f.size,0)<=512*1024);
   for(const f of args.files)assert.deepEqual(Buffer.from(f.dataBase64,'base64'),files.get(f.path));
   passes.push(args.files.map(f=>f.path));
   return {results:args.files.map(f=>({path:f.path,sha256:f.sha256,status:'accepted'}))};
  }
  assert.equal(name,'ngs_file_sync_file_chunk');assert.equal(args.path,'large');
  passes.push([args.path,args.offset]);
  return {nextOffset:args.offset===0?1024*1024:null};
 };
 assert.deepEqual(await pushObjectProjectFiles({scope,pds,ngs,batchSmallFiles:true,batchFileLimit:32,batchByteLimit:512*1024}),
  {ok:true,written:files.size,failed:0});
 assert.deepEqual(passes,[
  Array.from({length:32},(_,i)=>'f'+i),['f32','f33','mid1'],['mid2'],['large',0],['large',1024*1024],['tail1'],['tail2'],
 ]);
 assert.deepEqual(reads,[...files.keys()]);
 await assert.rejects(pushObjectProjectFiles({scope,pds,ngs,batchSmallFiles:true,batchFileLimit:33}),/PDS_NGS_FILE_SYNC_INVALID/);
 await assert.rejects(pushObjectProjectFiles({scope,pds,ngs,batchSmallFiles:true,batchByteLimit:2*1024*1024+1}),/PDS_NGS_FILE_SYNC_INVALID/);
});

test('definite batch rejection retries only failed member at offset zero and retains accepted receipts',async()=>{
 const scope='binari',body=Buffer.from('content'),files=['good','retry','also-good'].map(path=>row(path,body)),events=[];
 const pds={
  async compare(){return {scope,groups:[{folder:'',files}],deleted:[]};},
  file(){return {body:new ReadableStream({start(c){c.enqueue(body);c.close();}})};},
 };
 const ngs=async(name,args)=>{
  events.push([name,args.path,args.offset]);
  if(name==='ngs_file_sync_begin')return receipt(scope);
  if(name==='ngs_file_sync_file_batch')return {results:args.files.map(({path,sha256})=>path==='retry'?
   {path,sha256,status:'failed',code:'NGS_FILE_SYNC_UNAVAILABLE'}:{path,sha256,status:'accepted'})};
  if(name==='ngs_file_sync_file_reset')return {ok:true};
  if(name==='ngs_file_sync_file_chunk')return {nextOffset:null};
  if(name==='ngs_file_sync_finish')return {ok:true,written:files.length};
  assert.fail(name);
 };
 assert.deepEqual(await pushObjectProjectFiles({scope,pds,ngs,batchSmallFiles:true}),{ok:true,written:3,failed:0});
 assert.deepEqual(events,[
  ['ngs_file_sync_begin',undefined,undefined],['ngs_file_sync_file_batch',undefined,undefined],
  ['ngs_file_sync_file_reset','retry',undefined],['ngs_file_sync_file_chunk','retry',0],['ngs_file_sync_finish',undefined,undefined],
 ]);
});

test('lost or malformed batch ACK reconciles exact same-pass writes; unresolved ACK skips finish/tombstones',async()=>{
 const scope='binari',body=Buffer.from('content'),files=['a','b'].map(path=>row(path,body));
 const obsolete={path:'deleted',sha256:sha('old')};
 let comparisons;
 for(const resolved of [true,false]){
  const calls=[];
  comparisons=0;
  const pds={
   async compare(){return ++comparisons===1?{scope,groups:[{folder:'',files}],deleted:[obsolete]}:{scope,groups:[],deleted:[obsolete]};},
   file(){return {body:new ReadableStream({start(c){c.enqueue(body);c.close();}})};},
  };
  const ngs=async(name,args)=>{
   calls.push([name,args.path,args.offset]);
   if(name==='ngs_file_sync_begin')return receipt(scope,[obsolete]);
   assert.equal(args.syncId,id);
   if(name==='ngs_file_sync_file_batch'){
    if(resolved)throw Error('NETWORK_ACK_LOST');
    return {results:[{path:'a',sha256:files[0].sha256,status:'accepted'}]};
   }
   if(name==='ngs_file_sync_file_chunk'){
    assert.equal(args.offset,0);
    assert.equal(args.sha256,files[0].sha256);
    if(!resolved&&args.path==='b')throw Error('NETWORK_ACK_LOST');
    return {nextOffset:null};
   }
   if(name==='ngs_file_sync_remove')return {removed:true};
   if(name==='ngs_file_sync_finish')return {ok:true,written:2};
   if(name==='ngs_file_sync_abort')return {ok:true};
   assert.fail(name);
  };
  const work=pushObjectProjectFiles({scope,pds,ngs,batchSmallFiles:true});
  if(resolved)assert.deepEqual(await work,{ok:true,written:2,failed:0});
  else await assert.rejects(work,/NGS_FILE_SYNC_BATCH_ACK_UNRESOLVED/);
  assert.deepEqual(calls.map(row=>row[0]),[
   'ngs_file_sync_begin','ngs_file_sync_file_batch','ngs_file_sync_file_chunk','ngs_file_sync_file_chunk',
   ...(resolved?['ngs_file_sync_remove','ngs_file_sync_finish']:['ngs_file_sync_abort']),
  ]);
  assert.equal(comparisons,resolved?2:1);
 }
});

test('strict per-destination settings select the measured shape without coupling Local and Space',()=>{
 const env={
  NGS_LOCAL_FILE_SYNC_BATCH_ENABLED:'1',NGS_LOCAL_FILE_SYNC_BATCH_FILES:'32',
  NGS_LOCAL_FILE_SYNC_BATCH_RAW_BYTES:'1048576',NGS_LOCAL_FILE_SYNC_LANES:'4',
  NGS_SPACE_FILE_SYNC_BATCH_ENABLED:'1',NGS_SPACE_FILE_SYNC_LANES:'2',
 };
 assert.deepEqual(fileSyncDestinationOptions(env,'local'),{concurrency:4,batchSmallFiles:true,batchFileLimit:32,batchByteLimit:1048576});
 assert.deepEqual(fileSyncDestinationOptions(env,'space'),{concurrency:2,batchSmallFiles:true,batchFileLimit:32,batchByteLimit:1048576});
 assert.deepEqual(fileSyncDestinationOptions({},'space'),{concurrency:1,batchSmallFiles:false,batchFileLimit:32,batchByteLimit:1048576});
 env.NGS_SPACE_FILE_SYNC_BATCH_FILES='33';
 assert.equal(fileSyncDestinationOptions(env,'local').batchFileLimit,32);
 assert.throws(()=>fileSyncDestinationOptions(env,'space'),/PDS_NGS_FILE_SYNC_INVALID/);
 assert.throws(()=>fileSyncDestinationOptions({...env,NGS_LOCAL_FILE_SYNC_LANES:'4.0'},'local'),/PDS_NGS_FILE_SYNC_INVALID/);
 assert.throws(()=>fileSyncDestinationOptions({...env,NGS_LOCAL_FILE_SYNC_BATCH_RAW_BYTES:'2097153'},'local'),/PDS_NGS_FILE_SYNC_INVALID/);
});
