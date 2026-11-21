import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {test} from 'node:test';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
import {pushProjectFiles,watchPdsMcpFileSync} from '../build/pds-mcp-file-sync.mjs';

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
