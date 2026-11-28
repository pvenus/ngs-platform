import assert from 'node:assert/strict';
import {test} from 'node:test';
import {forwardViewerRequest} from '../lib/request-forward.mjs';
import {backgroundViewerSync} from '../lib/background.mjs';
import {openMirror} from '../lib/mirror.mjs';
import {realpath,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const accepted={status:'queued',queueId:'ngs.space.e4913818-1123-46c4-a6ee-eedb416b96c6'};
test('one immediate forward: rejection or missing reply never retries or reports acceptance',async()=>{
 const command={requestType:'test',payload:{}};
 for(const [upstream,status] of [[{status:202,receipt:accepted},202],[{status:403},403],[{status:202},502],[null,502]]){
  let attempts=0;
  const pending=forwardViewerRequest(command,async sent=>{
   attempts++;assert.equal(sent,command);
   if(!upstream)throw Error('response lost after send');
   return upstream;
  });
  assert.equal(attempts,1);
  const result=await pending;
  assert.equal(result.status,status);
  assert.equal(attempts,1);
 }
});
test('slow scheduled sync coalesces repeated starts instead of launching or queueing another run',{skip:process.platform==='win32'},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'ngs-sync-serial-')));
 const mirror=await openMirror(root);
 let calls=0,release,entered;
 const blocked=new Promise(resolve=>{release=resolve;});
 const started=new Promise(resolve=>{entered=resolve;});
 const bg=backgroundViewerSync({mirror,intervalMs:60_000,remote:async()=>{
  calls++;entered();await blocked;
  return {status:200,bytes:Buffer.from(JSON.stringify({projectId:'binari',resources:['project'],files:[]}))};
 }});
 t.after(async()=>{release();await bg.close();mirror.close();await rm(root,{recursive:true,force:true});});
 const run=bg.start();
 await started;
 assert.equal(bg.start(),run);
 assert.equal(bg.start(),run);
 assert.equal(calls,1);
 release();
 await run;
 assert.equal(calls,1);
});
