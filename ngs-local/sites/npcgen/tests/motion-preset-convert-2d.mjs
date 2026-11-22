import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {openLocalRequestQueue} from '../build/local-request-queue.mjs';
import {createRSQueueConsumer} from '../build/rs-mcp.mjs';
import {createMotionPresetIntake,motionConversionCommand,motionConversionForm,readyMotionPreset,
 suggestMotionVariantId,validMotionPresetConvert} from '../build/motion-preset-convert-2d.mjs';

const sample={projectId:'binari',sourcePresetId:'walk',variantPresetId:'walk-2d',label:'걷기 · 2D 마네킹'};
const qId='ngs.local.00000000-0000-4000-8000-000000000000';
const ready={presetId:'walk',label:'걷기',directions:['n','ne','e','se','s','sw','w','nw'].map((direction,i)=>({
 direction,path:'motion-presets/assets/'+String(i).repeat(64)+'.mp4',
}))};

test('exact official wire and deterministic retry after ambiguous transport',async()=>{
 const command=await motionConversionCommand(sample);
 assert.deepEqual(command.payload,{schemaVersion:'ngs.motion-preset-convert-2d.v1',...sample});
 assert.equal(command.requestType,'motion-preset.convert-2d');
 assert.match(command.idempotencyKey,/^motion-2d-[a-f0-9]{64}$/u);
 assert.deepEqual(await motionConversionCommand({...sample,label:' '+sample.label+' '}),command);
 assert.notEqual((await motionConversionCommand({...sample,label:'다른 이름'})).idempotencyKey,command.idempotencyKey);
 for(const bad of [{sourcePresetHash:'abc'},{projectId:'other'},{sourcePresetId:'../npc'},{variantPresetId:'walk'},
  {sourcePresetId:'WALK',variantPresetId:'walk'},{variantPresetId:'xx\n'},{variantPresetId:'최신'},{label:'다\n른'},{label:'a'.repeat(121)},{label:'\ud800'}])
  assert.equal(validMotionPresetConvert({...command.payload,...bad}),false,JSON.stringify(bad));
 assert.equal(suggestMotionVariantId('A.X_1'),'a-x-1-2d');assert.equal(suggestMotionVariantId('4RUN'),'preset-4run-2d');
 assert.equal(suggestMotionVariantId('a'.repeat(127)).length,64);
 const calls=[];
 const intake=createMotionPresetIntake(async cmd=>{
  calls.push(cmd);
  return Response.json({queueId:calls.length===1?'not-an-ack':qId,status:'queued'},{status:202});
 });
 const first=intake.send(sample);
 assert.equal(await intake.send(sample),null);
 await assert.rejects(first,/접수를 확인하지 못했습니다/);
 assert.deepEqual(await intake.send(sample),{queueId:qId,status:'queued'});
 assert.deepEqual(calls,[command,command]);
});

test('source needs eight distinct authorized preview paths; missing inputs expose only disabled guidance',()=>{
 assert.equal(readyMotionPreset(ready),true);
 assert.equal(readyMotionPreset({...ready,directions:ready.directions.slice(1)}),false);
 assert.equal(readyMotionPreset({...ready,directions:ready.directions.map((d,i)=>i===0?{...d,path:null}:d)}),false);
 assert.equal(readyMotionPreset({...ready,directions:ready.directions.map((d,i)=>i===0?{...d,path:ready.directions[1].path}:d)}),false);
 const signal=new AbortController().signal;
 assert.equal(motionConversionForm({projectId:'binari',preset:ready,submit:null,signal}),null);
 assert.equal(motionConversionForm({projectId:'other',preset:ready,submit:()=>{},signal}),null);
});

