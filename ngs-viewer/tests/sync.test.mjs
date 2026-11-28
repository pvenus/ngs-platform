import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openMirror,mirrorChunkBytes} from '../lib/mirror.mjs';
import {pullSpaceToP2} from '../lib/sync.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const row=(path,bytes)=>({path,sha256:sha(bytes),size:bytes.length});
async function fixture(t){
 const root=await realpath(await mkdtemp(join(tmpdir(),'ngs-pull-')));
 const mirror=await openMirror(root);
 t.after(async()=>{mirror.close();await rm(root,{recursive:true,force:true});});
 return {mirror,read:path=>readFile(join(root,'binari',path))};
}
function remote(source,{atCompare,corrupt=()=>false,resources=['project','props']}={}){
 const data=new Map(source), calls=[];
 let compares=0;
 return {calls,async get(path){
  if(path==='/api/viewer/manifest'){
   atCompare?.(++compares,data);
   return {status:200,bytes:Buffer.from(JSON.stringify({projectId:'binari',resources,files:[...data].map(([p,b])=>row(p,b))}))};
  }
  const u=new URL(path,'http://127.0.0.1'),name=u.searchParams.get('path'),offset=Number(u.searchParams.get('offset')),value=data.get(name);
  calls.push([name,offset]);assert.equal(u.searchParams.get('sha256'),sha(value));
  const bytes=Buffer.from(value.subarray(offset,offset+mirrorChunkBytes));
  if(corrupt(name,offset)&&bytes.length)bytes[0]^=255;
  return {status:200,bytes,fileSize:String(value.length),fileSha256:sha(value),fileOffset:String(offset)};
 }};
}
test('shared MCP pull retries a corrupt file from zero and preserves an old copy if both reads fail', {skip:process.platform==='win32'},async t=>{
 const {mirror,read}=await fixture(t);
 const old=Buffer.from('old'),broken='props/test-broken/body.png',large='props/test-large/body.png',empty='props/test-large/blank.png';
 const first=remote([[broken,old]]);
 assert.equal((await pullSpaceToP2({mirror,remote:first.get})).changed,1);
 const big=Buffer.alloc(mirrorChunkBytes+11,34);
 let largeAttempt=0;
 const second=remote([[broken,Buffer.from('new')],[large,big],[empty,Buffer.alloc(0)]],{
  corrupt(name,offset){return name===broken||name===large&&offset===0&&++largeAttempt===1;}
 });
 const out=await pullSpaceToP2({mirror,remote:second.get});
 assert.equal(out.failed,1);assert.equal(out.changed,2);
 assert.deepEqual(second.calls.filter(([p])=>p===large).map(([,o])=>o),[0,mirrorChunkBytes,0,mirrorChunkBytes]);
 assert.deepEqual(await read(broken),old);assert.deepEqual(await read(large),big);assert.equal((await read(empty)).length,0);
});
test('shared MCP pull only tombstones files still deleted on re-comparison', {skip:process.platform==='win32'},async t=>{
 const {mirror,read}=await fixture(t);
 const path='props/test-delete/body.png',bytes=Buffer.from('retain when restored');
 await pullSpaceToP2({mirror,remote:remote([[path,bytes]]).get});
 const revived=remote([],{atCompare(n,data){if(n===2)data.set(path,bytes);}});
 await assert.rejects(pullSpaceToP2({mirror,remote:revived.get}));
 assert.deepEqual(await read(path),bytes);
 const revoked=remote([],{resources:['project']});
 assert.equal((await pullSpaceToP2({mirror,remote:revoked.get})).removed,0);
 assert.deepEqual(await read(path),bytes);
 assert.equal((await pullSpaceToP2({mirror,remote:remote([]).get})).removed,1);
 await assert.rejects(read(path),{code:'ENOENT'});
});

test('downloads ten distinct files in parallel, with each file read strictly in offset order',
 {skip:process.platform==='win32',timeout:5000},async t=>{
 const {mirror,read}=await fixture(t), full=Buffer.alloc(mirrorChunkBytes+33,47);
 const data=Array.from({length:12},(_,i)=>['props/file-'+i+'/body.png',full]);
 const upstream=remote(data), active=new Set(), offsets=new Map();
 let peak=0,release,tenStarted;
 const firstWave=new Promise(resolve=>{release=resolve;});
 const parallelReached=new Promise(resolve=>{tenStarted=resolve;});
 const pass=pullSpaceToP2({mirror,remote:async path=>{
  if(path==='/api/viewer/manifest')return upstream.get(path);
  const q=new URL(path,'http://127.0.0.1').searchParams, key=q.get('path'), offset=Number(q.get('offset'));
  assert.equal(active.has(key),false,'chunks of the same file must not overlap');
  active.add(key);
  peak=Math.max(peak,active.size);
  assert.ok(peak<=10,'must not start an eleventh file');
  const sequence=offsets.get(key)??[];
  assert.deepEqual(sequence,offset===0?[]:[0]);sequence.push(offset);offsets.set(key,sequence);
  if(active.size===10)tenStarted();
  try{await firstWave;return await upstream.get(path);}
  finally{active.delete(key);}
 }});
 // Always settle the blocked first wave before cleaning its scratch files.
 try{
  await Promise.race([parallelReached,new Promise((_,reject)=>{
   const timer=setTimeout(()=>reject(Error('did not admit ten files')),1500);timer.unref();
  })]);
  assert.equal(active.size,10);
 }finally{release();}
 const result=await pass;
 assert.equal(peak,10);
 assert.deepEqual(result,{files:12,changed:12,removed:0,failed:0});
 for(const [path] of data){assert.deepEqual(offsets.get(path),[0,mirrorChunkBytes]);assert.deepEqual(await read(path),full);}
});
