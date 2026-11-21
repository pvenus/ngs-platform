import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createSpaceCatalogWorker,readBinariCatalog} from '../build/space-catalog-worker.mjs';
import {createCodexOwnerMCP} from '../build/space-catalog-owner-mcp.mjs';
const requestId='space.catalog.11111111-1111-4111-8111-111111111111';
const data=Buffer.from('{"name":"비나리","private":"not transmitted"}');
const sha=createHash('sha256').update(data).digest('hex');
const output={projects:[{projectId:'binari',name:'비나리',iconUrl:null,needsRefresh:false}]};
const fixture=()=>({
 async discover(){return {projects:['hidden-project','binari']};},
 async compare(scope,files){
  assert.equal(scope,'binari');assert.deepEqual(files,[]);
  return {scope,groups:[{folder:'',files:[{path:'project.json',sha256:sha,size:data.length}]},
   {folder:'npcs',files:[{path:'private.json',sha256:sha,size:16}]}]};
 },
 file(scope,path,digest,size){
  assert.deepEqual([scope,path,digest,size],['binari','project.json',sha,data.length]);
  return {body:new Blob([data]).stream()};
 }
});
test('only digest verified Binari name is sent; exact ACK counts one',async()=>{
 const commands=[];
 const worker=createSpaceCatalogWorker({pds:fixture(),ownerCall:async command=>{
  commands.push(command);
  if(command.action==='project-catalog-read-pending')return {requests:[{requestId}]};
  return {requestId,status:'delivered'};
 }});
 assert.deepEqual(await worker.readiness(),{pending:1,projects:1});
 assert.deepEqual(commands,[{action:'project-catalog-read-pending'}]);
 assert.deepEqual(await worker.pollOnce(),{delivered:1,pending:0});
 assert.deepEqual(commands.at(-1),{action:'project-catalog-read-reply',requestId,result:output});
});
test('no ack for stale source, invalid pending ids or failed delivery',async()=>{
 const pds=fixture();pds.file=()=>({body:new Blob([Buffer.alloc(data.length)]).stream()});
 let reads=0;
 const worker=createSpaceCatalogWorker({pds,ownerCall:async command=>{
  assert.equal(command.action,'project-catalog-read-pending');reads++;return {requests:[{requestId}]};
 }});
 await assert.rejects(worker.pollOnce(),/SOURCE_UNAVAILABLE/);assert.equal(reads,1);
 const bad=createSpaceCatalogWorker({pds,ownerCall:async()=>({requests:[{requestId,scope:'other'}]})});
 await assert.rejects(bad.pollOnce(),/SOURCE_UNAVAILABLE/);
 const unmatched=createSpaceCatalogWorker({pds:fixture(),ownerCall:async command=>command.action==='project-catalog-read-pending'?
  {requests:[{requestId}]}:{requestId:'other',status:'delivered'}});
 assert.deepEqual(await unmatched.pollOnce(),{delivered:0,pending:1});
});
test('absence comes only from successful authoritative discovery',async()=>{
 assert.deepEqual(await readBinariCatalog({discover:async()=>({projects:['other']})}),{projects:[]});
 await assert.rejects(readBinariCatalog({discover:async()=>{throw Error('offline');}}),/offline/);
});
test('installed transport protocol twin only invokes existing catalog actions and never answers approval',async t=>{
 const program=`
 import {createInterface} from 'node:readline';
 let init=false;
 for await(const line of createInterface({input:process.stdin})){
 const {id,method,params}=JSON.parse(line);
 const send=result=>console.log(JSON.stringify({id,result}));
 if(method==='initialize')send({});
 else if(method==='initialized')init=true;
 else if(method==='thread/start'&&init&&params.ephemeral)send({thread:{id:'fixture'}});
 else if(method==='mcpServerStatus/list'&&params.serverName==='codex_apps')send({tools:['npcgen.npc_mirror_dispatch']});
 else if(method==='mcpServer/tool/call'&&params.tool==='npcgen.npc_mirror_dispatch'){
  if(params.arguments.command.action==='project-catalog-read-pending')send({isError:false,structuredContent:{requests:[]}});
  else console.log(JSON.stringify({id:123,method:'approval'}));
 }else process.exit(5);
 }`;
 const adapter=createCodexOwnerMCP({start:()=>spawn(process.execPath,['--input-type=module','-e',program],{stdio:['pipe','pipe','ignore']})});
 t.after(()=>adapter.close());
 await assert.rejects(adapter.callSite({action:'audio-request-pending'}),/MCP_UNAVAILABLE/);
 assert.deepEqual(await adapter.callSite({action:'project-catalog-read-pending'}),{requests:[]});
 await assert.rejects(adapter.callSite({action:'project-catalog-read-reply',requestId,result:output}),/MCP_UNAVAILABLE/);
});
