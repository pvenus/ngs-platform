/** Same-Mac NGS queue -> existing official Request Service, both over MCP. */
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {loopbackJsonMCP} from './folder-mcp-loopback.mjs';

const listTool='ngs_request_queue_list',ackTool='ngs_request_queue_ack';
const rsTool='request_submit';
const projectId='binari',sourceId='local',limit=16;
const kinds=new Set(['npc.workflow','concept.category.workflow','npc.planning.add','npc.planning.update','audio.generate','audio.delete']);
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const queueId=v=>typeof v==='string'&&v.length===46&&/^ngs\.local\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const officialIdFor=key=>'request.official.'+createHash('sha256').update(JSON.stringify(['request.official.v1',sourceId,projectId,key])).digest('hex');
const falseReceipt=()=>Error('NGS_RS_RECEIPT_UNCONFIRMED');
const localUnavailable=()=>Error('NGS_RS_MCP_UNAVAILABLE');
const invalid=()=>Error('NGS_REQUEST_QUEUE_RESPONSE_INVALID');
const definitive=new Map([
 ['REQUEST_SUBMIT_INVALID',400],['NGS_ONE_STOP_PAYLOAD_INVALID',400],['NGS_CONCEPT_CATEGORY_PAYLOAD_INVALID',400],
 ['NGS_NPC_PLANNING_ADD_PAYLOAD_INVALID',400],['NGS_NPC_PLANNING_UPDATE_PAYLOAD_INVALID',400],
 ['NGS_AUDIO_GENERATE_PAYLOAD_INVALID',400],['NGS_AUDIO_DELETE_PAYLOAD_INVALID',400],
 ['OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT',409],['OFFICIAL_REQUEST_NPC_ALREADY_REGISTERED',409],
 ['OFFICIAL_REQUEST_CONCEPT_CATEGORY_ALREADY_REGISTERED',409],['OFFICIAL_AUDIO_DELETE_TARGET_NOT_COMPLETED',404],
 ['OFFICIAL_AUDIO_DELETE_ALREADY_REGISTERED',409],
]);

function verifyReceipt(r,idempotencyKey){
 if(!exact(r,['officialRequestId','status'])||r.officialRequestId!==officialIdFor(idempotencyKey)||r.status!=='registered')
  throw falseReceipt();
 return r;
}
const validCursor=v=>typeof v==='string'&&/^q1\.[1-9][0-9]{0,15}$/.test(v)&&!/[\r\n]/.test(v)&&Number.isSafeInteger(Number(v.slice(3)));
function parseBatch(batch,previous){
 if(!exact(batch,['requests'])&&!exact(batch,['requests','nextCursor'])||!Array.isArray(batch.requests)||
  batch.requests.length>limit||Object.hasOwn(batch,'nextCursor')!==(batch.requests.length===limit))
  throw invalid();
 if(Object.hasOwn(batch,'nextCursor')&&(!validCursor(batch.nextCursor)||
  previous&&Number(batch.nextCursor.slice(3))<=Number(previous.slice(3))))throw invalid();
 const ids=new Set(),usedKeys=new Set();
 for(const r of batch.requests){
  if(!exact(r,['queueId','requestType','idempotencyKey','payload'])||!queueId(r.queueId)||r.queueId!==r.idempotencyKey||
     ids.has(r.queueId)||usedKeys.has(r.idempotencyKey))throw invalid();
  ids.add(r.queueId);usedKeys.add(r.idempotencyKey);
 }
 return {rows:batch.requests,next:batch.nextCursor??null};
}

