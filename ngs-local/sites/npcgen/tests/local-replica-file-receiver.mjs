import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalFileSyncReceiver,localFileSyncReceiverFromEnv} from '../build/local-replica-file-receiver.mjs';
import {createLocalRequestQueueMcp} from '../build/local-request-queue-mcp.mjs';
import {loopbackJsonMCP} from '../build/folder-mcp-loopback.mjs';

const hash=x=>createHash('sha256').update(x).digest('hex');
const prefix='ngs_file_sync_';
const ops=(call)=>Object.fromEntries(['begin','file_chunk','remove','finish','abort'].map(op=>[op,args=>call(prefix+op,args)]));
const file=(receipt,path,source)=>({syncId:receipt.syncId,path,sha256:hash(source),size:source.length});
const chunk=(bound,bytes,offset=0)=>({...bound,offset,dataBase64:bytes.toString('base64')});
const small=Buffer.from('replica change'),before=Buffer.from('previous fixture');
function fixture(t){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'local-replica-receive-'));
 const project=join(root,'binari');
 mkdirSync(project,{mode:0o700});mkdirSync(join(project,'.deleted'),{mode:0o700});
 for(const path of ['keep.txt','.deleted/retained.txt'])writeFileSync(join(project,path),before,{mode:0o600});
 let now=1_000;
 const receiver=createLocalFileSyncReceiver({root,projects:['binari','other'],now:()=>now,wall:()=>77});
 t.after(()=>{receiver.close();rmSync(root,{recursive:true,force:true});});
 return {root,project,receiver,...ops((name,args)=>receiver.call(name,args)),setNow:value=>{now=value;}};
}
test('live fresh scoped inventory, ordered verified chunks, exact no-op and serial scopes without inter-project delay',async t=>{
 const f=fixture(t),receipt=await f.begin({scope:'binari'});
 assert.deepEqual({...receipt,syncId:''},{syncId:'',scope:'binari',inventoryAt:77,files:[{path:'keep.txt',sha256:hash(before)}]});
 assert.match(receipt.syncId,/^ngs\.sync\.[0-9a-f-]{36}$/u);
 await assert.rejects(f.begin({scope:'other'}),{status:409});
 await assert.rejects(f.file_chunk(chunk(file(receipt,'.deleted/retained.txt',small),small)),{status:400});
 await assert.rejects(f.file_chunk(chunk(file(receipt,'../other/keep.txt',small),small)),{status:400});
 const body=Buffer.concat([Buffer.alloc(1024*1024,65),small]),bound=file(receipt,'deep/new.txt',body);
 assert.deepEqual(await f.file_chunk(chunk(bound,body.subarray(0,1024*1024))),{nextOffset:1024*1024});
 await assert.rejects(f.finish({syncId:receipt.syncId}),{status:409});
 assert.equal(existsSync(join(f.project,'deep')),false);
 assert.deepEqual(await f.file_chunk(chunk(bound,small,1024*1024)),{nextOffset:null});
 assert.deepEqual(readFileSync(join(f.project,'deep/new.txt')),body);
 const pin=statSync(join(f.project,'deep/new.txt'),{bigint:true});
 assert.deepEqual(await f.file_chunk(chunk(bound,body.subarray(0,1024*1024))),{nextOffset:1024*1024});
 assert.deepEqual(await f.file_chunk(chunk(bound,small,1024*1024)),{nextOffset:null});
 assert.equal(statSync(join(f.project,'deep/new.txt'),{bigint:true}).ino,pin.ino);
 assert.deepEqual(await f.finish({syncId:receipt.syncId}),{ok:true,written:1});
 const other=await f.begin({scope:'other'});
 assert.deepEqual(other.files,[]);
 assert.deepEqual(await f.abort({syncId:other.syncId}),{ok:true});
 const next=await f.begin({scope:'binari'});
 assert.deepEqual(next.files,[{path:'deep/new.txt',sha256:hash(body)},{path:'keep.txt',sha256:hash(before)}]);
 f.setNow(121_001);
 await assert.rejects(f.finish({syncId:next.syncId}),{status:409});
 assert.deepEqual(readFileSync(join(f.project,'.deleted/retained.txt')),before);
});
test('local path/content drift, symlink, malformed chunk or wrong hash never writes visible bytes',async t=>{
 const f=fixture(t),receipt=await f.begin({scope:'binari'});
 const fresh=join(f.project,'fresh.txt');
 const bound=file(receipt,'fresh.txt',small);
 await assert.rejects(f.file_chunk(chunk(bound,small.subarray(4),4)),{status:409});
 await assert.rejects(f.file_chunk({...chunk(bound,small),dataBase64:'!'}),{status:400});
 assert.deepEqual(await f.file_chunk(chunk(bound,small.subarray(0,4))),{nextOffset:4});
 writeFileSync(fresh,before,{mode:0o600});
 await assert.rejects(f.file_chunk(chunk(bound,small.subarray(4),4)),{status:409});
 assert.deepEqual(readFileSync(fresh),before);
 const forged=file(receipt,'keep.txt',small);
 await assert.rejects(f.file_chunk({...chunk(forged,small),sha256:'0'.repeat(64)}),{status:409});
 assert.deepEqual(readFileSync(join(f.project,'keep.txt')),before);
 symlinkSync(fresh,join(f.project,'bad'));
 await assert.rejects(f.file_chunk(chunk(file(receipt,'bad',small),small)));
 await assert.rejects(f.file_chunk(chunk(file(receipt,'project.json',small),small)));
 assert.equal(existsSync(join(f.project,'project.json')),false);
 assert.deepEqual(await f.finish({syncId:receipt.syncId}),{ok:true,written:0});
 assert.deepEqual(readdirSync(join(f.root,'.file-sync-stage')),[]);
});
test('one prior replica file moves recoverably; exact replay and fresh inventory are safe',async t=>{
 const f=fixture(t),receipt=await f.begin({scope:'binari'});
 const target={syncId:receipt.syncId,path:'keep.txt',sha256:hash(before)};
 await assert.rejects(f.remove({...target,sha256:'0'.repeat(64)}),{status:409});
 await assert.rejects(f.remove({...target,path:'.deleted/retained.txt'}),{status:400});
 await assert.rejects(f.remove({...target,path:'../other/keep.txt'}),{status:400});
 await assert.rejects(f.remove({...target,path:'unseen.txt'}),{status:409});
 assert.deepEqual(await f.remove(target),{removed:true});
 assert.equal(existsSync(join(f.project,'keep.txt')),false);
 assert.deepEqual(await f.remove(target),{removed:false});
 await assert.rejects(f.file_chunk(chunk(file(receipt,'keep.txt',small),small)),{status:409});
 const trash=join(f.root,'.deleted-sync'),[name]=readdirSync(trash);
 assert.match(name,/^entry-/);
 assert.deepEqual(readFileSync(join(trash,name,'content')),before);
 assert.deepEqual(JSON.parse(readFileSync(join(trash,name,'receipt.json'))),{
  relativePath:'binari/keep.txt',sha256:hash(before),
 });
 assert.deepEqual(await f.finish({syncId:receipt.syncId}),{ok:true,written:0});
 const round=await f.begin({scope:'binari'});
 assert.deepEqual(round.files,[]);
 assert.deepEqual(readFileSync(join(f.project,'.deleted/retained.txt')),before);
});

