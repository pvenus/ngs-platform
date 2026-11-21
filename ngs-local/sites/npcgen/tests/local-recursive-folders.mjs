import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import test from 'node:test';
import {createRecursiveFolderSync} from '../build/local-recursive-folders.mjs';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
import {loopbackFolderMCP} from '../build/folder-mcp-loopback.mjs';
import {createLocalProjectFolders} from '../build/local-project-folders.mjs';

const digest=b=>createHash('sha256').update(b).digest('hex');
const item=(path,bytes)=>({path,sha256:digest(bytes),size:bytes.length});
const manifest=(scope,groups,deleted=[])=>({scope,groups:Object.entries(groups).map(([folder,files])=>({folder,files})),deleted});
const project=name=>Buffer.from(JSON.stringify({name}));
const privateWrite=(path,bytes)=>{
 mkdirSync(dirname(path),{recursive:true,mode:0o700});
 writeFileSync(path,bytes,{mode:0o600});
};
function testRoot(t){
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-recursive-folders-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 return root;
}
function streamed(bytes){
 let start=0;
 return new Response(new ReadableStream({pull(stream){
  if(start>=bytes.length)return stream.close();
  stream.enqueue(bytes.subarray(start,start+=16*1024));
 }}),{headers:{'Content-Length':String(bytes.length)}});
}

test('top sends authorized descendant hashes only, applies bounded streamed changes, and isolates failure',async t=>{
 const root=testRoot(t),old=Buffer.from('old bytes'),large=Buffer.alloc(4*1024*1024,31);
 privateWrite(join(root,'binari','project.json'),project('비나리'));
 privateWrite(join(root,'binari','npcs','safe.dat'),old);
 privateWrite(join(root,'binari','.deleted','secret'),old);
 privateWrite(join(root,'binari','npcs','.DS_Store'),old);
 privateWrite(join(root,'unapproved','project.json'),project('not allowed'));
 const moment={now:100},compares=[],reads=[];
 let sourceBad=true;
 const entries=[
  item('binari/npcs/safe.dat',large),
  item('binari/npcs/새 하위/ok.bin',large),
  item('masterconcept/project.json',project('마스터')),
  item('unknown/project.json',project('unknown')),
  item('OS-metadata.txt',old),
 ];
 const pds={
  async compare(scope,files){
   compares.push({scope,files});
   const known=new Map(files.map(row=>[row.path,row.sha256]));
   const groups={};
   for(const row of entries){
    if(known.get(row.path)===row.sha256)continue;
    const folder=row.path.includes('/')?row.path.split('/')[0]:'';
    (groups[folder]??=[]).push(row);
   }
   return manifest(scope,groups);
  },
  async file(scope,path,sha){
   reads.push({scope,path,sha});
   if(path==='masterconcept/project.json')return streamed(project('마스터'));
   if(path.endsWith('safe.dat')&&sourceBad)return streamed(Buffer.alloc(large.length,77));
   return streamed(large);
  },
 };
 const projectCatalog=createLocalProjectFolders({root,now:()=>moment.now});
 const sync=createRecursiveFolderSync({root,pds,projectCatalog,readableProjects:['binari','masterconcept'],now:()=>moment.now});
 assert.deepEqual(await sync.compareTop(['binari','masterconcept']),{groups:[
  {projectId:'binari',count:2},{projectId:'masterconcept',count:1}],unavailable:[]});
 assert.deepEqual(compares[0],{scope:'',files:[
  {path:'binari/npcs/safe.dat',sha256:digest(old)},{path:'binari/project.json',sha256:digest(project('비나리'))}]});
 const results=await Promise.allSettled([sync.applyTop('binari'),sync.applyTop('masterconcept')]);
 assert.equal(results[0].status,'rejected');
 assert.equal(results[1].value.project.name,'마스터');
 assert.deepEqual(readFileSync(join(root,'binari','npcs','safe.dat')),old);
 assert.ok(!readdirSync(join(root,'binari','npcs')).some(id=>id.startsWith('.folder-download')));
 assert.equal(sync.list(id=>id==='binari')[0].refreshState,'failed');
 assert.deepEqual(sync.refreshes(()=>true),[]); // No live counter for a settled failure.
 assert.equal(sync.list(id=>id==='masterconcept')[0].needsRefresh,false);
 assert.ok(!existsSync(join(root,'unknown'))&&!existsSync(join(root,'OS-metadata.txt')));
 assert.ok(reads.every(row=>row.scope===''&&!row.path.startsWith('unknown/')));
 sourceBad=false;
 assert.deepEqual(await sync.compareTop(['binari','masterconcept']),{groups:[],unavailable:['binari']});
 assert.equal(compares.length,1);
 await assert.rejects(sync.applyTop('binari'),/FOLDER_SYNC_UNAVAILABLE/);
 moment.now=60_100;
 assert.deepEqual(await sync.compareTop(['binari']),{groups:[{projectId:'binari',count:1}],unavailable:[]});
 moment.now=64_000;
 assert.equal((await sync.applyTop('binari')).project.needsRefresh,false);
 assert.equal(readFileSync(join(root,'binari','npcs','safe.dat')).length,large.length);
 assert.deepEqual(await sync.compareTop(['binari']),{groups:[],unavailable:[]});
 assert.equal(compares.length,2);
});

