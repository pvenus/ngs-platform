import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
import {createLoopbackFileUpload} from '../build/file-sync-raw-client.mjs';
import {pushProjectFiles,pushSpaceProjectFiles,shareFileTransferSlot,sharePdsCompareSlot,watchPdsMcpFileSync} from '../build/pds-mcp-file-sync.mjs';

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
