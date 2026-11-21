import test from 'node:test';
import assert from 'node:assert/strict';
import {submitQueuedRequest} from '../build/local-request-queue-browser.mjs';
const queueId='ngs.local.00000000-0000-4000-8000-000000000000';
const receipt={officialRequestId:'request.official.'+'a'.repeat(64),status:'registered'};
const pending=()=>Response.json({queueId,status:'queued'},{status:202});
const settings={jsonPost:body=>({method:'POST',body:JSON.stringify(body)}),pause:async()=>{}};
test('browser posts once and resolves only a matching durable receipt',async()=>{
 const paths=[],cmd={idempotencyKey:'one'};
 const result=await submitQueuedRequest(cmd,{...settings,fetcher:async(path,opt)=>{
  paths.push([path,opt.method??'GET']);
  return paths.length===1?pending():paths.length===2?pending():Response.json({queueId,status:'registered',receipt});
 }});
 assert.deepEqual(paths,[['/api/requests','POST'],['/api/requests?queueId='+queueId,'GET'],['/api/requests?queueId='+queueId,'GET']]);
 assert.equal(result.status,201);
 assert.deepEqual(await result.json(),receipt);
});
test('mismatched receipt and timeout remain queued; no second POST',async()=>{
 const responses=[pending(),Response.json({queueId:queueId.replace(/0$/,'1'),status:'registered',receipt})];
 assert.equal((await submitQueuedRequest({},{...settings,fetcher:async()=>responses.shift()})).status,202);
 let sends=0;
 const result=await submitQueuedRequest({},{...settings,fetcher:async(_,opt)=>{if(opt.method==='POST')sends++;return pending();}});
 assert.equal(result.status,202);assert.equal(sends,1);
});