test('inner scope sends only local relative hashes, applies direct and nested files, and never deletes',async t=>{
 const root=testRoot(t),scope='binari/npcs',calls=[];
 const old=Buffer.from('keep'),direct=Buffer.from('new direct'),inner=Buffer.from('new chapter');
 privateWrite(join(root,scope,'keep.bin'),old);
 privateWrite(join(root,'binari','story','dont-send.bin'),old);
 privateWrite(join(root,scope,'.deleted','hidden'),old);
 privateWrite(join(root,scope,'chapter','.deleted-previous','hidden'),old);
 const pds={
  async compare(ref,files){
   calls.push({ref,files});
   assert.equal(ref,scope);
   assert.deepEqual(files,[{path:'keep.bin',sha256:digest(old)}]);
   return manifest(ref,{'':[item('direct.bin',direct)],'chapter':[item('chapter/npc.bin',inner)]});
  },
  async file(ref,path,sha){
   assert.equal(ref,scope);
   assert.equal(sha,digest(path==='direct.bin'?direct:inner));
   return streamed(path==='direct.bin'?direct:inner);
  },
 };
 const sync=createRecursiveFolderSync({root,pds,readableProjects:['binari']});
 await assert.rejects(sync.compareInner('unapproved/npcs'),/FOLDER_SYNC_UNAVAILABLE/);
 await assert.rejects(sync.compareInner('binari/.deleted'),/FOLDER_SYNC_UNAVAILABLE/);
 await assert.rejects(sync.applyInner(scope,''),/FOLDER_SYNC_COMPARE_REQUIRED/);
 assert.deepEqual(await sync.compareInner(scope),{scope,groups:[{folder:'',count:1},{folder:'chapter',count:1}],unavailable:[]});
 await Promise.all([sync.applyInner(scope,''),sync.applyInner(scope,'chapter')]);
 assert.deepEqual(await sync.compareInner(scope),{scope,groups:[],unavailable:[]});
 assert.equal(calls.length,1);
 assert.deepEqual(readFileSync(join(root,scope,'direct.bin')),direct);
 assert.deepEqual(readFileSync(join(root,scope,'chapter','npc.bin')),inner);
 assert.deepEqual(readFileSync(join(root,scope,'keep.bin')),old);
 assert.deepEqual(readFileSync(join(root,'binari','story','dont-send.bin')),old);
});

