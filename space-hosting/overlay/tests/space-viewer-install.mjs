import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {spaceViewerInstallResponse} from '../build/space-viewer-install.mjs';
import {checkedRelay,relayFetch,runBridge} from '../build/space-viewer-bridge.mjs';
const base='https://example.test';
const secret='a'.repeat(64), verifier='1'.repeat(64), sha=value=>createHash('sha256').update(value).digest('hex');
const challengeSha256=sha(verifier), userId='editor-test', mail='editor@example.test', port=17777, now=1780000000000;
const actor=sha(JSON.stringify(['space.queue.actor.v1',userId]));
const sign=purpose=>createHmac('sha256',secret).update(JSON.stringify([purpose,'binari',actor])).digest('hex');
const auth={
 'oai-authenticated-user-id':userId,'oai-authenticated-user-email':mail,origin:base,
 'x-npcgen-csrf':sign('csrf.v1'),'x-npcgen-frontend-context':'space.'+sign('context.v1')
};
const options={secret,authorizeParticipant:async u=>u.userId===userId&&u.email===mail,now:()=>now};
function req(action,payload,headers={},option=options,origin=base){
 return spaceViewerInstallResponse(new Request(origin+'/api/viewer/install/'+action,{
  method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(payload)
 }),option);
}
test('native team approval issues a five-minute proof scoped to exact installer verifier, port and Space origin',async()=>{
 const output=await req('issue',{port,challengeSha256},auth);
 assert.equal(output.status,200);
 assert.equal(output.headers.get('cache-control'),'private, no-store');
 const {proof,expiresAt}=await output.json();
 assert.equal(expiresAt,now+300_000);
 assert.equal(proof.includes(secret),false);
 const valid={port,verifier,proof};
 assert.deepEqual(await (await req('verify',valid)).json(),{authorized:true});
 assert.equal((await req('verify',{...valid,port:17778})).status,403);
 assert.equal((await req('verify',{...valid,verifier:'2'.repeat(64)})).status,403);
 assert.equal((await req('verify',valid,{},options,'https://other.example.test')).status,403);
 assert.equal((await req('verify',valid,{}, {...options,now:()=>expiresAt})).status,403);
 assert.equal((await req('verify',valid,{origin:base})).status,403);
 assert.equal((await req('verify',{...valid,proof:proof.slice(0,-1)+(proof.endsWith('a')?'b':'a')})).status,403);
});
test('issuance rejects unauthenticated, inactive, cross-origin, CSRF mismatch and invalid fields before install',async()=>{
 const input={port,challengeSha256};
 assert.equal((await req('issue',input,{origin:base})).status,401);
 assert.equal((await req('issue',input,auth,{...options,authorizeParticipant:()=>false})).status,403);
 assert.equal((await req('issue',input,{...auth,origin:'http://127.0.0.1:17777'})).status,403);
 assert.equal((await req('issue',input,{...auth,'x-npcgen-csrf':'0'.repeat(64)})).status,403);
 assert.equal((await req('issue',input,{...auth,'x-npcgen-frontend-context':'space.'+sign('csrf.v1')})).status,403);
 assert.equal((await req('issue',{...input,extra:true},auth)).status,400);
 for(const invalid of [1023,65536,'17777',17777.5])assert.equal((await req('issue',{...input,port:invalid},auth)).status,400);
 assert.equal((await req('issue',{...input,challengeSha256:'a'.repeat(2048)},auth)).status,413);
});
test('relay only issues on the opener port, allows native read-only team members, and never relays verification',async()=>{
 const post={method:'POST',path:'/api/viewer/install/issue',headers:{
  'content-type':'application/json','x-npcgen-frontend-context':'space.'+'0'.repeat(64),'x-npcgen-csrf':'0'.repeat(64)
 },body:JSON.stringify({port,challengeSha256})};
 assert.equal(checkedRelay(post,base,port+1),null);
 assert.equal(checkedRelay({...post,path:'/api/viewer/install/verify'},base,port),null);
 const spec=checkedRelay(post,base,port);
 const result=await relayFetch(spec,async (url,init)=>{
  if(url.pathname==='/__npcgen_session')return Response.json({backend:'space',state:'authenticated',
   requestWritable:false,csrfToken:auth['x-npcgen-csrf'],contextId:auth['x-npcgen-frontend-context']});
  return spaceViewerInstallResponse(new Request(url,{...init,headers:{...Object.fromEntries(init.headers),...auth}}),options);
 });
 assert.equal(result.status,200);
});
test('explicit fragment port targets only the matching localhost origin',()=>{
 const posted=[],nodes={'viewer-status':{},'viewer-allow':{addEventListener(type,fn){this.click=fn;}}};
 const w={opener:{postMessage(value,origin){posted.push([value,origin]);}}};w.top=w;
 const runtime={window:w,document:{getElementById:id=>nodes[id]},location:{origin:base,hash:'#'+'a'.repeat(64)+'.'+port},
  addEventListener(){},setInterval(){return 1;},clearInterval(){}};
 runBridge(runtime);nodes['viewer-allow'].click({isTrusted:true});
 assert.equal(posted[0][1],'http://127.0.0.1:'+port);
 assert.equal(posted[0][0].nonce,'a'.repeat(64));
 runtime.location.hash='#'+'b'.repeat(64)+'.65536';
 runBridge(runtime);
 assert.equal(posted.length,1);
 assert.equal(nodes['viewer-allow'].hidden,true);
});
