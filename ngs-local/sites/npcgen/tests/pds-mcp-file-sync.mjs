import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
import {createLoopbackFileUpload} from '../build/file-sync-raw-client.mjs';
import {pushProjectFiles,pushSpaceProjectFiles,shareFileTransferSlot,sharePdsChunkSlots,sharePdsCompareSlot,watchPdsMcpFileSync} from '../build/pds-mcp-file-sync.mjs';

const id='ngs.sync.6f56d34f-62ca-42a7-a173-14700d922865',scope='binari',MiB=1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const receipt=(scope,files=[])=>({syncId:id,scope,inventoryAt:1,files});
const row=(path,bytes)=>({path,sha256:sha(bytes),size:bytes.length});
const stagedBody=async f=>Buffer.from(await new Response(f()).arrayBuffer());
const stream=bytes=>{let offset=0;return {body:new ReadableStream({pull(c){
 if(offset===bytes.length){c.close();return;}
 c.enqueue(bytes.subarray(offset,offset+MiB));offset+=Math.min(MiB,bytes.length-offset);
}})};};
const fakePDS=(pairs,deleted=[])=>({
 compare:async(_scope,files)=>({scope,groups:files.length?[]:[{folder:'',files:pairs.map(([p,b])=>row(p,b))}],deleted}),
 file:(_scope,path)=>stream(pairs.find(([p])=>p===path)[1]),
});