test('actual recursive PDS MCP transfers concurrent groups within two-read capacity',{skip:!process.env.PDS_PROJECT_FOLDER_SOURCE},async t=>{
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {createInterface}=await import('node:readline');
 const work=testRoot(t),root=join(work,'replica'),canonical=join(work,'canonical-files');
 privateWrite(join(canonical,'binari','project.json'),project('Actual PDS'));
 privateWrite(join(canonical,'binari','npcs','north','model.dat'),Buffer.alloc(2*1024*1024,22));
 privateWrite(join(canonical,'binari','npcs','east','second.dat'),Buffer.from('third file'));
 privateWrite(join(canonical,'masterconcept','project.json'),project('Other PDS group'));
 privateWrite(join(canonical,'masterconcept','files','fourth.dat'),Buffer.from('separate group'));
 privateWrite(join(canonical,'binari','npcs','.deleted','secret'),Buffer.from('never'));
 privateWrite(join(canonical,'binari','npcs','north','.deleted-previous','hidden'),Buffer.from('never'));
 const server=spawn('python3',['-B','-u','-c',`
import sys,time
from project_data_service import recursive_folders
from http.server import ThreadingHTTPServer
from project_data_service.http_server import Handler
from project_data_service.project_folders import configured
original=recursive_folders.fetch_chunk
def overlap(*args):
    # Force concurrent server threads to contend while holding the real PDS gate.
    time.sleep(.04)
    return original(*args)
recursive_folders.fetch_chunk=overlap
with ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
    server.project_folders=configured(sys.argv[1],'127.0.0.1',validate_mount=False)
    print(server.server_port,flush=True)
    server.serve_forever()
`,canonical],{cwd:join(process.env.PDS_PROJECT_FOLDER_SOURCE,'data-service'),stdio:['ignore','pipe','inherit']});
 const done=once(server,'close');
 t.after(async()=>{server.kill();await done;});
 const output=createInterface({input:server.stdout});
 const [port]=await Promise.race([once(output,'line'),done.then(()=>{throw Error('PDS fixture exited');})]);
 output.close();
 const projectCatalog=createLocalProjectFolders({root});
 const pds=createFolderMcpClient({call:loopbackFolderMCP('http://127.0.0.1:'+port+'/mcp')});
 const sync=createRecursiveFolderSync({root,pds,projectCatalog,readableProjects:['binari','masterconcept']});
 assert.deepEqual(await sync.compareTop(['binari','masterconcept']),{groups:[
  {projectId:'binari',count:3},{projectId:'masterconcept',count:2}],unavailable:[]});
 const [first,second]=await Promise.all([sync.applyTop('binari'),sync.applyTop('masterconcept')]);
 assert.equal(first.project.name,'Actual PDS');
 assert.equal(second.project.name,'Other PDS group');
 assert.ok(sync.list(()=>true).every(row=>!row.refreshState));
 assert.equal(existsSync(join(root,'binari','npcs','.deleted')),false);
 assert.equal(existsSync(join(root,'binari','npcs','north','.deleted-previous')),false);
 assert.equal(readFileSync(join(root,'binari','npcs','north','model.dat')).length,2*1024*1024);
 assert.deepEqual(await sync.compareInner('binari/npcs'),{scope:'binari/npcs',groups:[],unavailable:[]});
 const missingScope='binari/npcs/missing';
 const missingLocal=join(root,missingScope,'past.bin');
 privateWrite(missingLocal,Buffer.from('recoverable local data'));
 assert.deepEqual(await sync.compareInner(missingScope),{scope:missingScope,groups:[{folder:'',count:1}],unavailable:[]});
 assert.equal((await sync.applyInner(missingScope,'')).status,'refreshed');
 assert.equal(existsSync(missingLocal),false);
 const trash=join(root,'.deleted-sync'),[entry]=readdirSync(trash);
 assert.equal(readFileSync(join(trash,entry,'content'),'utf8'),'recoverable local data');
});

test('selecting one NPC recursively refreshes that literal subtree, never its tab or sibling',async t=>{
 const root=testRoot(t),scope='binari/npcs/character.seojin',sibling='binari/npcs/character.dajeong';
 const prior=Buffer.from('known'),neighbor=Buffer.from('unchanged sibling'),next=Buffer.from('seojin replacement');
 privateWrite(join(root,scope,'identity.json'),prior);
 privateWrite(join(root,sibling,'identity.json'),neighbor);
 const calls=[];
 const pds={
  async compare(actual,files){
   calls.push(actual);
   assert.equal(actual,scope);
   assert.deepEqual(files,[{path:'identity.json',sha256:digest(prior)}]);
   return manifest(scope,{portraits:[item('portraits/new.png',next)]});
  },
  async file(actual,path){
   assert.equal(actual,scope);
   assert.equal(path,'portraits/new.png');
   return streamed(next);
  },
 };
 const sync=createRecursiveFolderSync({root,pds,readableProjects:['binari']});
 assert.deepEqual(await sync.compareInner(scope),{scope,groups:[{folder:'portraits',count:1}],unavailable:[]});
 await sync.applyInner(scope,'portraits');
 assert.deepEqual(await sync.compareInner(scope),{scope,groups:[],unavailable:[]});
 assert.deepEqual(calls,[scope]);
 assert.deepEqual(readFileSync(join(root,scope,'portraits','new.png')),next);
 assert.deepEqual(readFileSync(join(root,sibling,'identity.json')),neighbor);
 assert.equal(existsSync(join(root,sibling,'portraits')),false);
});

