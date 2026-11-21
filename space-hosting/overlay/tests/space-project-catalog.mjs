import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
import test from 'node:test';
import {SpaceProjectCatalog,projectCatalogResponse,projectCatalogMcp} from '../build/space-project-catalog.mjs';
import {rejectCleanSpaceRequest} from '../build/clean-space-guard.mjs';
import {createSharedNgsResponse} from '../build/shared-ngs-response.mjs';

function dbFixture(t){
 const sql=new DatabaseSync(':memory:');t.after(()=>sql.close());
 const db={prepare(query){
  const q=sql.prepare(query);let v=[];
  return {bind(...values){v=values;return this;},async run(){return q.run(...v);},
   async first(){return q.get(...v)??null;},async all(){return {results:q.all(...v)};}};
 }};
 return {db,sql,migrate:()=>sql.exec(readFileSync(new URL('../drizzle/0011_space_project_catalog_relay.sql',import.meta.url),'utf8'))};
}
const origin='https://site.example',path='/api/space/project-catalog';
const auth={'oai-authenticated-user-id':'signed-actor','oai-authenticated-user-email':'actor@fixture.test'};
const authFor=id=>({...auth,'oai-authenticated-user-id':id});
const access={authorize:async u=>u.userId!=='denied'};
const listing={projects:[{projectId:'binari',name:'비나리',iconUrl:null,needsRefresh:false}]};
test('same-origin admit, true hosted session and actor-bound exact poll use only temporary state',async t=>{
 const {db,sql,migrate}=dbFixture(t);
 const handle=(url,init)=>projectCatalogResponse(new Request(origin+url,init),db,access);
 const shell=createSharedNgsResponse(new Map);
 assert.equal(shell(new Request(origin+'/__npcgen_session',{headers:auth})).status,503);
 assert.equal(shell(new Request(origin+'/__npcgen_session',{headers:auth}),{catalogRelay:true}),null);
 let r=await handle('/__npcgen_session',{headers:auth});assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{state:'authenticated',backend:'space',readOnly:true});assert(!r.headers.has('set-cookie'));
 r=await handle('/__npcgen_session',{headers:authFor('denied')});assert.equal(r.status,403);
 assert.equal(sql.prepare('SELECT count(*) AS n FROM sqlite_schema').get().n,0);
 r=await handle(path,{method:'POST',body:'{}',headers:{...auth,origin:'https://other.example','Content-Type':'application/json'}});
 assert.equal(r.status,403);
 const create=()=>handle(path,{method:'POST',body:'{}',headers:{...auth,origin,'Content-Type':'application/json'}});
 r=await create();assert.equal(r.status,503);assert.equal(sql.prepare('SELECT count(*) AS n FROM sqlite_schema').get().n,0);
 migrate();
 r=await create();assert.equal(r.status,202);const {requestId}=await r.json();
 assert.match(requestId,/^space\.catalog\.[a-f0-9-]{36}$/u);
 assert.deepEqual(await (await create()).json(),{requestId,status:'pending'});
 r=await handle(path+'?requestId='+requestId,{headers:authFor('another')});assert.equal(r.status,404);
 const m=new SpaceProjectCatalog(db);
 assert.deepEqual(await m.pending(),{requests:[{requestId}]});
 assert.deepEqual(await m.settle(requestId,listing),{requestId,status:'delivered'});
 r=await handle(path+'?requestId='+requestId,{headers:auth});assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{requestId,status:'ready',...listing});
 assert.deepEqual(await m.pending(),{requests:[]});
 const names=sql.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(x=>x.name);
 assert.deepEqual(names,['ngs_ephemeral_project_catalog_v1']);
});
test('limited catalog RPC needs existing owner and cannot invoke ordinary write/read tools',async t=>{
 const {db,migrate}=dbFixture(t);migrate();
 const relay=new SpaceProjectCatalog(db);
 const {requestId}=await relay.put('signed-actor');
 const cmd=(command,plus={})=>new Request(origin+'/mcp',{method:'POST',headers:{...auth,'Content-Type':'application/json',...plus},
  body:JSON.stringify({jsonrpc:'2.0',id:7,method:'tools/call',params:{name:'npc_mirror_dispatch',arguments:{command}}})});
 const options=allow=>({catalogCall:(req,m)=>projectCatalogMcp(req,m,db,{authorizeOwner:async()=>allow})});
 const pending={action:'project-catalog-read-pending'};
 let r=await rejectCleanSpaceRequest(cmd(pending),options(false));assert.equal(r.status,403);
 r=await rejectCleanSpaceRequest(cmd(pending,{Origin:origin}),options(true));assert.equal(r.status,403);
 r=await rejectCleanSpaceRequest(cmd(pending),options(true));assert.equal(r.status,200);
 assert.deepEqual((await r.json()).result.structuredContent,{requests:[{requestId}]});
 for(const action of ['audio-request-receipt','project-display-publish','manifest-finish']){
  r=await rejectCleanSpaceRequest(cmd({action,projectId:'binari'}),options(true));assert.equal(r.status,403);
 }
 const post={action:'project-catalog-read-reply',requestId,result:listing};
 r=await rejectCleanSpaceRequest(cmd({...post,result:{projects:[{...listing.projects[0],projectId:'other'}]}}),options(true));
 assert.equal((await r.json()).result.isError,true);
 r=await rejectCleanSpaceRequest(cmd(post),options(true));
 assert.deepEqual((await r.json()).result.structuredContent,{requestId,status:'delivered'});
 assert.deepEqual(await relay.get('signed-actor',requestId),{requestId,status:'ready',...listing});
});
test('at most 16 unexpired requests are relayed and old metadata cannot be returned after 60 seconds',async t=>{
 const {db,migrate}=dbFixture(t);migrate();let now=0;
 const relay=new SpaceProjectCatalog(db,{now:()=>now});
 const {requestId}=await relay.put('first');
 for(let i=0;i<17;i++)await relay.put('actor'+i);
 assert.equal((await relay.pending()).requests.length,16);
 await relay.settle(requestId,listing);
 await assert.rejects(relay.settle(requestId,{projects:[]}),/RECEIPT_CONFLICT/);
 now=60_000;
 assert.deepEqual(await relay.pending(),{requests:[]});
 await assert.rejects(relay.get('first',requestId),/EXPIRED/);
 await assert.rejects(relay.settle(requestId,listing),/EXPIRED/);
});

