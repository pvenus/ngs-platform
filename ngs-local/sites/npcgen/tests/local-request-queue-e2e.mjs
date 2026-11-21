import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openLocalRequestQueue} from '../build/local-request-queue.mjs';
import {createLocalRequestQueueMcp} from '../build/local-request-queue-mcp.mjs';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {sameMacRSQueue} from '../build/rs-mcp.mjs';
import {loopbackJsonMCP} from '../build/folder-mcp-loopback.mjs';

test('fixture HTTP button handoff -> local queue MCP -> real unchanged RS -> pending list and payload removal',
 {skip:!process.env.NGS_LEGACY_RS_SOURCE},async()=>{
 const {createRequestService}=await import(pathToFileURL(join(process.env.NGS_LEGACY_RS_SOURCE,'request-service.mjs')).href);
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-request-e2e-')),db=join(root,'queue.sqlite');
 const webRoot=join(root,'replica');mkdirSync(webRoot,{mode:0o700});
 const queue=openLocalRequestQueue(db);
 const servers=[];
 const listen=async(server)=>{
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
  servers.push(server);return 'http://127.0.0.1:'+server.address().port;
 };
 try{
  const web=await listen(createLocalProjectPageServer({root:webRoot,requestQueueDb:db,audioWorkspaceEnabled:true}));
  const ngsUrl=await listen(createLocalRequestQueueMcp(queue))+'/mcp';
  const rsUrl=await listen(createRequestService({directory:join(root,'official')}))+'/mcp';
  const official=loopbackJsonMCP(rsUrl);
  const r=await fetch(web+'/__npcgen_session'),cookie=r.headers.get('set-cookie').split(';')[0],s=await r.json();
  const headers={cookie,origin:web,'content-type':'application/json','x-npcgen-csrf':s.csrfToken,'x-npcgen-frontend-context':s.contextId};
  const command={requestType:'audio.generate',idempotencyKey:'fixture-e2e-only',payload:{schemaVersion:'ngs.audio-generate.v1',projectId:'binari',kind:'bgm',title:'Fixture only',brief:'No production job',conceptId:'fixture',text:'',durationSeconds:null}};
  const submit=()=>fetch(web+'/api/requests',{method:'POST',headers,body:JSON.stringify(command)});
  const admission=await submit();assert.equal(admission.status,202);
  const queued=await admission.json(),pendingUrl=web+'/api/requests';
  assert.deepEqual((await official('request_list',{})).requests,[]);
  assert.equal((await fetch(pendingUrl)).status,401);
  const pending=await (await fetch(pendingUrl,{headers:{cookie}})).json();
  assert.deepEqual(pending,{requests:[{projectId:'binari',requestType:'audio.generate',queuedAt:pending.requests[0].queuedAt}]});
  assert.ok(Number.isSafeInteger(pending.requests[0].queuedAt));
  const consumer=sameMacRSQueue({ngsUrl,rsUrl});
  const run=await consumer.pollOnce();assert.equal(run.acknowledged,1);
  const stored=(await official('request_list',{})).requests;
  assert.equal(stored.length,1);assert.equal(stored[0].status,'registered');
  assert.deepEqual(queue.list().requests,[]);
  const settled=await fetch(pendingUrl,{headers:{cookie}});
  assert.equal(settled.status,200);assert.deepEqual(await settled.json(),{requests:[]});
  assert.deepEqual(await (await submit()).json(),queued);
  assert.equal((await consumer.pollOnce()).seen,0);
  assert.equal((await official('request_list',{})).requests.length,1);
 }finally{
  await Promise.all(servers.reverse().map(server=>new Promise(ok=>server.close(ok))));
  queue.close();rmSync(root,{recursive:true,force:true});
 }
});
