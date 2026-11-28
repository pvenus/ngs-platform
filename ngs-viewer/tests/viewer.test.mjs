import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createViewer,binariSpace} from '../viewer.mjs';
import {openMirror} from '../lib/mirror.mjs';

async function fixture(t,opts={}){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'ngs-viewer-test-')));
 const windows=process.platform==='win32',root=windows?join(temp,'private P2'):temp;
 const mirror=windows?await openMirror(root,{create:true}):null;
 const viewer=await createViewer({root,mirror,...opts});
 await new Promise((resolve,reject)=>{viewer.once('error',reject);viewer.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{await new Promise(resolve=>viewer.close(resolve));await rm(temp,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+viewer.address().port,get=(path,init)=>fetch(origin+path,init);
 const config=await (await get('/__viewer/config')).json();
 const write=(path,value,extra={})=>get('/__viewer/'+path,{
  method:'POST',headers:{Origin:origin,'x-ngs-viewer-key':config.guardKey,'Content-Type':'application/json',...extra},
  body:value instanceof Uint8Array?value:JSON.stringify(value)});
 return {root,origin,config,write,get};
}

test('viewer uses same shared app shell but exposes neither request nor OPS/server routes',async t=>{
 const {get,config,write}=await fixture(t);
 assert.equal(config.spaceOrigin,binariSpace);
 assert.match(await (await get('/')).text(),/NGS Viewer/);
 assert.match(await (await get('/local-project-page.js')).text(),/submitQueuedRequest/);
 assert.equal((await get('/local-project-page-server.mjs')).status,404);
 assert.equal((await get('/api/requests')).status,404);
 assert.equal((await get('/__npcgen_session')).status,404);
 assert.equal((await get('/api/requests',{method:'POST',headers:{Origin:'http://evil.example'},body:'{}'})).status,403);
 assert.equal((await get('/api/space-machine-mcp')).status,404);
 assert.equal((await get('/api/project-folders')).status,503);
 assert.equal((await write('disconnect',{}, {Origin:'http://evil.example'})).status,403);
 assert.equal((await write('disconnect',{}, {'x-ngs-viewer-key':'x'.repeat(64)})).status,403);
});

test('hash-pinned P2 files drive the existing project DTO, only after full installation',async t=>{
 const {root,get,write}=await fixture(t);
 const data=Buffer.from(JSON.stringify({title:'비나리'}));
 const item={path:'project.json',sha256:createHash('sha256').update(data).digest('hex'),size:data.length};
 const manifest={projectId:'binari',resources:['project'],files:[item]};
 const start=await write('sync/start',{});assert.equal(start.status,202);
 const {id}=await start.json();
 assert.equal((await get('/api/project-folders')).status,503);
 let outcome;
 for(let i=0;i<100;i++){
  const r=await (await write('sync/poll',{id})).json();
  if(r.state!=='running'){outcome=r;break;}
  for(const job of r.jobs){
   const headers={'Content-Type':'application/octet-stream','x-ngs-viewer-upstream-status':'200'};
   const route=new URL(job.path,'http://127.0.0.1');
   let bytes;
   if(route.pathname==='/api/viewer/manifest')bytes=Buffer.from(JSON.stringify(manifest));
   else{
    assert.equal(route.pathname,'/api/viewer/file');
    assert.equal(route.searchParams.get('path'),item.path);
    assert.equal(route.searchParams.get('offset'),'0');
    bytes=data;
    Object.assign(headers,{'x-ngs-file-size':String(item.size),'x-ngs-file-sha256':item.sha256,'x-ngs-file-offset':'0'});
   }
   assert.equal((await write('sync/reply?'+new URLSearchParams({id,job:job.id}),bytes,headers)).status,200);
  }
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.equal(outcome?.state,'completed',JSON.stringify(outcome));
 assert.deepEqual(await readFile(join(root,'binari','project.json')),data);
 assert.deepEqual(await (await get('/api/project-folders')).json(),
   {projects:[{projectId:'binari',name:'비나리',iconUrl:null,needsRefresh:false}]});
 assert.equal((await get('/api/npc-workspace?projectId=binari')).status,403);
 await write('disconnect',{});
 assert.equal((await get('/api/project-folders')).status,503);
});

test('Codex background mode syncs without a popup or browser, displays loss, and retains the P2 file', {skip:process.platform==='win32'},async t=>{
 const payload=Buffer.from('{"title":"비나리"}'),sha256=createHash('sha256').update(payload).digest('hex');
 let disconnected=false, calls=[], sessionArgs=[], outcome;
 const client={close(){},async tool(name,args){
  calls.push(name);
  if(disconnected)throw Error('VIEWER_CODEX_CONNECTION_REQUIRED');
  if(name==='ngs_viewer_request_session'){
   sessionArgs.push(args);
   if(args.workspaceProtocol)throw Error('old Space rejects the new read shape');
   return {structuredContent:{status:200,data:{
    backend:'space',state:'authenticated',readOnly:false,queueEnabled:true,workspaceReady:true,requestWritable:true}}};
  }
  if(name==='ngs_viewer_request_submit') {
   assert.deepEqual(args,{command:{requestType:'test',payload:{}}});
   if(outcome==='lost')throw Error('response lost');
   if(outcome==='rejected')return {structuredContent:{status:403}};
   return {structuredContent:{status:202,data:{status:'queued',queueId:'ngs.space.e4913818-1123-46c4-a6ee-eedb416b96c6'}}};
  }
  if(name==='ngs_viewer_manifest')return {isError:false,structuredContent:{status:200,manifest:{
   projectId:'binari',resources:['project'],files:[{path:'project.json',size:payload.length,sha256}]}}};
  assert.equal(name,'ngs_viewer_file_chunk');assert.deepEqual(args,{path:'project.json',sha256,offset:0});
  return {isError:false,structuredContent:{status:200,base64:payload.toString('base64'),fileSize:String(payload.length),
   fileSha256:sha256,fileOffset:'0'}};
 }};
 const {root,config,get,write}=await fixture(t,{codexClient:client});
 assert.equal(config.backend,'codex');
 const until=async state=>{
  for(let i=0;i<75;i++){const x=await (await get('/__viewer/status')).json();if(x.state===state)return x;
   await new Promise(resolve=>setTimeout(resolve,5));}
  assert.fail('Viewer status did not reach '+state);
 };
 const first=await until('completed');
 assert.deepEqual(first,{state:'completed',files:1,changed:1,failed:0,removed:0,committed:true});
 assert.deepEqual(calls,['ngs_viewer_manifest','ngs_viewer_file_chunk']);
 assert.equal((await get('/api/project-folders')).status,200);
 assert.equal((await (await get('/__npcgen_session')).json()).requestWritable,true);
 assert.deepEqual(sessionArgs,[{workspaceProtocol:3},{workspaceProtocol:2},{}]);
 const submit=()=>get('/api/requests',{method:'POST',headers:{Origin:config.port?'http://127.0.0.1:'+config.port:'',
  'Content-Type':'application/json','X-NPCGen-Csrf':'0'.repeat(64),'X-NPCGen-Frontend-Context':'space.'+'0'.repeat(64)},
  body:JSON.stringify({requestType:'test',payload:{}})});
 assert.equal((await submit()).status,202);
 outcome='rejected';assert.equal((await submit()).status,403);
 outcome='lost';const uncertain=await submit();assert.equal(uncertain.status,502);
 assert.equal((await uncertain.json()).error,'VIEWER_REQUEST_DELIVERY_UNCERTAIN');
 assert.equal(calls.filter(n=>n==='ngs_viewer_request_submit').length,3);
 assert.equal((await write('sync/start',{})).status,404);
 disconnected=true;
 assert.equal((await write('sync/now',{})).status,202);
 assert.equal((await until('failed')).error,'VIEWER_CODEX_CONNECTION_REQUIRED');
 assert.deepEqual(await readFile(join(root,'binari','project.json')),payload);
});

test('a formal request is sent while the first file sync is still waiting',{skip:process.platform==='win32'},async t=>{
 let release,started,attempts=0;
 const wait=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
 t.after(()=>release());
 const client={close:release,async tool(name,args){
  if(name==='ngs_viewer_manifest'){
   started();await wait;
   return {isError:false,structuredContent:{status:200,manifest:{projectId:'binari',resources:['project'],files:[]}}};
  }
  assert.equal(name,'ngs_viewer_request_submit');assert.deepEqual(args.command,{requestType:'test',payload:{}});
  attempts++;return {structuredContent:{status:403}};
 }};
 const {origin,get}=await fixture(t,{codexClient:client});
 await entered;
 assert.equal((await get('/api/project-folders')).status,503);
 const result=await get('/api/requests',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',
   'X-NPCGen-Csrf':'0'.repeat(64),'X-NPCGen-Frontend-Context':'space.'+'0'.repeat(64)},
   body:JSON.stringify({requestType:'test',payload:{}})});
 assert.equal(result.status,403);assert.equal(attempts,1);
 assert.equal((await (await get('/__viewer/status')).json()).state,'running');
 release();
});

test('update pause refuses in-progress sync and prevents a new download or request until resumed',{skip:process.platform==='win32'},async t=>{
 let release,entered,reads=0;
 const blocked=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
 t.after(()=>release());
 const client={close:release,async tool(name){
  assert.equal(name,'ngs_viewer_manifest');reads++;entered();await blocked;
  return {isError:false,structuredContent:{status:200,manifest:{projectId:'binari',resources:['project'],files:[]}}};
 }};
 const {write,get,origin}=await fixture(t,{codexClient:client,releaseCommit:'c'.repeat(40)});
 await started;
 assert.equal((await write('update/pause',{})).status,409);
 release();
 for(let i=0;i<50;i++){
  if((await (await get('/__viewer/status')).json()).state==='completed')break;
  await new Promise(r=>setTimeout(r,5));
 }
 assert.equal((await write('update/pause',{})).status,200);
 assert.equal((await write('sync/now',{})).status,409);
 const denied=await get('/api/requests',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',
  'X-NPCGen-Csrf':'0'.repeat(64),'X-NPCGen-Frontend-Context':'space.'+'0'.repeat(64)},body:'{}'});
 assert.equal(denied.status,409);
 assert.equal(reads,1);
 assert.equal((await write('update/resume',{})).status,200);
 assert.equal((await write('sync/now',{})).status,202);
});


test('Viewer serves the bundled C# browser runtime at the version in its shell',async t=>{
 const {get}=await fixture(t);
 const response=await get('/'),html=await response.text(),version=/data-puzzle-core="([a-f0-9]{64})"/u.exec(html)?.[1];
 assert.ok(version);
 assert.match(response.headers.get('content-security-policy'),/wasm-unsafe-eval/);
 const result=await get('/puzzle-core/'+version+'/_framework/dotnet.js');
 assert.equal(result.status,200);assert.match(result.headers.get('content-type'),/javascript/);
 assert.ok((await result.text()).length>100);
});