test('actual broker protocol discovery reaches exact catalog tools, but negotiation never invokes owner or DB',async t=>{
 const protocol='2026-07-28';
 const sends=(method,params,extra={})=>new Request(origin+'/mcp',{method:'POST',headers:{...auth,
  'Content-Type':'application/json','Accept':'application/json, text/event-stream','mcp-method':method,
  'mcp-protocol-version':protocol,...extra},body:JSON.stringify({jsonrpc:'2.0',id:11,method,params})});
 let owners=0;
 const {db,sql,migrate}=dbFixture(t);
 const opt={catalogCall:(req,m)=>projectCatalogMcp(req,m,db,{authorizeOwner:async()=>{owners++;return true;}})};
 const discovery={clientInfo:{name:'fixture broker',version:'1'},supportedVersions:[protocol],_meta:{fixture:true}};
 let r=await rejectCleanSpaceRequest(sends('server/discover',discovery),opt);
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{jsonrpc:'2.0',id:11,result:{supportedVersions:[protocol],capabilities:{tools:{}}}});
 r=await rejectCleanSpaceRequest(sends('server/discover',[]),opt);assert.equal(r.status,400);
 r=await rejectCleanSpaceRequest(sends('server/discover',discovery,{Origin:'https://other.example'}),opt);assert.equal(r.status,403);
 r=await rejectCleanSpaceRequest(sends('server/discover',discovery,{'oai-authenticated-user-id':''}),opt);assert.equal(r.status,401);
 r=await rejectCleanSpaceRequest(sends('initialize',{protocolVersion:'2024-11-05',clientInfo:{name:'legacy',version:'1'},capabilities:{}}),opt);
 assert.equal((await r.json()).result.protocolVersion,'2024-11-05');
 r=await rejectCleanSpaceRequest(sends('tools/list',{_meta:{fixture:true}}),opt);
 assert.deepEqual((await r.json()).result.tools.map(x=>x.name),['npc_mirror_dispatch']);
 assert.equal(owners,0);assert.equal(sql.prepare('SELECT count(*) AS n FROM sqlite_schema').get().n,0);
 migrate();
 const call={name:'npc_mirror_dispatch',arguments:{command:{action:'project-catalog-read-pending'}},_meta:{fixture:true}};
 r=await rejectCleanSpaceRequest(sends('tools/call',call,{Origin:origin}),opt);assert.equal(r.status,403);
 r=await rejectCleanSpaceRequest(sends('tools/call',call),opt);assert.equal(r.status,200);
 assert.deepEqual((await r.json()).result.structuredContent,{requests:[]});assert.equal(owners,1);
});