test('incoming file overlaps, new local bytes, and resurrected paths cannot be removed',async t=>{
 const f=fixture(t),receipt=await f.begin({scope:'binari'});
 const bind={syncId:receipt.syncId,path:'keep.txt',sha256:hash(before)};
 writeFileSync(join(f.project,'keep.txt'),small);
 await assert.rejects(f.remove(bind),{status:409});
 writeFileSync(join(f.project,'keep.txt'),before);
 const exact=file(receipt,'keep.txt',small);
 await f.file_chunk(chunk(exact,small.subarray(0,5)));
 await assert.rejects(f.remove(bind),{status:409});
 await f.file_chunk(chunk(exact,small.subarray(5),5));
 await assert.rejects(f.remove({...bind,sha256:hash(small)}),{status:409});
 assert.deepEqual(await f.finish({syncId:receipt.syncId}),{ok:true,written:1});
 const second=await f.begin({scope:'binari'});
 const changedBind={...bind,syncId:second.syncId,sha256:hash(small)};
 assert.deepEqual(await f.remove(changedBind),{removed:true});
 writeFileSync(join(f.project,'keep.txt'),before,{mode:0o600});
 await assert.rejects(f.remove(changedBind),{status:409});
 assert.deepEqual(readFileSync(join(f.project,'keep.txt')),before);
});

