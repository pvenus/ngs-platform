import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {codexViewerClient} from '../lib/codex-transport.mjs';
import {codexViewerRemote} from '../lib/native-mcp.mjs';
import {appendViewerDiscovery} from '../../space-hosting/overlay/build/space-viewer-mcp.mjs';

test('Codex direct tool call pins approved tools and never starts an AI turn',async t=>{
 const seen=[],children=[];
 const client=codexViewerClient({binary:'/fixture/codex',server:'codex_apps',spawnChild(binary,args){
  assert.equal(binary,'/fixture/codex');assert.deepEqual(args,['app-server','proxy']);
  const child=new EventEmitter();children.push(child);child.stdout=new PassThrough();
  child.kill=()=>child.emit('exit');
  child.stdin=new Writable({write(chunk,_enc,next){
   const m=JSON.parse(chunk.toString());seen.push(m);next();
   if(m.id===undefined)return;
   const result=m.method==='thread/start'?{thread:{id:'ephemeral-thread'}}:
    m.method==='mcpServer/tool/call'?{structuredContent:{status:200,manifest:{projectId:'binari',files:[]}},content:[],isError:false}:{};
   queueMicrotask(()=>child.stdout.write(JSON.stringify({id:m.id,result})+'\n'));
  }});
  return child;
 }});
 t.after(()=>client.close());
 const remote=codexViewerRemote({client,origin:'https://binari.example.test'});
 assert.deepEqual(JSON.parse((await remote('/api/viewer/manifest')).bytes),{projectId:'binari',files:[]});
 assert.deepEqual(seen.map(x=>x.method),['initialize','initialized','thread/start','mcpServer/tool/call']);
 assert.deepEqual(seen.at(-2).params,{ephemeral:true,sandbox:'read-only',approvalPolicy:'never'});
 assert.deepEqual(seen.at(-1).params,{server:'codex_apps',threadId:'ephemeral-thread',tool:'npcgen.ngs_viewer_manifest',arguments:{}});
 await assert.rejects(client.tool('write',{}),/VIEWER_CODEX_TOOL_DENIED/);
 assert.equal(seen.length,4);
 children[0].emit('exit');
 await remote('/api/viewer/manifest');
 assert.equal(children.length,2);
});
test('closed Codex proxy reports reconnect, never clears replica data',async()=>{
 const client=codexViewerClient({binary:'/fixture/codex',server:'team-binari',spawnChild(){
  const c=new EventEmitter();c.stdout=new PassThrough();c.stdin=new PassThrough();c.kill=()=>{};
  queueMicrotask(()=>c.emit('exit'));return c;
 }});
 await assert.rejects(client.tool('ngs_viewer_manifest',{}),{message:'VIEWER_CODEX_CONNECTION_REQUIRED'});
});
test('native discovery augments only successful authenticated discovery',async()=>{
 const fixture=identity=>new Request('https://binari.example.test/mcp',{method:'POST',headers:identity,
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})});
 const reply=()=>Response.json({jsonrpc:'2.0',id:1,result:{tools:[{name:'existing'}]}});
 const approved=await appendViewerDiscovery(fixture({'oai-authenticated-user-id':'test','oai-authenticated-user-email':'test@example.test'}),reply());
 assert.deepEqual((await approved.json()).result.tools.map(x=>x.name),['existing','ngs_viewer_manifest','ngs_viewer_file_chunk','ngs_viewer_request_session','ngs_viewer_request_status','ngs_viewer_request_submit']);
 assert.equal((await (await appendViewerDiscovery(fixture({}),reply())).json()).result.tools.length,1);
});
