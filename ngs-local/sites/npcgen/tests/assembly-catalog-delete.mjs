import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {fileDeleteType,assemblyFolderDeletePayload,validAssemblyFolderDelete} from '../build/prop-folder-delete-contract.mjs';
import {createRSQueueConsumer} from '../build/rs-mcp.mjs';
const id=c=>'request.official.'+c.repeat(64);
const rows=[{id:id('a'),expected:{revision:1,officialRequestId:id('a')}},
 {id:id('b'),expected:{revision:2,officialRequestId:id('c')}}];
const payloads=rows.map(assemblyFolderDeletePayload);
test('delete intake is gated and accepts exactly one pinned assembly folder per request',async t=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'ngs-assembly-delete-'));t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const root=join(dir,'projects');mkdirSync(root,{mode:0o700});
 let enabled=false;const jobs=[];
 const server=createLocalProjectPageServer({root,readAssemblyDeleteReady:async()=>enabled,
  requestQueue:{enqueue(c){jobs.push(c);return {status:'queued'};}}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
 const origin='http://127.0.0.1:'+server.address().port;
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0];
 const session=await boot.json(),headers={cookie,origin,'Content-Type':'application/json',
  'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId};
 const send=(payload,i)=>fetch(origin+'/api/requests',{method:'POST',headers,body:JSON.stringify({requestType:fileDeleteType,idempotencyKey:'map-delete-'+i,payload})});
 assert.equal(session.assemblyDeleteEnabled,undefined);
 assert.equal((await send(payloads[0],0)).status,404);
 enabled=true;
 assert.equal((await (await fetch(origin+'/__npcgen_session',{headers:{cookie}})).json()).assemblyDeleteEnabled,true);
 for(const [i,p] of payloads.entries())assert.equal((await send(p,i+1)).status,202);
 const bad=[{...payloads[0],target:{...payloads[0].target,path:'../backgrounds'}},
  {...payloads[0],target:{...payloads[0].target,kind:'file'}},{...payloads[0],targets:payloads.map(p=>p.target)},
  {...payloads[0],expected:{...payloads[0].expected,revision:0}}];
 for(const [i,p] of bad.entries()){
  assert.ok(!validAssemblyFolderDelete(p));assert.equal((await send(p,i+4)).status,400);
 }
 assert.deepEqual(jobs.map(x=>x.payload),payloads);
});
test('the Local queue relay forwards each exact assembly deletion independently',async()=>{
 const seen=[],queueId=i=>'ngs.local.15d60410-3f24-480d-9072-cd51f3d2a00'+(i+5);
 const consumer=createRSQueueConsumer({
  callNGS:async(name,args)=>name==='ngs_request_queue_list'?
   {requests:payloads.map((payload,i)=>({queueId:queueId(i),idempotencyKey:queueId(i),requestType:fileDeleteType,payload}))}:
   {queueId:args.queueId,status:'acknowledged'},
  callRS:async(name,args)=>{assert.equal(name,'request_submit');seen.push(args.payload);return {status:'registered',officialRequestId:id('d')};},
 });
 const status=await consumer.pollOnce();
 assert.equal(status.rejected,0);assert.deepEqual(seen,payloads);
});