test('form extends detail, keeps original read-only, and no duplicate sends',async t=>{
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.isConnected=true;}
  append(...children){this.children.push(...children);}
  setAttribute(){ }
  addEventListener(event,fn){this.events[event]=fn;}
 }
 const old=globalThis.document;
 globalThis.document={createElement:tag=>new Node(tag)};
 t.after(()=>{if(old)globalThis.document=old;else delete globalThis.document;});
 const signal=new AbortController().signal;
 let done;
 const submissions=[];
 const submit=cmd=>{submissions.push(cmd);return new Promise(resolve=>{done=resolve;});};
 const panel=motionConversionForm({projectId:'binari',preset:ready,publishedIds:new Set(['walk-2d']),submit,signal});
 const hidden=motionConversionForm({projectId:'binari',preset:{...ready,directions:[]},publishedIds:new Set(),submit,signal});
 assert.equal(hidden.children.some(child=>child.tag==='form'),false);
 assert.equal(panel.tag,'details');
 const form=panel.children.find(child=>child.tag==='form');
 const [id,title,send,status]=form.children;
 assert.equal(id.children[1].value,'walk-2d');assert.equal(title.children[1].value,'걷기 · 2D 마네킹');
 const event={preventDefault(){}};
 await form.events.submit(event);
 assert.match(status.textContent,/이미 게시/);assert.equal(submissions.length,0);
 id.children[1].value='walk-other-2d';
 const first=form.events.submit(event);
 await form.events.submit(event);
 while(!done)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(send.disabled,true);assert.equal(submissions.length,1);
 assert.equal(submissions[0].payload.sourcePresetId,'walk');assert.equal(submissions[0].payload.variantPresetId,'walk-other-2d');
 done(Response.json({queueId:qId,status:'queued'},{status:202}));await first;
 assert.match(status.textContent,/대기열에 넣었습니다/);assert.equal(send.disabled,true);
});

test('Local auth/CSRF and queue admission to exact existing RS, never a worker or Filex browser call',async t=>{
 const temp=await mkdtemp(join(realpathSync(tmpdir()),'ngs-motion-conversion-'));
 const queue=openLocalRequestQueue(join(temp,'queue.sqlite')),root=join(temp,'workspace');
 const server=createLocalProjectPageServer({root,requestQueue:queue});
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));queue.close();await rm(temp,{recursive:true,force:true});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const session=await fetch(origin+'/__npcgen_session'),cookie=session.headers.get('set-cookie').split(';')[0],s=await session.json();
 const headers={cookie,origin,'content-type':'application/json','x-npcgen-csrf':s.csrfToken,'x-npcgen-frontend-context':s.contextId};
 const post=(command,override={})=>fetch(origin+'/api/requests',{method:'POST',headers:{...headers,...override},body:JSON.stringify(command)});
 const command=await motionConversionCommand(sample);
 assert.equal((await fetch(origin+'/motion-preset-convert-2d.mjs')).status,200);
 assert.equal((await post(command,{'x-npcgen-csrf':'wrong'})).status,403);
 assert.equal((await post({...command,payload:{...command.payload,frames:120}})).status,400);
 assert.equal(queue.list().requests.length,0);
 const response=await post(command),accepted=await response.json();
 assert.equal(response.status,202);assert.deepEqual(await (await post(command)).json(),accepted);
 assert.equal(queue.list().requests.length,1);
 const seen=[];
 const rs=createRSQueueConsumer({
  callNGS:async(tool,params)=>{
   if(tool==='ngs_request_queue_list')return queue.list(params.limit,params.cursor);
   if(tool==='ngs_request_queue_ack')return queue.ack(params.queueId,params.receipt);
   assert.fail('unexpected NGS tool '+tool);
  },
  callRS:async(tool,args)=>{
   seen.push({tool,args});
   return {officialRequestId:'request.official.'+createHash('sha256')
    .update(JSON.stringify(['request.official.v1','local','binari',args.idempotencyKey])).digest('hex'),status:'registered'};
  },
 });
 assert.equal((await rs.pollOnce()).acknowledged,1);
 assert.deepEqual(seen,[{tool:'request_submit',args:{sourceId:'local',requestType:command.requestType,idempotencyKey:accepted.queueId,payload:command.payload}}]);
 assert.deepEqual(queue.list().requests,[]);
});
