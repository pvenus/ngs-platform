import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openLocalRequestQueue } from '../build/local-request-queue.mjs';
import { createLocalRequestQueueMcp } from '../build/local-request-queue-mcp.mjs';
import { loopbackJsonMCP } from '../build/folder-mcp-loopback.mjs';

const envelope={idempotencyKey:'client.opaque',requestType:'audio.generate',payload:{projectId:'binari',title:'fixture'}};
const hash=value=>createHash('sha256').update(value).digest('hex');
const makeReceipt=key=>({officialRequestId:'request.official.'+hash(JSON.stringify(['request.official.v1','local','binari',key])),status:'registered'});
function fixture(t){
 const dir=mkdtempSync(join(tmpdir(),'ngs-local-queue-'));
 const path=join(dir,'queue.sqlite');
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 return path;
}
test('pending row survives restart and exact ACK clears payload with short receipt',t=>{
 const path=fixture(t);let time=100;const now=()=>time;
 const writer=openLocalRequestQueue(path,{now});
 const first=writer.enqueue(envelope);
 assert.equal(statSync(path).mode&0o777,0o600);
 assert.deepEqual(writer.enqueue(envelope),first);
 assert.throws(()=>writer.enqueue({...envelope,payload:{...envelope.payload,title:'mismatch'}}),{status:409});
 writer.close();
 const reader=openLocalRequestQueue(path,{now});
 const receipt=makeReceipt(first.queueId);
 assert.deepEqual(reader.read(first.queueId),first);
 assert.deepEqual(reader.list(),{requests:[{...envelope,idempotencyKey:first.queueId,queueId:first.queueId}]});
 assert.throws(()=>reader.ack(first.queueId,makeReceipt('some-other-key')),{status:409});
 assert.equal(reader.list().requests.length,1);
 assert.deepEqual(reader.ack(first.queueId,receipt),{queueId:first.queueId,status:'acknowledged'});
 assert.equal(reader.list().requests.length,0);
 assert.deepEqual(reader.read(first.queueId),{...first,status:'registered',receipt});
 assert.deepEqual(reader.ack(first.queueId,receipt),{queueId:first.queueId,status:'acknowledged'});
 assert.deepEqual(reader.enqueue(envelope),first);
 time+=15*60*1000;
 assert.equal(reader.read(first.queueId),undefined);
 assert.throws(()=>reader.ack(first.queueId,receipt),{status:404});
 reader.close();
});
test('bounded exact loopback MCP with two open connections and no browser/proxy credentials',async t=>{
 const path=fixture(t);
 const browser=openLocalRequestQueue(path);
 const bridge=openLocalRequestQueue(path);
 const first=browser.enqueue(envelope);
 const server=createLocalRequestQueueMcp(bridge);
 server.listen(0,'127.0.0.1');await once(server,'listening');
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));bridge.close();browser.close();});
 const port=server.address().port;
 const call=loopbackJsonMCP('http://127.0.0.1:'+port+'/mcp');
 const list=await call('ngs_request_queue_list',{limit:1});
 assert.equal(list.requests[0].queueId,first.queueId);
 assert.deepEqual(await call('ngs_request_queue_ack',{queueId:first.queueId,receipt:makeReceipt(first.queueId)}),{queueId:first.queueId,status:'acknowledged'});
 assert.equal(browser.read(first.queueId).status,'registered');
 function probe(headers){
  return new Promise((resolve,reject)=>{
   const req=request({hostname:'127.0.0.1',port,path:'/mcp',method:'POST',headers},res=>{res.resume();resolve(res.statusCode);});
   req.once('error',reject);req.end();
  });
 }
 for(const headers of [{Origin:'http://127.0.0.1:5274'},{Host:'localhost:'+port},{'X-Forwarded-For':'127.0.0.1'},{'Sec-Fetch-Site':'same-origin'}])
  assert.equal(await probe(headers),403);
});

test('bounded pagination crosses acknowledged and expired anchors without starving later rows',t=>{
 const path=fixture(t);let time=10;const queue=openLocalRequestQueue(path,{now:()=>time});
 const queued=Array.from({length:20},(_,i)=>queue.enqueue({...envelope,idempotencyKey:'fixture.'+i}));
 const first=queue.list(16);
 assert.deepEqual(first.requests.map(r=>r.queueId),queued.slice(0,16).map(r=>r.queueId));
 assert.match(first.nextCursor,/^q1\.[1-9][0-9]*$/);
 queue.ack(queued[15].queueId,makeReceipt(queued[15].queueId));
 time+=15*60*1000;
 const newest=queue.enqueue({...envelope,idempotencyKey:'newest'});
 assert.equal(queue.read(queued[15].queueId),undefined);
 const later=queue.list(16,first.nextCursor);
 assert.deepEqual(later.requests.map(r=>r.queueId),[...queued.slice(16),newest].map(r=>r.queueId));
 assert.equal(later.nextCursor,undefined);
 assert.throws(()=>queue.list(16,'garbage'),{status:400});
 queue.close();
});