test('real Local HTTP uses a single binary fixed-length request for 0, 19.2 MiB and 65 MiB files',async t=>{
 const sizes=[0,Math.round(19.2*MiB),65*MiB],paths=['empty','이름.bin','large'],pattern=Buffer.alloc(MiB,17);
 const sourceReads=[],requests=[],controls=[];
 const rows=sizes.map((size,i)=>{
  const hash=createHash('sha256');for(let at=0;at<size;at+=MiB)hash.update(pattern.subarray(0,Math.min(MiB,size-at)));
  return {path:paths[i],sha256:hash.digest('hex'),size};
 });
 const pds=createFolderMcpClient({call:async(name,args)=>{
  if(name==='npc_folders_compare')return {scope,groups:[{folder:'',files:rows}],deleted:[]};
  assert.equal(name,'npc_folder_file_chunk');const file=rows.find(r=>r.path===args.path);
  const bytes=pattern.subarray(0,Math.min(MiB,file.size-args.offset));
  const end=args.offset+bytes.length;sourceReads.push([args.path,args.offset]);
  return {...args,size:file.size,base64:bytes.toString('base64'),nextOffset:end===file.size?null:end};
 }});
 const server=createServer(async(req,res)=>{
  const hash=createHash('sha256');let length=0;
  for await(const chunk of req){length+=chunk.length;hash.update(chunk);}
  requests.push({method:req.method,url:req.url,id:req.headers['x-ngs-sync-id'],size:req.headers['content-length'],
   path:Buffer.from(req.headers['x-ngs-file-path'],'base64url').toString('utf8'),declared:req.headers['x-ngs-file-sha256'],
   calculated:hash.digest('hex'),length,type:req.headers['content-type'],transfer:req.headers['transfer-encoding']});
  res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 const upload=createLoopbackFileUpload('http://127.0.0.1:'+server.address().port+'/mcp');
 const ngs=async(name,input)=>{controls.push([name,input]);if(name==='ngs_file_sync_begin')return receipt(scope);
  return name==='ngs_file_sync_finish'?{ok:true,written:3}:{ok:true};};
 assert.deepEqual(await pushProjectFiles({scope,pds,ngs,upload}),{ok:true,written:3,failed:0});
 assert.equal(sourceReads.length,86); // PDS read contract only: 1 + 20 + 65.
 assert.deepEqual(controls.map(x=>x[0]),['ngs_file_sync_begin','ngs_file_sync_plan','ngs_file_sync_finish']);
 assert.deepEqual(controls[1][1],{syncId:id,totalFiles:3});
 assert.deepEqual(requests,rows.map(r=>({method:'POST',url:'/api/ngs-file-sync-file',id,size:String(r.size),path:r.path,
  declared:r.sha256,calculated:r.sha256,length:r.size,type:'application/octet-stream',transfer:undefined})));
});

test('only verified data opens an upload; corrupt file is settled without network body, next file continues',async()=>{
 const bytes=Buffer.from('valid'),rows=[row('bad',bytes),row('next',bytes)],calls=[],uploads=[];
 const pds={compare:async()=>({scope,groups:[{folder:'',files:rows}],deleted:[]}),
  file:(_scope,path)=>stream(path==='bad'?Buffer.from('wrong'):bytes)};
 const ngs=async(name,args)=>{calls.push([name,args]);if(name==='ngs_file_sync_begin')return receipt(scope);
  return name==='ngs_file_sync_finish'?{ok:true,written:1}:{ok:true};};
 const upload=async(meta,f)=>{uploads.push(meta.path);assert.deepEqual(await stagedBody(f),bytes);return {ok:true};};
 assert.deepEqual(await pushProjectFiles({scope,pds,ngs,upload}),{ok:true,written:1,failed:1});
 assert.deepEqual(uploads,['next']);
 assert.deepEqual(calls.filter(x=>x[0].endsWith('file_failed')).map(x=>x[1]),[{syncId:id,path:'bad'}]);
});

test('one shared FIFO across Local and Space; no second file or duplicate part request while upload waits',async()=>{
 const fileSlot=shareFileTransferSlot(),bytes=Buffer.alloc(MiB+1,5),events=[];
 const first=Promise.withResolvers(),wait=Promise.withResolvers(),spacePlanned=Promise.withResolvers();
 const pds=fakePDS([['one',bytes],['two',bytes]]);
 const endpoint=label=>({
  ngs:async(name,args)=>{
   if(name==='ngs_file_sync_begin')return receipt(scope);
   if(name==='ngs_file_sync_plan'){assert.deepEqual(args,{syncId:id,totalFiles:2});if(label==='space')spacePlanned.resolve();return {ok:true};}
   assert.equal(name,'ngs_file_sync_finish');return {ok:true,written:2};
  },
  upload:async(meta,f)=>{
   events.push([label,meta.path]);
   if(label==='local'&&meta.path==='one'){first.resolve();await wait.promise;}
   assert.deepEqual(await stagedBody(f),bytes);
   return {ok:true};
  },
 });
 const local=pushProjectFiles({scope,pds,...endpoint('local'),fileSlot});
 await first.promise;
 const space=pushSpaceProjectFiles({scope,pds,...endpoint('space'),fileSlot});
 await spacePlanned.promise;await new Promise(setImmediate);
 assert.deepEqual(events,[['local','one']]);wait.resolve();
 assert.deepEqual(await Promise.all([local,space]),Array(2).fill({ok:true,written:2,failed:0}));
 assert.deepEqual(events,[['local','one'],['space','one'],['local','two'],['space','two']]);
});

test('whole-file exact retry; only definite failure settles, uncertain final aborts without tombstones',async()=>{
 const bytes=Buffer.alloc(MiB+1,8),stale={path:'old',sha256:sha('old')},calls=[];
 const pds={
  compare:async(_scope,files)=>({scope,groups:files===selection?[]:[{folder:'',files:[row('new',bytes)]}],deleted:[stale]}),
  file:()=>stream(bytes),
 };
 // Reconfirm receives the new array built by changes(), while the initial
 // fixture inventory is identified via begin below.
 const selection=[stale];
 for(const caseName of ['success-on-retry','definite','unknown']){
  calls.length=0;let uploads=0,compares=0;
  pds.compare=async()=>({scope,groups:compares++===0?[{folder:'',files:[row('new',bytes)]}]:[],deleted:[stale]});
  const ngs=async(name,args)=>{calls.push(name);if(name==='ngs_file_sync_begin')return receipt(scope,selection);
   if(name==='ngs_file_sync_finish')return {ok:true,written:Number(caseName==='success-on-retry')};
   if(name==='ngs_file_sync_remove')return {removed:true};
   assert.deepEqual(args,name==='ngs_file_sync_plan'?{syncId:id,totalFiles:1}:name.endsWith('abort')?{syncId:id}:{syncId:id,path:'new'});return {ok:true};};
  const upload=async(meta,f)=>{
   uploads++;assert.deepEqual(await stagedBody(f),bytes);assert.deepEqual(meta,{syncId:id,...row('new',bytes)});
   if(caseName==='success-on-retry'&&uploads===2)return {ok:true};
   const e=Error(caseName==='definite'?'NGS_FILE_SYNC_CONTENT_MISMATCH':'NGS_SPACE_FILE_UPLOAD_UNAVAILABLE');
   if(caseName==='definite')e.definite=true;throw e;
  };
  const run=pushSpaceProjectFiles({scope,pds,ngs,upload});
  if(caseName==='unknown')await assert.rejects(run,/NGS_FILE_SYNC_FILE_ACK_UNRESOLVED/);
  else assert.deepEqual(await run,{ok:true,written:Number(caseName==='success-on-retry'),failed:Number(caseName==='definite')});
  assert.equal(uploads,2);
  assert.equal(calls.filter(n=>n.endsWith('file_failed')).length,Number(caseName==='definite'));
  assert.equal(calls.includes('ngs_file_sync_remove'),caseName!=='unknown');
  assert.equal(calls.at(-1),caseName==='unknown'?'ngs_file_sync_abort':'ngs_file_sync_finish');
 }
});

test('watch intersects PDS discovery and retains one-minute cadence and independent compare gate',async()=>{
 const calls=[],controller=new AbortController();let clock=0,pass=0;
 const pds=sharePdsCompareSlot({
  discover:async()=>{pass++;calls.push(clock);return {projects:['binari','other']};},
  compare:async s=>({scope:s,groups:[],deleted:[]}),
 });
 const ngs=async(name,args)=>{
  if(name==='ngs_file_sync_begin'){assert.equal(args.scope,scope);return receipt(scope);}
  if(name==='ngs_file_sync_plan')return {ok:true};
  assert.equal(name,'ngs_file_sync_finish');return {ok:true,written:0};
 };
 await watchPdsMcpFileSync({pds,ngs,upload:()=>assert.fail(),projects:['binari','missing'],signal:controller.signal,
  now:()=>clock,sleep:async ms=>{clock+=ms},onResult:()=>{if(pass===2)controller.abort();}});
 assert.deepEqual(calls,[0,60_000]);
});

test('up to ten actual whole binary POSTs across Local+Space, with fair queued admission and exact SHA',async t=>{
 const fileSlot=shareFileTransferSlot(10),launches=[],rows=[],opened=[],held=[];
 const reachedCap=Promise.withResolvers();
 const full=Buffer.alloc(16*1024,33),bytes=label=>Buffer.concat([Buffer.from(label),full]);
 for(const tag of ['l','s'])for(let i=0;i<14;i++)rows.push(tag+'-'+String(i).padStart(2,'0'));
 const scopes=tag=>rows.filter(p=>p.startsWith(tag)).map(path=>row(path,bytes(path)));
 let active=0,peak=0,sent=0,gate=true;
 const server=createServer(async(req,res)=>{
  const path=Buffer.from(req.headers['x-ngs-file-path'],'base64url').toString('utf8');
  assert.equal(req.method,'POST');assert.equal(req.url,'/api/ngs-file-sync-file');
  assert.equal(req.headers['transfer-encoding'],undefined);
  active++;peak=Math.max(peak,active);launches.push(path);
  const chunks=[];for await(const c of req)chunks.push(c);
  const got=Buffer.concat(chunks);assert.deepEqual(got,bytes(path));
  assert.equal(sha(got),req.headers['x-ngs-file-sha256']);
  if(gate){
   const hold=Promise.withResolvers();held.push(hold);
   if(held.length===10)reachedCap.resolve();
   await hold.promise;
  }
  active--;sent++;res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');
 });
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>{for(const h of held)h.resolve();return new Promise(ok=>server.close(ok));});
 const upload=createLoopbackFileUpload('http://127.0.0.1:'+server.address().port+'/mcp');
 const pds=tag=>({
  compare:async()=>({scope,groups:[{folder:'',files:scopes(tag)}],deleted:[]}),
  file(_scope,path){opened.push(path);return stream(bytes(path));},
 });
 const ngs=async name=>{
  if(name==='ngs_file_sync_begin')return receipt(scope);
  if(name==='ngs_file_sync_finish')return {ok:true,written:14};
  assert.equal(name,'ngs_file_sync_plan');return {ok:true};
 };
 const local=pushProjectFiles({scope,pds:pds('l'),ngs,upload,fileSlot,parallelism:10});
 await reachedCap.promise;
 const remote=pushSpaceProjectFiles({scope,pds:pds('s'),ngs,upload,fileSlot,parallelism:10});
 await new Promise(setImmediate);
 assert.equal(opened.length,10,'queued files do not spool until a shared slot is active');
 gate=false;
 for(const h of held)h.resolve();
 assert.deepEqual(await Promise.all([local,remote]),Array(2).fill({ok:true,written:14,failed:0}));
 assert.equal(peak,10);assert.equal(sent,28);assert.equal(new Set(launches).size,28);
 assert.ok(opened.slice(10,14).some(p=>p.startsWith('s')),'Space starts before Local finishes');
 for(const tag of ['l','s'])assert.deepEqual(opened.filter(p=>p.startsWith(tag)).sort(),scopes(tag).map(r=>r.path));
});

test('fatal ambiguous reply drains other in-flight paths before exactly one abort; no new tombstones',async()=>{
 const bytes=Buffer.from('verified'),stale={path:'old',sha256:sha('old')},calls=[],started=[];
 const otherActive=Promise.withResolvers(),hold=Promise.withResolvers(),unknownSecond=Promise.withResolvers();
 let fails=0;
 const data=Array.from({length:12},(_,i)=>['file'+i,bytes]);
 const pds={...fakePDS(data),compare:async()=>({scope,groups:[{folder:'',files:data.map(([p,b])=>row(p,b))}],deleted:[stale]})};
 const ngs=async(name,args)=>{
  calls.push(name);
  if(name==='ngs_file_sync_begin')return receipt(scope,[stale]);
  if(name==='ngs_file_sync_file_failed'||name==='ngs_file_sync_remove'||name==='ngs_file_sync_finish')assert.fail('unknown final cannot acknowledge');
  return {ok:true};
 };
 const upload=async(meta,f)=>{
  assert.deepEqual(await stagedBody(f),bytes);started.push(meta.path);
  if(meta.path==='file0'){
   await otherActive.promise;
   if(++fails===2)unknownSecond.resolve();
   throw Error('NGS_SPACE_FILE_UPLOAD_UNAVAILABLE');
  }
  if(started.filter(x=>x!=='file0').length===9)otherActive.resolve();
  await hold.promise;return {ok:true};
 };
 const check=assert.rejects(pushSpaceProjectFiles({scope,pds,ngs,upload,fileSlot:shareFileTransferSlot(10),parallelism:10}),/NGS_FILE_SYNC_FILE_ACK_UNRESOLVED/);
 await unknownSecond.promise;await new Promise(r=>setTimeout(r,25));
 assert.ok(!calls.includes('ngs_file_sync_abort'),'abort waits for the other nine writes');
 hold.resolve();await check;
 assert.equal(calls.filter(n=>n==='ngs_file_sync_abort').length,1);
 assert.equal(started.length,11);assert.equal(new Set(started).size,10);assert.equal(fails,2);
});

test('two PDS file-chunk RPC slots shared; compare is not queued on transfer slots',async()=>{
 const blocker=Promise.withResolvers(),allSlots=Promise.withResolvers(),started=[];
 let active=0,peak=0;
 const call=sharePdsChunkSlots(async(name,n)=>{
  if(name!=='npc_folder_file_chunk')return 'compare-ready';
  active++;peak=Math.max(active,peak);started.push(n);
  if(started.length===2)allSlots.resolve();
  await blocker.promise;active--;return n;
 });
 const settled=Promise.all(Array.from({length:20},(_,i)=>call('npc_folder_file_chunk',i)));
 await allSlots.promise;
 assert.deepEqual(started,[0,1]);
 assert.equal(await call('npc_folders_compare'),'compare-ready');
 blocker.resolve();
 assert.deepEqual(await settled,Array.from({length:20},(_,i)=>i));
 assert.equal(peak,2);
});

test('slot admission preserves each destination FIFO and rotates when both have pending work',async()=>{
 const slot=shareFileTransferSlot(2),events=[],one=Promise.withResolvers(),two=Promise.withResolvers();
 const head=slot(()=>one.promise,'local'),worker=slot(()=>two.promise,'local');
 const tail=[
  slot(()=>{events.push('l1');},'local'),slot(()=>{events.push('l2');},'local'),
  slot(()=>{events.push('s1');},'space'),slot(()=>{events.push('s2');},'space'),
 ];
 one.resolve();await Promise.all([head,...tail]);
 assert.deepEqual(events,['s1','l1','s2','l2']);
 two.resolve();await worker;
});