test('shared compare and transfer remain one admission past TTL; fresh time bases start on admission',async t=>{
 const root=testRoot(t),next=Buffer.from('ready'),name='binari/npcs/news.txt';
 privateWrite(join(root,'binari','project.json'),project('비나리'));
 const time={now:1_000},counts={compare:0,download:0};
 let compareEntered,compareGo,transferEntered,transferGo;
 const started=new Promise(ok=>{compareEntered=ok;});
 const compared=new Promise(ok=>{compareGo=ok;});
 const transferring=new Promise(ok=>{transferEntered=ok;});
 const transferred=new Promise(ok=>{transferGo=ok;});
 const pds={
  async compare(scope,files){
   counts.compare++;
   if(counts.compare===1){
    compareEntered();
    await compared;
    return manifest(scope,{binari:[item(name,next)]});
   }
   assert.ok(files.some(row=>row.path===name&&row.sha256===digest(next)));
   return manifest(scope,{});
  },
  async file(){counts.download++;transferEntered();await transferred;return streamed(next);},
 };
 const projectCatalog=createLocalProjectFolders({root,diskFreshness:false});
 const sync=createRecursiveFolderSync({root,pds,projectCatalog,readableProjects:['binari'],now:()=>time.now});
 const first=sync.compareTop(['binari']);
 await started;
 time.now=62_000;
 assert.deepEqual(sync.list(()=>true).map(({needsRefresh,refreshState})=>[needsRefresh,refreshState]),[[false,'refreshing']]);
 const second=sync.compareTop(['binari']);
 assert.equal(counts.compare,1);
 compareGo();
 const expected={groups:[{projectId:'binari',count:1}],unavailable:[]};
 assert.deepEqual(await first,expected);
 assert.deepEqual(await second,expected);
 const applyOne=sync.applyTop('binari');
 await transferring;
 time.now=125_000;
 assert.deepEqual(await sync.compareTop(['binari']),expected);
 const applyTwo=sync.applyTop('binari');
 transferGo();
 assert.equal((await applyOne).status,'refreshed');
 assert.equal((await applyTwo).status,'refreshed');
 assert.deepEqual(counts,{compare:1,download:1});
 assert.equal(sync.list(()=>true)[0].needsRefresh,true,'TTL is measured from admission, not completion');
 assert.deepEqual(await sync.compareTop(['binari']),{groups:[],unavailable:[]});
 assert.deepEqual(counts,{compare:2,download:1});
});

test('typed upper, tab and item admissions are independent; root result does not admit siblings',async t=>{
 const root=testRoot(t),calls=[],time={now:10_000};
 for(const id of ['binari','masterconcept'])privateWrite(join(root,id,'project.json'),project(id));
 const projectCatalog=createLocalProjectFolders({root,diskFreshness:false});
 const pds={async compare(scope){calls.push(scope);return manifest(scope,{});}};
 const sync=createRecursiveFolderSync({root,pds,projectCatalog,now:()=>time.now,readableProjects:['binari','masterconcept']});
 const tab='binari/npcs',item='binari/npcs/character.seojin';
 await sync.compareTop(['binari']);
 assert.equal(sync.list(id=>id==='masterconcept')[0].needsRefresh,true);
 await assert.rejects(sync.applyTop('masterconcept'),/FOLDER_SYNC_COMPARE_REQUIRED/);
 await sync.compareInner(tab);
 await sync.compareInner(item);
 await sync.compareInner(tab);
 await sync.compareInner(item);
 assert.deepEqual(calls,['',tab,item]);
 time.now=69_999;
 await sync.compareTop(['binari']);
 assert.deepEqual(calls,['',tab,item]);
 await sync.compareTop(['masterconcept']);
 assert.deepEqual(calls,['',tab,item,'']);
 time.now=70_000;
 await sync.compareTop(['binari','masterconcept']);
 assert.deepEqual(calls,['',tab,item,'','']);
 assert.ok(sync.list(()=>true).every(row=>!row.needsRefresh));
});

