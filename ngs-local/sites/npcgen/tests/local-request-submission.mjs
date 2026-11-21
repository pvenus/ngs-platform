import assert from 'node:assert/strict';
import {createServer} from 'node:http';
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

test('generic POST submits exactly one MCP business tool; old intake and local request DB are not used',async t=>{
 const scratch=mkdtempSync(join(realpathSync(tmpdir()),'ngs-direct-request-')),root=join(scratch,'project-catalog');
 t.after(()=>rmSync(scratch,{recursive:true,force:true}));
 const receipt={officialRequestId:'request.official.fixture',status:'registered'};
 const calls=[];
 let outcome=receipt;
 const service=await listen(t,createServer(async(req,res)=>{
  assert.equal(req.url,'/mcp');assert.equal(req.headers.origin,undefined);assert.equal(req.headers.cookie,undefined);
  let raw='';for await(const c of req)raw+=c;
  const x=JSON.parse(raw);
  if(x.method==='notifications/initialized'){res.writeHead(202).end();return;}
  let result;
  if(x.method==='initialize')result={protocolVersion:'2025-06-18',capabilities:{tools:{}}};
  else{
   assert.equal(x.method,'tools/call');assert.equal(x.params.name,'request_submit');calls.push(x.params.arguments);
   result={isError:outcome!==receipt,structuredContent:outcome,content:[]};
  }
  res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({jsonrpc:'2.0',id:x.id,result}));
 }));
 const origin=await listen(t,createLocalProjectPageServer({root,requestMcpUrl:service+'/mcp'}));
 const session=await fetch(origin+'/__npcgen_session'),c=(await session.json()),cookie=session.headers.get('set-cookie').split(';')[0];
 const auth={cookie,'x-npcgen-csrf':c.csrfToken,'x-npcgen-frontend-context':c.contextId,origin,'content-type':'application/json'};
 const post=(input=draft,headers=auth,path='/api/requests')=>fetch(origin+path,{method:'POST',headers,body:JSON.stringify(input)});
 assert.equal((await post(draft,{...auth,cookie:''})).status,401);
 assert.equal((await post(draft,{...auth,'x-npcgen-csrf':'incorrect'})).status,403);
 assert.equal((await post({...draft,payload:{...draft.payload,projectId:'outside'}})).status,403);
 assert.equal((await post({...draft,operation:'submit'})).status,400);
 assert.equal((await post(draft,auth,'/api/npc-one-stop')).status,404);
 assert.equal((await post(draft,auth,'/mcp')).status,404);
 assert.equal(calls.length,0);
 const first=await post();
 assert.equal(first.status,201);assert.deepEqual(await first.json(),receipt);
 assert.deepEqual(calls,[{sourceId:'local',...draft}]);
 assert.deepEqual(await (await post()).json(),receipt);
 assert.deepEqual(calls[0],calls[1]);
 outcome={error:'OFFICIAL_REQUEST_NPC_ALREADY_REGISTERED',status:409};
 const conflict=await post({...draft,idempotencyKey:'other'});
 assert.equal(conflict.status,409);
 assert.deepEqual(await conflict.json(),{error:'OFFICIAL_REQUEST_NPC_ALREADY_REGISTERED'});
 outcome={error:'arbitrary',status:400};
 const unexpected=await post();
 assert.equal(unexpected.status,503);
 assert.deepEqual(await unexpected.json(),{error:'REQUEST_SERVICE_UNAVAILABLE'});
 const npcDir=join(root,'binari','npcs','npc.ch1_dajeong');
 mkdirSync(npcDir,{recursive:true,mode:0o700});
 writeFileSync(join(npcDir,'metadata.json'),JSON.stringify({id:'npc.ch1_dajeong',name:'다정',chapters:['chapter01']}),{mode:0o600});
 writeFileSync(join(root,'binari','npcs','metadata.json'),JSON.stringify({actId:'story.main.act01',characterOrder:['npc.ch1_dajeong']}),{mode:0o600});
 outcome=receipt;
 const npcReplace={...draft,idempotencyKey:'replace-existing',payload:{...draft.payload,
  schemaVersion:'ngs.npc-one-stop.replace.v1',character:{...draft.payload.character,npcId:'npc.ch1_dajeong',slug:'ch1_dajeong'}}};
 const beforeReplace=calls.length;
 assert.equal((await post({...npcReplace,payload:{...npcReplace.payload,schemaVersion:'ngs.npc-one-stop.v1'}})).status,409);
 assert.equal((await post({...npcReplace,payload:{...npcReplace.payload,character:{...npcReplace.payload.character,npcId:'npc.missing'}}})).status,404);
 assert.equal((await post({...npcReplace,payload:{...npcReplace.payload,character:{...npcReplace.payload.character,slug:'changed'}}})).status,400);
 assert.equal(calls.length,beforeReplace);
 assert.equal((await post(npcReplace)).status,201);
 assert.deepEqual(calls.at(-1),{sourceId:'local',...npcReplace});
 assert.equal(existsSync(join(scratch,'provisional-requests')),false);
 assert.equal(existsSync(join(scratch,'official-requests.sqlite')),false);
});
