import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {dispatchWorkspaceRead} from '../build/workspace-read-registry.mjs';
import {stageLocalUiPng} from '../build/local-ui-stage.mjs';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {uiGenerate,uiImport,uiPath,uiSchemas,uiStagePath,validUiRequest} from '../build/ui-asset-contract.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
// Workspace fixture simulates already PDS-verified data. Full PNG decode/alpha validation belongs to Filex.
png[25]=6;
const sha=createHash('sha256').update(png).digest('hex'),id='request.official.'+'4'.repeat(64),projectId='binari';
const manifest={schemaVersion:'ngs.ui-asset-result.v1',projectId,officialRequestId:id,kind:'logo',title:'비나리',sha256:sha,bytes:png.length,width:1,height:1,origin:'manual',designSha256:null};
test('UI catalog excludes incomplete replicas; immutable image read verifies bytes and geometry',async()=>{
 let image=png,header=manifest;
 const project={
  readBytes(path){return path.endsWith('/manifest.json')?Buffer.from(JSON.stringify(header)):path.endsWith('/asset.png')?image:null;},
  listChildren(){return [{name:id,kind:'directory'},{name:'partial',kind:'directory'}];},
  head(){return image?{size:image.length}:null;},
 };
 const authorize=(p,kind)=>p===projectId&&kind==='ui-assets';
 const get=(q,auth=authorize)=>dispatchWorkspaceRead({pathname:uiPath,query:new URLSearchParams(q),openProject:()=>project,authorize:auth});
 const list=await get({projectId});assert.equal(list.json.assets[0].width,1);assert.equal(list.json.assets[0].origin,'manual');
 assert.deepEqual((await get({projectId,id,sha256:sha})).bytes,png);
 await assert.rejects(get({projectId,id,sha256:'7'.repeat(64)}),{status:404});
 await assert.rejects(get({projectId},()=>false),{status:403});
 await assert.rejects(get({projectId,unexpected:'yes'}),{status:400});
 image=null;assert.equal((await get({projectId})).json.assets.length,0);
 image=Buffer.from(png);image[33]^=1;
 await assert.rejects(get({projectId,id,sha256:sha}),{status:503});
 header={...manifest,origin:'imagegen'};await assert.rejects(get({projectId}),{status:503});
});
test('UI PNG staging hash verifies upstream commitment; exact shape prevents platform injection',async()=>{
 assert.deepEqual(await stageLocalUiPng(png,async(url,req)=>{
  assert.match(url,/^http:\/\/127\.0\.0\.1:8030\/v1\/ui\/ownership\/staged$/);
  assert.deepEqual(JSON.parse(req.body),{sha256:sha,base64:png.toString('base64')});
  return Response.json({ok:true,sha256:sha});
 }),{sha256:sha});
 await assert.rejects(stageLocalUiPng(png,async()=>Response.json({ok:true,sha256:'0'.repeat(64)})),{status:503});
 await assert.rejects(stageLocalUiPng(Buffer.alloc(40)),{status:422});
 const gen={schemaVersion:uiSchemas[uiGenerate],projectId,kind:'button',title:'들어가기',prompt:'먹글씨 한지 버튼'};
 assert.equal(validUiRequest(uiGenerate,gen),true);
 assert.equal(validUiRequest(uiGenerate,{...gen,prompt:'가'.repeat(1500)}),false);
 assert.equal(validUiRequest(uiGenerate,{...gen,path:'/tmp/insecure'}),false);
 assert.equal(validUiRequest(uiImport,{schemaVersion:uiSchemas[uiImport],projectId,kind:'logo',title:'비나리',sha256:sha}),true);
});
test('Local UI request and PNG staging reuse browser session and provenance-safe official queue',async t=>{
 const sandbox=mkdtempSync(join(realpathSync(tmpdir()),'ngs-ui-workspace-'));
 const root=join(sandbox,'projects');
 mkdirSync(root,{mode:0o700});
 mkdirSync(join(root,'binari'),{mode:0o700});writeFileSync(join(root,'binari','project.json'),'{"name":"비나리"}',{mode:0o600});
 let accepted,staged=0;
 const server=createLocalProjectPageServer({root,requestQueue:{enqueue(command){accepted=command;return {status:'queued',queueId:'ngs.local.test'};}},
   stageUiPng:bytes=>{staged++;assert.deepEqual(bytes,png);return {sha256:sha};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await new Promise(r=>server.close(r));rmSync(sandbox,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+server.address().port;
 const sessionResponse=await fetch(origin+'/__npcgen_session'),session=await sessionResponse.json();
 const cookie=sessionResponse.headers.get('set-cookie').split(';')[0];
 const headers={origin,cookie,'x-npcgen-csrf':session.csrfToken,'x-npcgen-frontend-context':session.contextId};
 const data={requestType:uiImport,idempotencyKey:'test-ui-1',payload:{schemaVersion:uiSchemas[uiImport],projectId,kind:'logo',title:'비나리',sha256:sha}};
 const post=(path,body,contentType,auth=headers)=>fetch(origin+path,{method:'POST',body,headers:{...auth,'content-type':contentType}});
 assert.equal((await post(uiStagePath,png,'image/png',{origin})).status,401);
 assert.equal((await post(uiStagePath,png,'image/png',{...headers,'x-npcgen-csrf':'fake'})).status,403);
 assert.equal((await post(uiStagePath,png,'application/octet-stream')).status,415);
 assert.equal(staged,0);
 assert.deepEqual(await(await post(uiStagePath,png,'image/png')).json(),{sha256:sha});
 assert.equal(staged,1);
 assert.equal((await post('/api/requests',JSON.stringify({...data,payload:{...data.payload,bytes:png.toString('base64')}}),'application/json')).status,400);
 assert.equal((await post('/api/requests',JSON.stringify(data),'application/json')).status,202);
 assert.deepEqual(accepted,data);
});