export function createRSQueueConsumer({callNGS,callRS,now=Date.now}){
 if(typeof callNGS!=='function'||typeof callRS!=='function')throw invalid();
 const memo=new Map();
 let cursor=null;
 const fingerprint=row=>createHash('sha256').update(JSON.stringify([row.idempotencyKey,row.requestType,row.payload])).digest('hex');
 function postpone(row,entry,error,retryMs){
  memo.delete(row.queueId);
  memo.set(row.queueId,{...entry,error,until:now()+retryMs});
  if(memo.size>256)memo.delete(memo.keys().next().value);
 }
 async function work(){
  const listArgs=cursor?{limit,cursor}:{limit};
  const {rows,next}=parseBatch(await callNGS(listTool,listArgs,{limit:4*1024*1024}),cursor);
  // NGS returns an opaque cursor independent of ACK/removal. A full page
  // advances even if its deliveries were all rejected or remain unresolved.
  cursor=next;
  const result={seen:rows.length,acknowledged:0,unresolved:0,rejected:0,deferred:0};
  for(const row of rows){
   if(!kinds.has(row.requestType)||row.payload===null||typeof row.payload!=='object'||Array.isArray(row.payload)||
      row.payload.projectId!==projectId||Buffer.byteLength(JSON.stringify(row.payload))>90*1024){result.rejected++;continue;}
   const stamp=fingerprint(row);
   let entry=memo.get(row.queueId);
   if(entry&&entry.stamp!==stamp){result.unresolved++;continue;}
   if(entry?.until>now()){result[entry.error]++;continue;}
   entry??={stamp,receipt:null};
   try{
    if(!entry.receipt){const value=await callRS(rsTool,{sourceId,requestType:row.requestType,
     idempotencyKey:row.idempotencyKey,payload:row.payload},{limit:8192});
     entry.receipt=verifyReceipt(value,row.idempotencyKey);
    }
    const ack=await callNGS(ackTool,{queueId:row.queueId,receipt:entry.receipt},{limit:8192});
    if(!exact(ack,['queueId','status'])||ack.queueId!==row.queueId||ack.status!=='acknowledged')throw falseReceipt();
    memo.delete(row.queueId);result.acknowledged++;
   }catch(e){
    // Once we have exact RS proof, retry only NGS receipt storage. If a
    // reply was lost before proof and RS advanced, its conflict is
    // explicitly unresolved; a derived ID alone does not prove acceptance.
    const code=e?.rsCode;
    const error=entry.receipt?'deferred':code==='OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT'?'unresolved':code&&definitive.has(code)?'rejected':'deferred';
    const delay=error==='unresolved'?120_000:error==='rejected'?60_000:5_000;
    postpone(row,entry,error,delay);result[error]++;
   }
  }
  return result;
 }
 let flight;
 return {pollOnce(){
  if(!flight)flight=work().finally(()=>{flight=undefined;});
  return flight;
 }};
}

export const ngsQueueMcpUrl='http://127.0.0.1:5275/mcp';
export const rsRequestMcpUrl='http://127.0.0.1:8770/mcp';
export function sameMacRSQueue({ngsUrl=ngsQueueMcpUrl,rsUrl=rsRequestMcpUrl,signal}={}){
 // Ports are an injected test seam; the executable takes no host or URL.
 const callNGS=loopbackJsonMCP(ngsUrl,{clientName:'ngs-rs-mcp-consumer',signal,timeoutMs:4000,transportError:localUnavailable});
 const callRS=loopbackJsonMCP(rsUrl,{clientName:'ngs-rs-mcp-consumer',signal,timeoutMs:4000,transportError:localUnavailable,
  decodeToolError(name,result){
   const e=result.structuredContent;
   return name===rsTool&&exact(e,['error','status'])&&definitive.get(e.error)===e.status
    ?Object.assign(Error(e.error),{rsCode:e.error}):null;
  }});
 return createRSQueueConsumer({callNGS,callRS});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const mode=process.argv.length===3?process.argv[2]:null;
 if(!['--watch','--once'].includes(mode)){
  console.error('NGS_RS_MCP_EXPLICIT_MODE_REQUIRED');process.exitCode=2;
 }else{
  const controller=new AbortController(),pump=sameMacRSQueue({signal:controller.signal});
  let timer,wake,last='';
  const stop=()=>{controller.abort();clearTimeout(timer);wake?.();};
  for(const action of ['SIGTERM','SIGINT'])process.once(action,stop);
  do{
   try{
    const status=await pump.pollOnce();
    const safe=JSON.stringify(status);
    if(mode==='--once'||status.acknowledged||status.seen&&safe!==last)console.log('NGS_RS_MCP_POLL',safe);
    last=safe;
   }catch{
    if(!controller.signal.aborted&&last!=='unavailable')console.error('NGS_RS_MCP_UNAVAILABLE');
    last='unavailable';if(mode==='--once')process.exitCode=1;
   }
   if(mode==='--watch'&&!controller.signal.aborted)await new Promise(resolve=>{wake=resolve;timer=setTimeout(resolve,1000);});
  }while(mode==='--watch'&&!controller.signal.aborted);
 }
}