test('old disk stamps are not read or changed, restart resets cooldown and preserves local copies',async t=>{
 const root=testRoot(t),scope='binari/npcs',time={now:100},calls=[];
 privateWrite(join(root,'binari','project.json'),project('비나리'));
 const oldStamp=join(root,'binari','.last-refresh');
 privateWrite(oldStamp,'100');
 privateWrite(join(root,scope,'.folder-refresh-'+digest('')),'100');
 const projectCatalog=createLocalProjectFolders({root,diskFreshness:false});
 const pds={async compare(ref){
  calls.push(ref);
  if(ref===scope)throw Error('PDS unavailable');
  return manifest(ref,{});
 }};
 const create=()=>createRecursiveFolderSync({root,pds,projectCatalog,now:()=>time.now,readableProjects:['binari']});
 let sync=create();
 assert.equal(sync.list(()=>true)[0].needsRefresh,true);
 await sync.compareTop(['binari']);
 await assert.rejects(sync.compareInner(scope),/PDS unavailable/);
 time.now=60_099;
 await assert.rejects(sync.compareInner(scope),/PDS unavailable/);
 assert.deepEqual(calls,['',scope]);
 time.now=60_100;
 await assert.rejects(sync.compareInner(scope),/PDS unavailable/);
 assert.deepEqual(calls,['',scope,scope]);
 await sync.compareTop(['binari']);
 assert.equal(sync.list(()=>true)[0].needsRefresh,false);
 sync=create();
 assert.equal(sync.list(()=>true)[0].needsRefresh,true);
 await sync.compareTop(['binari']);
 assert.deepEqual(calls,['',scope,scope,'','']);
 assert.equal(readFileSync(oldStamp,'utf8'),'100');
 assert.deepEqual(readFileSync(join(root,'binari','project.json')),project('비나리'));
});

test('MCP file DTO advances one bounded chunk per pull and rejects incorrect lineage or lengths',async()=>{
 const bytes=Buffer.alloc(2*1024*1024+13,3),scope='binari/npcs',path='test.dat',sha256=digest(bytes),calls=[];
 let revoked=false;
 const file=createFolderMcpClient({call:async(name,args)=>{
  assert.equal(name,'npc_folder_file_chunk');
  calls.push(args.offset);
  const content=bytes.subarray(args.offset,args.offset+1024*1024),after=args.offset+content.length;
  return {...args,path:revoked?'wrong.dat':path,size:bytes.length,base64:content.toString('base64'),
   nextOffset:after===bytes.length?null:after};
 }});
 const token=file.file(scope,path,sha256,bytes.length);
 assert.equal(token.headers.get('content-length'),String(bytes.length));
 assert.deepEqual(calls,[]);
 const reader=token.body.getReader();
 assert.equal((await reader.read()).value.length,1024*1024);
 assert.deepEqual(calls,[0]);
 assert.equal((await reader.read()).value.length,1024*1024);
 assert.equal((await reader.read()).value.length,13);
 assert.equal((await reader.read()).done,true);
 assert.deepEqual(calls,[0,1024*1024,2*1024*1024]);
 revoked=true;
 await assert.rejects(file.file(scope,path,sha256,bytes.length).body.getReader().read(),/FOLDER_MCP_UNAVAILABLE/);
});


function tombstones(files){return files.map(({path,sha256})=>({path,sha256}));}
test('deletion-only group revalidates once and moves every exact cache file to hidden, recoverable entries',async t=>{
 const root=testRoot(t),scope='binari/npcs/exact',calls=[];
 const victims={'portraits/old.png':Buffer.from('first'),'portraits/deep/old.png':Buffer.from('second')};
 for(const [path,data] of Object.entries(victims))privateWrite(join(root,scope,path),data);
 privateWrite(join(root,scope,'other','untouched'),Buffer.from('preserve'));
 const pds={compare(actual,files,options){
  assert.equal(actual,scope);assert.deepEqual(options,{includeDeleted:true});calls.push(files);
  return manifest(scope,{},tombstones(files.filter(row=>Object.hasOwn(victims,row.path))));
 },file(){assert.fail('deletion-only group never fetches chunks');}};
 const create=()=>createRecursiveFolderSync({root,pds,projectCatalog:createLocalProjectFolders({root}),readableProjects:['binari']});
 const sync=create();
 assert.deepEqual(await sync.compareInner(scope),{scope,groups:[{folder:'portraits',count:2}],unavailable:[]});
 const [first,second]=await Promise.all([sync.applyInner(scope,'portraits'),sync.applyInner(scope,'portraits')]);
 assert.equal(first.status,'refreshed');assert.equal(second.status,'refreshed');
 assert.equal((await sync.applyInner(scope,'portraits')).status,'cached');
 assert.equal(calls.length,2);assert.deepEqual(calls[1],calls[0].filter(row=>Object.hasOwn(victims,row.path)));
 const trash=join(root,'.deleted-sync');
 assert.equal(lstatSync(trash).mode&0o777,0o700);
 assert.equal(readdirSync(trash).length,2);
 for(const e of readdirSync(trash)){
  const entry=join(trash,e),receipt=join(entry,'receipt.json');
  assert.equal(lstatSync(entry).mode&0o777,0o700);
  assert.equal(lstatSync(receipt).mode&0o777,0o600);
  const data=JSON.parse(readFileSync(receipt,'utf8'));
  const expected=victims[data.relativePath.slice(scope.length+1)];
  assert.equal(data.sha256,digest(expected));assert.deepEqual(readFileSync(join(entry,'content')),expected);
  assert.equal(existsSync(join(root,data.relativePath)),false);
 }
 assert.equal(readFileSync(join(root,scope,'other','untouched'),'utf8'),'preserve');
 await create().compareInner(scope);
 assert.deepEqual(calls[2].map(row=>row.path),['other/untouched']);
});

