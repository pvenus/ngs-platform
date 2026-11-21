import assert from 'node:assert/strict';
import {openLocalRequestQueue} from '../build/local-request-queue.mjs';
import {existsSync,mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';

const draft={requestType:'npc.workflow',idempotencyKey:'qa-one-stop',payload:{
 schemaVersion:'ngs.npc-one-stop.v1',projectId:'binari',
 character:{npcId:'npc.qa-one-stop',name:'테스트',slug:'qa-one-stop',role:'마을 서기',actId:'story.main.act01',chapterId:'chapter01'},
 intent:'지역 인물을 기획해 주세요.',sourceRefs:['비나리 마스터 컨셉'],includeCombat:false,
}};
async function listen(t,server){
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port;
}

test('generic POST queues exactly one request behind local auth; no direct RS or official request DB',async t=>{
 const scratch=mkdtempSync(join(realpathSync(tmpdir()),'ngs-queued-request-')),root=join(scratch,'project-catalog');
 const queue=openLocalRequestQueue(join(scratch,'queue.sqlite'));
 t.after(()=>{queue.close();rmSync(scratch,{recursive:true,force:true});});
 const origin=await listen(t,createLocalProjectPageServer({root,requestQueue:queue}));
 const session=await fetch(origin+'/__npcgen_session'),c=(await session.json()),cookie=session.headers.get('set-cookie').split(';')[0];
 const auth={cookie,'x-npcgen-csrf':c.csrfToken,'x-npcgen-frontend-context':c.contextId,origin,'content-type':'application/json'};
 const post=(input=draft,headers=auth,path='/api/requests')=>fetch(origin+path,{method:'POST',headers,body:JSON.stringify(input)});
 assert.equal((await post(draft,{...auth,cookie:''})).status,401);
 assert.equal((await post(draft,{...auth,'x-npcgen-csrf':'incorrect'})).status,403);
 assert.equal((await post({...draft,payload:{...draft.payload,projectId:'outside'}})).status,403);
 assert.equal((await post({...draft,operation:'submit'})).status,400);
 assert.equal((await post(draft,auth,'/api/npc-one-stop')).status,404);
 assert.equal((await post(draft,auth,'/mcp')).status,404);
 assert.equal(queue.list().requests.length,0);
 const first=await post();
 assert.equal(first.status,202);const queued=await first.json();
 assert.equal(queued.status,'queued');
 assert.deepEqual(queue.list().requests,[{queueId:queued.queueId,requestType:draft.requestType,idempotencyKey:queued.queueId,payload:draft.payload}]);
 assert.deepEqual(await (await post()).json(),queued);
 assert.equal(queue.list().requests.length,1);
 const conflict=await post({...draft,payload:{...draft.payload,intent:'변경된 요청'}});
 assert.equal(conflict.status,409);
 assert.deepEqual(await conflict.json(),{error:'NGS_REQUEST_QUEUE_IDEMPOTENCY_CONFLICT'});
 const npcDir=join(root,'binari','npcs','npc.ch1_dajeong');
 mkdirSync(npcDir,{recursive:true,mode:0o700});
 writeFileSync(join(npcDir,'metadata.json'),JSON.stringify({id:'npc.ch1_dajeong',name:'다정',chapters:['chapter01']}),{mode:0o600});
 writeFileSync(join(root,'binari','npcs','metadata.json'),JSON.stringify({actId:'story.main.act01',characterOrder:['npc.ch1_dajeong']}),{mode:0o600});
 const npcReplace={...draft,idempotencyKey:'replace-existing',payload:{...draft.payload,
  schemaVersion:'ngs.npc-one-stop.replace.v1',character:{...draft.payload.character,npcId:'npc.ch1_dajeong',slug:'ch1_dajeong'}}};
 const beforeReplace=queue.list().requests.length;
 assert.equal((await post({...npcReplace,payload:{...npcReplace.payload,schemaVersion:'ngs.npc-one-stop.v1'}})).status,409);
 assert.equal((await post({...npcReplace,payload:{...npcReplace.payload,character:{...npcReplace.payload.character,npcId:'npc.missing'}}})).status,404);
 assert.equal((await post({...npcReplace,payload:{...npcReplace.payload,character:{...npcReplace.payload.character,slug:'changed'}}})).status,400);
 assert.equal(queue.list().requests.length,beforeReplace);
 assert.equal((await post(npcReplace)).status,202);
 assert.deepEqual(queue.list().requests.at(-1).payload,npcReplace.payload);
 assert.equal(existsSync(join(scratch,'provisional-requests')),false);
 assert.equal(existsSync(join(scratch,'official-requests.sqlite')),false);
});
