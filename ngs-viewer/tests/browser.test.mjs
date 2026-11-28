// Browser protocol fixture: no credentials, network, or production queue.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

test('approved Space popup receives only the native request envelope and returns exact reply',async()=>{
 const code=(await readFile(new URL('../public/browser.mjs',import.meta.url),'utf8'))
  .replace("await import('/local-project-page.js')","boot()");
 const local='http://127.0.0.1:5281',space='https://fixture.binari.chatgpt.site';
 const events=new Map(),buttons=new Map(),status={textContent:''},store=new Map(),sent=[],localWrites=[];
 const queuePayload={requestType:'fixture.create',idempotencyKey:'viewer-test:1',payload:{projectId:'binari'}};
 const bridge={
  closed:false,
  postMessage(msg,target){
   assert.equal(target,space);sent.push(msg);
   const deliver=(status,value)=>{
    const response={type:'ngs-viewer.response.v1',nonce:msg.nonce,id:msg.id,status,
     headers:{'content-type':'application/json'},body:new TextEncoder().encode(JSON.stringify(value)).buffer};
    // Ignore spoofed origins and a forged reply from another WindowProxy.
    events.get('message')({origin:'https://evil.example',data:{...response,status:500},source:bridge});
    events.get('message')({origin:space,data:{...response,status:500},source:{}});
    events.get('message')({origin:space,data:response,source:bridge});
   };
   if(msg.path==='/api/viewer/manifest')return deliver(200,{projectId:'binari',files:[],resources:['project']});
   assert.equal(msg.path,'/api/requests');assert.equal(msg.method,'POST');
   assert.deepEqual(JSON.parse(msg.body),queuePayload);
   assert.equal(msg.headers['x-npcgen-csrf'],'0'.repeat(64));
   deliver(202,{status:'pending'});
  }
 };
 const window={
  fetch:async(path,params)=>{
   if(path==='/__viewer/config')return Response.json({spaceOrigin:space,guardKey:'f'.repeat(64)});
   localWrites.push(path);assert.equal(params.headers['x-ngs-viewer-key'],'f'.repeat(64));
   if(path==='/__viewer/begin')return Response.json({syncId:'abc',files:[]});
   if(path==='/__viewer/finish')return Response.json({files:0,changed:0,removed:0});
   assert.equal(path,'/__viewer/disconnect');return Response.json({ok:true});
  },
  addEventListener:(name,fn)=>events.set(name,fn),
  open(url){assert.match(url,/\/viewer\/bridge#[a-f0-9]{64}\.5281$/);return bridge;},
 };
 let started;
 const booted=new Promise(resolve=>{started=resolve;});
 await runInNewContext('(async()=>{'+code+'})()',{
  ArrayBuffer,crypto,URL,URLSearchParams,Response,Error,location:{origin:local},window,
  setTimeout:(cb,ms)=>ms>=20_000?0:setTimeout(cb,ms),clearTimeout,
  Request:class extends Request{constructor(input,init){super(new URL(input,local),init);}},
  sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
  document:{querySelector:selector=>selector==='#viewer-state'?status:
   {addEventListener:(name,fn)=>buttons.set(selector+name,fn)}},boot:started,
 });
 buttons.get('#viewer-linkclick')();
 const nonce=store.get('ngs-viewer.bridge-nonce.v1');
 events.get('message')({origin:'https://evil.example',source:bridge,data:{type:'ngs-viewer.ready.v1',nonce}});
 assert.equal(sent.length,0);
 events.get('message')({origin:space,source:bridge,data:{type:'ngs-viewer.ready.v1',nonce}});
 await booted;
 assert.match(status.textContent,/P2 파일 0개/);
 const result=await window.fetch('/api/requests',{method:'POST',
  headers:{'Content-Type':'application/json','X-NPCGen-Csrf':'0'.repeat(64),'X-NPCGen-Frontend-Context':'space.'+'0'.repeat(64)},
  body:JSON.stringify(queuePayload)});
 assert.equal(result.status,202);
 assert.deepEqual(await result.json(),{status:'pending'});
 assert.equal(sent.filter(msg=>msg.path==='/api/requests').length,1);
 assert.deepEqual(localWrites,['/__viewer/disconnect','/__viewer/begin','/__viewer/finish']);
});