for(const problem of ['restored remote','transport down','changed cache','unsafe trash','forged SHA','unlisted','duplicate','overlap','path escape'])
test('deletion keeps local bytes under '+problem,async t=>{
 const root=testRoot(t),scope='binari/npcs',victim=join(root,scope,'victim.bin'),old=Buffer.from('keep until proven');
 privateWrite(victim,old);
 let calls=0,expected=old;
 const pds={compare(actual,files){
  assert.equal(actual,scope);calls++;
  const row={path:'victim.bin',sha256:digest(old)};
  if(calls===1){
   if(problem==='forged SHA')return manifest(scope,{},[{...row,sha256:'f'.repeat(64)}]);
   if(problem==='unlisted')return manifest(scope,{},[{...row,path:'other'}]);
   if(problem==='duplicate')return manifest(scope,{},[row,row]);
   if(problem==='overlap')return manifest(scope,{'':[item(row.path,Buffer.from('remote'))]},[row]);
   if(problem==='path escape')return manifest(scope,{},[{...row,path:'../victim.bin'}]);
   return manifest(scope,{},[row]);
  }
  assert.deepEqual(files,[row]);
  if(problem==='transport down')throw Error('PDS unavailable');
  if(problem==='restored remote')return manifest(scope,{});
  return manifest(scope,{},[row]);
 },file(){assert.fail('no download staged');}};
 const sync=createRecursiveFolderSync({root,pds,projectCatalog:createLocalProjectFolders({root}),readableProjects:['binari']});
 if(['forged SHA','unlisted','duplicate','overlap','path escape'].includes(problem)){
  await assert.rejects(sync.compareInner(scope),/FOLDER_SYNC_UNAVAILABLE/);assert.equal(calls,1);
 }else{
  await sync.compareInner(scope);
  if(problem==='changed cache'){expected=Buffer.from('local edits');privateWrite(victim,expected);}
  if(problem==='unsafe trash'){mkdirSync(join(root,'other'),{mode:0o700});symlinkSync(join(root,'other'),join(root,'.deleted-sync'));}
  await assert.rejects(sync.applyInner(scope,''));assert.equal(calls,2);
 }
 assert.deepEqual(readFileSync(victim),expected);
 assert.equal(problem==='unsafe trash'?readdirSync(join(root,'other')).length:Number(existsSync(join(root,'.deleted-sync'))),0);
});

test('confirmed header tombstone removes only its upper card, not unrelated allowlist files',async t=>{
 const root=testRoot(t),calls=[];
 for(const id of ['binari','masterconcept'])privateWrite(join(root,id,'project.json'),project(id));
 privateWrite(join(root,'binari','keep.bin'),'unrelated project file');
 const pds={compare(scope,files,options){
  assert.equal(scope,'');assert.deepEqual(options,{includeDeleted:true});calls.push(files);
  return manifest(scope,{},tombstones(files.filter(row=>row.path==='binari/project.json')));
 }};
 const sync=createRecursiveFolderSync({root,pds,projectCatalog:createLocalProjectFolders({root}),readableProjects:['binari','masterconcept']});
 assert.deepEqual(await sync.compareTop(['binari','masterconcept']),{groups:[{projectId:'binari',count:1}],unavailable:[]});
 assert.deepEqual(await sync.applyTop('binari'),{projectId:'binari',status:'removed',project:null});
 assert.deepEqual(await sync.applyTop('binari'),{projectId:'binari',status:'removed',project:null});
 assert.equal(sync.list(()=>true)[0].projectId,'masterconcept');
 assert.equal(readFileSync(join(root,'binari','keep.bin'),'utf8'),'unrelated project file');
 assert.deepEqual(calls[1],[{path:'binari/project.json',sha256:digest(project('binari'))}]);
});
