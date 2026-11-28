import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {realpath,mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spaceViewerMcpResponse} from '../../space-hosting/overlay/build/space-viewer-mcp.mjs';
import {nativeViewerRemote} from '../lib/native-mcp.mjs';
import {backgroundViewerSync} from '../lib/background.mjs';
import {openMirror} from '../lib/mirror.mjs';

const origin='https://binari.example.test', payload=Buffer.from('{"title":"비나리"}');
const hash=createHash('sha256').update(payload).digest('hex'),item={path:'project.json',sha256:hash,size:payload.length};
const actor={'oai-authenticated-user-id':'test-member','oai-authenticated-user-email':'member@sample.test'};
const etag='item-etag', info={size:payload.length,etag,customMetadata:{sha256:hash}};
const options={
 replica:{listWithSizes:async()=>[item,{path:'ops/private.json',size:1,sha256:hash}],
          head:async()=>info,get:async()=>({...info,body:new Blob([payload]).stream()})},
 authorizeParticipant:async user=>user.userId===actor['oai-authenticated-user-id'],
 authorizeResource:async()=>false,
};
const path='/api/viewer/file?'+new URLSearchParams({path:item.path,sha256:hash,offset:0});
function nativeCall(name,args,identity=actor){
 return spaceViewerMcpResponse(new Request(origin+'/mcp',{method:'POST',
  headers:{'content-type':'application/json',...identity},
  body:JSON.stringify({jsonrpc:'2.0',id:'fixture',method:'tools/call',params:{name,arguments:args}})}),options);
}
test('native Space port fails closed without platform actor or team grant and has no write tool',async()=>{
 for(const [headers,status] of [[{},401],[{...actor,'oai-authenticated-user-id':'outsider'},403]]){
  const r=await (await nativeCall('ngs_viewer_manifest',{},headers)).json();
  assert.equal(r.result.structuredContent.status,status);
 }
 assert.equal(await nativeCall('delete_file',{}),null);
 const forbidden=await (await nativeCall('ngs_viewer_file_chunk',{path:'ops/private.json',sha256:hash,offset:0})).json();
 assert.notEqual(forbidden.result.structuredContent.status,200);
});

test('native client retries an expired bearer once without exporting it or taking redirects',async()=>{
 let calls=0,reasons=[];
 const remote=nativeViewerRemote({origin,accessToken:async ({refresh})=>{reasons.push(refresh);return refresh?'test.new':'test.expired';},
  request:async (url,init)=>{
   calls++;assert.equal(url.href,origin+'/mcp');assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
   if(init.headers.authorization==='Bearer test.expired')return new Response(null,{status:401});
   return spaceViewerMcpResponse(new Request(url,{...init,headers:{...init.headers,...actor}}),options);
  }});
 const got=await remote(path);
 assert.equal(got.status,200);assert.equal(got.fileSha256,hash);assert.deepEqual(got.bytes,payload);
 assert.deepEqual(reasons,[false,true]);assert.equal(calls,2);
 await assert.rejects(remote('https://other.example/mcp'),/VIEWER_NATIVE_MCP_ROUTE/);
 assert.equal(calls,2);
});

test('background sync publishes and rechecks a real P2 with no browser', {skip:process.platform==='win32'},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ngs-native-p2-'))),mirror=await openMirror(root);
 const events=[];
 const remote=nativeViewerRemote({origin,accessToken:async()=>'test.token',request:(url,init)=>
  spaceViewerMcpResponse(new Request(url,{...init,headers:{...init.headers,...actor}}),options)});
 const bg=backgroundViewerSync({mirror,remote,onState:e=>events.push(e)});
 t.after(async()=>{await bg.close();await mirror.close();await rm(root,{recursive:true,force:true});});
 await bg.start();
 assert.deepEqual(events.at(-1),{state:'completed',files:1,changed:1,failed:0,removed:0});
 assert.deepEqual(await readFile(join(root,'binari',item.path)),payload);
 await bg.start();
 assert.deepEqual(events.at(-1),{state:'completed',files:1,changed:0,failed:0,removed:0});
});
