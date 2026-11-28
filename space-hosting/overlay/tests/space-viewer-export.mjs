import assert from 'node:assert/strict';
import test from 'node:test';
import {spaceViewerResponse} from '../build/space-viewer-export.mjs';
import {checkedRelay,relayFetch,runBridge} from '../build/space-viewer-bridge.mjs';

const space='https://binari.example.test',loop='http://127.0.0.1:5281';
const actor={'oai-authenticated-user-id':'team-editor','oai-authenticated-user-email':'team@sample.test'};
const sha256='a'.repeat(64),rows=[
 {path:'project.json',sha256,size:2},
 {path:'npcs/npc.abc/metadata.json',sha256,size:128},
 {path:'cinematics/assemblies/not-for-this-user.json',sha256,size:128},
 {path:'npcs/.backup/metadata.json',sha256,size:12},
 {path:'ops/config.json',sha256,size:39},
];
function viewer(path,{headers=actor,method='GET',...overrides}={}){
 const options={authorizeParticipant:async user=>user.userId==='team-editor',authorizeResource:async (user,id,r)=>r==='npcs',
  replica:{listWithSizes:async()=>rows},bridgeScript:'fixture();',...overrides};
 return spaceViewerResponse(new Request(space+path,{headers,method}),options);
}

test('manifest uses native participant grant then per-workspace grants, no OPS and no hidden files',async()=>{
 assert.equal((await viewer('/api/viewer/manifest',{headers:{}})).status,401);
 assert.equal((await viewer('/api/viewer/manifest',{authorizeParticipant:async()=>false})).status,403);
 assert.equal((await viewer('/api/viewer/manifest',{headers:{...actor,origin:loop}})).status,403);
 assert.equal((await viewer('/api/viewer/manifest',{headers:{...actor,'Sec-Fetch-Site':'cross-site'}})).status,403);
 assert.equal((await viewer('/api/viewer/manifest',{method:'POST'})).status,405);
 assert.equal((await viewer('/api/viewer/manifest?a=b')).status,400);
 const proof=await viewer('/api/viewer/manifest');
 assert.equal(proof.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(await proof.json(),{projectId:'binari',resources:['project','npcs','motion-presets','audio'],files:rows.slice(0,2)});
});

test('bridge is top-level native-authenticated, requires explicit consent, retains opener and avoids credential exports',async()=>{
 const unauth=await viewer('/viewer/bridge',{headers:{}});
 assert.equal(unauth.status,401);assert.match(await unauth.text(),/로그인/);
 assert.equal((await viewer('/viewer/bridge',{headers:{...actor,'Sec-Fetch-Dest':'iframe'}})).status,403);
 const page=await viewer('/viewer/bridge',{headers:{...actor,'Sec-Fetch-Dest':'document','Sec-Fetch-Site':'cross-site'}});
 assert.equal(page.status,200);
 assert.equal(page.headers.get('cross-origin-opener-policy'),'unsafe-none');
 assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const html=await page.text();
 assert.match(html,/viewer-allow/);assert.match(html,/src="\/viewer\/bridge.js"/);
 assert.equal(await(await viewer('/viewer/bridge.js')).text(),'fixture();');
 assert.equal((await viewer('/viewer/bridge.js',{headers:{...actor,origin:loop}})).status,403);
});

test('pinned binary ranges reject traversal, unauthorized targets and stale writes; bound actual body',async()=>{
 const bytes=new TextEncoder().encode('hello world');
 const info={size:bytes.length,customMetadata:{sha256},etag:'E1'};
 let checked;
 const replica={
  head:async()=>info,
  get:async(_path,opts)=>{
   checked=opts;
   const {offset,length}=opts.range;
   return {...info,body:new Response(bytes.subarray(offset,offset+length)).body};
  }
 };
 const path='npcs/npc.abc/metadata.json';
 const req=(p,offset=6,sha=sha256)=>'/api/viewer/file?'+new URLSearchParams({path:p,offset,sha256:sha});
 const found=await viewer(req(path),{replica});
 assert.equal(found.status,200);assert.equal(found.headers.get('x-ngs-file-offset'),'6');
 assert.equal(found.headers.get('x-ngs-file-size'),'11');assert.equal(found.headers.get('x-ngs-file-sha256'),sha256);
 assert.equal(await found.text(),'world');
 assert.deepEqual(checked,{onlyIf:{etagMatches:'E1'},range:{offset:6,length:5}});
 assert.equal((await viewer(req(path,11),{replica})).status,416);
 assert.equal((await viewer(req(path,0,'f'.repeat(64)),{replica})).status,409);
 assert.equal((await viewer(req('npcs/../ops/config.json',0),{replica})).status,400);
 assert.equal((await viewer(req('cinematics/assemblies/not-for-this-user.json',0),{replica,authorizeResource:async (u,p,r)=>r==='cinematics'})).status,403);
 assert.equal((await viewer(req('npcs/.backup/metadata.json',0),{replica})).status,400);
 assert.equal((await viewer(req(path),{replica:{...replica,get:async()=>({...info,etag:'new',body:new Response(bytes).body})}})).status,409);
 assert.equal((await viewer(req(path),{replica:{...replica,get:async()=>({...info,body:new Response(bytes).body})}})).status,503);
});

test('browser relay never exports Space tokens and preserves the same official queue body',async()=>{
 const session={backend:'space',state:'authenticated',requestWritable:true,csrfToken:'secret-csrf',contextId:'secret-context'};
 const direct=()=>Promise.resolve(Response.json(session));
 const remote=await relayFetch(checkedRelay({path:'/__npcgen_session',method:'GET'},space),direct);
 const view=await remote.json();assert.notEqual(view.csrfToken,session.csrfToken);assert.notEqual(view.contextId,session.contextId);
 const body=JSON.stringify({requestType:'npc.workflow',payload:{test:'unchanged'}});
 const input={path:'/api/requests',method:'POST',headers:{'content-type':'application/json',
  'x-npcgen-csrf':view.csrfToken,'x-npcgen-frontend-context':view.contextId},body};
 let writes=0;
 const result=await relayFetch(checkedRelay(input,space),async (url,opts)=>{
  if(url.pathname==='/__npcgen_session')return direct();
  writes++;
  assert.equal(url.href,space+'/api/requests');assert.equal(opts.credentials,'same-origin');assert.equal(opts.redirect,'error');
  assert.equal(opts.headers.get('x-npcgen-csrf'),session.csrfToken);
  assert.equal(opts.headers.get('x-npcgen-frontend-context'),session.contextId);
  assert.equal(opts.body,body);return Response.json({ok:true},{status:202});
 });
 assert.equal(writes,1);assert.equal(result.status,202);
 const denied=await relayFetch(checkedRelay(input,space),async()=>Response.json({...session,requestWritable:false}));
 assert.equal(denied.status,403);
 assert.equal(checkedRelay({...input,path:'/api/space-machine-mcp'},space),null);
 assert.equal(checkedRelay({...input,path:'//evil.test/api/requests'},space),null);
 assert.equal(checkedRelay({...input,path:'/viewer/../api/requests'},space),null);
 assert.equal(checkedRelay({...input,headers:{...input.headers,authorization:'secret'}},space),null);
 assert.equal(checkedRelay({...input,headers:{...input.headers,'x-npcgen-csrf':'secret'}},space),null);
 assert.equal(checkedRelay({method:'GET',path:'/api/requests?queueId=1&queueId=2'},space),null);
});


test('approved browser broker binds opener source, fixed origin, nonce and request ID',async()=>{
 const out=[],hooks={},timer={},textNode={},nonce='b'.repeat(64);
 const button={addEventListener(type,handler){hooks[type]=handler;}};
 const peer={postMessage(message,origin){out.push({message,origin});}};
 const window={opener:peer};window.top=window;
 runBridge({window,document:{getElementById:id=>id==='viewer-status'?textNode:button},
  location:{origin:space,hash:'#'+nonce},addEventListener:(type,handler)=>{hooks[type]=handler;},
  setInterval:(fn,ms)=>{assert.equal(ms,2000);timer.tick=fn;return 3;},
  clearInterval:(n)=>{assert.equal(n,3);delete timer.tick;},
  fetch:async()=>Response.json({queue:[]})});
 const data={type:'ngs-viewer.request.v1',nonce,id:'42',method:'GET',path:'/api/requests'};
 await hooks.message({origin:loop,source:peer,data});
 assert.deepEqual(out,[]);
 hooks.click({isTrusted:false});assert.deepEqual(out,[]);
 hooks.click({isTrusted:true});
 assert.deepEqual(out.shift(),{origin:loop,message:{type:'ngs-viewer.ready.v1',nonce}});
 timer.tick();
 assert.deepEqual(out.shift(),{origin:loop,message:{type:'ngs-viewer.ready.v1',nonce}});
 for(const invalid of [{origin:space,source:peer,data},{origin:loop,source:{},data},{origin:loop,source:peer,data:{...data,nonce:'x'}}]){
  await hooks.message(invalid);
  assert.deepEqual(out,[]);
 }
 await hooks.message({origin:loop,source:peer,data});
 const [{message,origin}]=out;
 assert.equal(origin,loop);assert.equal(message.type,'ngs-viewer.response.v1');assert.equal(message.id,'42');
 assert.equal(message.nonce,nonce);assert.deepEqual(JSON.parse(new TextDecoder().decode(message.body)),{queue:[]});
 await hooks.message({origin:loop,source:peer,data});assert.equal(out.length,1);
 peer.closed=true;timer.tick();assert.equal(timer.tick,undefined);
});
