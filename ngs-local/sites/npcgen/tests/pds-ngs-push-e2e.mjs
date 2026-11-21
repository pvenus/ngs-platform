import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {createInterface} from 'node:readline';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createFolderMcpClient} from '../build/folder-mcp-client.mjs';
import {loopbackJsonMCP} from '../build/folder-mcp-loopback.mjs';
import {pushProjectFiles} from '../build/pds-mcp-file-sync.mjs';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';

const pdsSource=process.env.NGS_EXISTING_PDS_SOURCE;
const pdsPython=process.env.NGS_EXISTING_PDS_PYTHON??'python3';
const realPds=`
from http.server import ThreadingHTTPServer
from project_data_service.http_server import Handler
from project_data_service.project_folders import configured
import sys
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
server.project_folders=configured(sys.argv[1],'127.0.0.1',validate_mount=False)
print(server.server_port,flush=True)
server.serve_forever(poll_interval=.01)
`;
const listen=async server=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 return 'http://127.0.0.1:'+server.address().port;
};

test('unchanged PDS MCP pushes a multi-chunk replica, page reads local only and second pass sends no bytes',
 {skip:!pdsSource,timeout:20_000},async()=>{
  const temp=mkdtempSync(join(realpathSync(tmpdir()),'ngs-file-push-e2e-'));
  const canonical=join(temp,'canonical-files'),replica=join(temp,'replica');
  const path='audio/fixture.wav',original=Buffer.concat([Buffer.alloc(1024*1024,0x21),Buffer.from('end')]);
  mkdirSync(join(canonical,'binari/audio/.deleted'),{recursive:true,mode:0o700});
  mkdirSync(replica,{mode:0o700});
  writeFileSync(join(canonical,'binari/project.json'),JSON.stringify({projectId:'binari',name:'비나리 테스트'}),{mode:0o600});
  writeFileSync(join(canonical,'binari',path),original,{mode:0o600});
  writeFileSync(join(canonical,'binari/audio/.deleted/old.wav'),'excluded',{mode:0o600});
  const py=spawn(pdsPython,['-u','-c',realPds,canonical],{
   env:{...process.env,PYTHONPATH:pdsSource,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
  let stderr='';py.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4096);});
  const ready=createInterface(py.stdout);
  const exited=once(py,'exit');
  const servers=[];
  try{
   const port=await Promise.race([once(ready,'line').then(([line])=>Number(line)),
    exited.then(([code])=>{throw Error('Fixture PDS exited '+code+' '+stderr);})]);
   assert.ok(port>0);
   const pdsCall=loopbackJsonMCP('http://127.0.0.1:'+port+'/mcp');
   let chunks=0;
   const pds=createFolderMcpClient({call:async(name,...args)=>{
    if(name==='npc_folder_file_chunk')chunks++;
    return pdsCall(name,...args);
   }});
   const {openLocalRequestQueue}=await import('../build/local-request-queue.mjs');
   const {createLocalRequestQueueMcp}=await import('../build/local-request-queue-mcp.mjs');
   const queue=openLocalRequestQueue(join(temp,'draft.sqlite'));
   const {createLocalFileSyncReceiver}=await import('../build/local-replica-file-receiver.mjs');
   let now=0; const fileSync=createLocalFileSyncReceiver({root:replica,projects:["binari"],now:()=>now});
   const receiver=createLocalRequestQueueMcp(queue,{fileSync});
   receiver.on("close",()=>{fileSync.close();queue.close();});
   servers.push(receiver);
   const ngs=loopbackJsonMCP(await listen(receiver)+'/mcp');
   const page=createLocalProjectPageServer({root:replica,fileSyncMode:'push',mcpUrl:'not-used'});
   servers.push(page);
   const web=await listen(page);
   assert.deepEqual(await pds.discover(),{projects:['binari']});
   assert.deepEqual(await pushProjectFiles({scope:'binari',pds,ngs}),{ok:true,written:2});
   assert.ok(chunks>=3);const transferred=chunks;
   const output=join(replica,'binari',path);
   assert.deepEqual(readFileSync(output),original);
   assert.equal(existsSync(join(replica,'binari/audio/.deleted')),false);
   const inode=statSync(output).ino;
   now+=60_000;
   assert.deepEqual(await pushProjectFiles({scope:'binari',pds,ngs}),{ok:true,written:0});
   assert.equal(chunks,transferred);
   assert.equal(statSync(output).ino,inode);
   const updated=Buffer.from('only this file changed');
   writeFileSync(join(canonical,'binari',path),updated,{mode:0o600});
   now+=60_000;
   assert.deepEqual(await pushProjectFiles({scope:'binari',pds,ngs}),{ok:true,written:1});
   assert.equal(chunks,transferred+1);
   assert.deepEqual(readFileSync(output),updated);
   const session=await fetch(web+'/__npcgen_session');
   const local=await(await fetch(web+'/api/project-folders',{headers:{cookie:session.headers.get('set-cookie').split(';')[0]}})).json();
   assert.equal(local.projects[0].name,'비나리 테스트');
  }finally{
   await Promise.all(servers.reverse().map(server=>new Promise(resolve=>server.close(resolve))));
   ready.close();py.kill();await exited.catch(()=>{});
   rmSync(temp,{recursive:true,force:true});
  }
 });