test('opt-in extends only exact file MCP; default and non-file JSON limit stay intact',async t=>{
 const f=fixture(t);
 assert.equal(localFileSyncReceiverFromEnv({}),undefined);
 assert.throws(()=>localFileSyncReceiverFromEnv({NGS_FILE_SYNC_MODE:'push',NGS_FILE_SYNC_PROJECTS:'neighbor',NGS_PROJECT_CATALOG_ROOT:f.root}));
 const modeReceiver=localFileSyncReceiverFromEnv({NGS_FILE_SYNC_MODE:'push',NGS_FILE_SYNC_PROJECTS:'binari',
  NGS_PROJECT_CATALOG_ROOT:f.root});
 modeReceiver.close();
 const server=createLocalRequestQueueMcp({list:()=>({requests:[]})},{fileSync:f.receiver});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(()=>new Promise(ok=>server.close(ok)));
 const endpoint='http://127.0.0.1:'+server.address().port+'/mcp',call=loopbackJsonMCP(endpoint);
 const boundOps=ops(call),receipt=await boundOps.begin({scope:'binari'});
 const args=chunk(file(receipt,'large.txt',Buffer.alloc(1024*1024,88)),Buffer.alloc(1024*1024,88));
 assert.deepEqual(await boundOps.file_chunk(args),{nextOffset:null});
 assert.deepEqual(await boundOps.remove({syncId:receipt.syncId,path:'keep.txt',sha256:hash(before)}),{removed:true});
 assert.deepEqual(await boundOps.finish({syncId:receipt.syncId}),{ok:true,written:1});
 assert.deepEqual(await call('ngs_request_queue_list',{}),{requests:[]});
 const request=(name,arguments_,headers={})=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',...headers},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:arguments_}})});
 assert.equal((await request('ngs_request_queue_list',{padding:'b'.repeat(10_000)})).status,413);
 assert.equal((await request(prefix+'begin',{scope:'binari'},{Origin:'http://127.0.0.1:5274'})).status,403);
 assert.equal((await request(prefix+'begin',{scope:'binari'},{'X-Forwarded-For':'127.0.0.1'})).status,403);
});

test('bounded streaming sync accepts a file over 64 MiB, hides partial bytes and re-inventories exact SHA',async t=>{
 const f=fixture(t),receipt=await f.begin({scope:'binari'}),piece=Buffer.alloc(1024*1024,72),last=Buffer.from('large');
 const digest=createHash('sha256');
 for(let i=0;i<64;i++)digest.update(piece);
 const sha256=digest.update(last).digest('hex');
 const path='large.bin',size=64*piece.length+last.length,bound={syncId:receipt.syncId,path,size,sha256};
 for(let i=0;i<64;i++)assert.deepEqual(await f.file_chunk(chunk(bound,piece,i*piece.length)),{nextOffset:(i+1)*piece.length});
 assert.equal(existsSync(join(f.project,path)),false);
 assert.deepEqual(await f.file_chunk(chunk(bound,last,64*piece.length)),{nextOffset:null});
 assert.equal(statSync(join(f.project,path)).size,size);
 assert.deepEqual(await f.finish({syncId:receipt.syncId}),{ok:true,written:1});
 assert.deepEqual((await f.begin({scope:'binari'})).files.find(x=>x.path===path),{path,sha256});
});
