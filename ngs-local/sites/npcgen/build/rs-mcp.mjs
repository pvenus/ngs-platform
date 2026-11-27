import {fileDeleteType,validPropFolderDelete,validNpcFolderDelete,validBackgroundFileDelete,validCinematicFileDelete,validMapFolderDelete} from './prop-folder-delete-contract.mjs';
/** Same-Mac NGS queue -> existing official Request Service, both over MCP. */
import {createNgsHealthRelay} from './rs-ops-ngs-health.mjs';
import {startOpsHealthReport} from './local-ops-health-report.mjs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {loopbackJsonMCP} from './folder-mcp-loopback.mjs';
import {createSpaceMachineMcp,spaceMachineConfiguration} from './space-machine-mcp.mjs';

const rsTool='request_submit',spaceRsTool='request_submit_space';
const projectId='binari',limit=16;
const storedStatuses=new Set(['registered','planned','completed','failed','cancelled']);
import {cinematicNewTypes,backgroundSourceType,backgroundPixelType,backgroundAnimationType,backgroundAnimationSchema,validBackgroundAnimation,validBackgroundPixelRequest,validBackgroundRequest} from './cinematic-sequence-contract.mjs';
import {cinematicType} from './cinematic-contract.mjs';
import {propTypes} from './prop-workspace-contract.mjs';
// Release together with map-contract.mjs: this relay validates optional rect/ellipse
// geometry and rotation before queue handoff, including existing rectangle-only drafts.
import {mapTypes,validMapRequest} from './map-contract.mjs';
const kinds=new Set([cinematicType,...cinematicNewTypes,...Object.values(propTypes),...mapTypes,fileDeleteType,'prop.animation.remove','npc.workflow','npc.portrait.regenerate','npc.animation.regenerate','concept.category.workflow','npc.planning.add','npc.planning.update','audio.generate','audio.delete','audio.separate','motion-preset.convert-2d']);
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const queueId=(v,source)=>typeof v==='string'&&v.length===46&&v.startsWith('ngs.'+source+'.')&&uuid.test(v.slice(10));
const officialIdFor=(key,sourceId)=>'request.official.'+createHash('sha256').update(JSON.stringify(['request.official.v1',sourceId,projectId,key])).digest('hex');
const falseReceipt=()=>Error('NGS_RS_RECEIPT_UNCONFIRMED');
const localUnavailable=()=>Error('NGS_RS_MCP_UNAVAILABLE');
const invalid=()=>Error('NGS_REQUEST_QUEUE_RESPONSE_INVALID');
const definitive=new Map([
 ['NGS_MAP_PAYLOAD_INVALID',400],['NGS_CINEMATIC_PAYLOAD_INVALID',400],['CINEMATIC_PLAYBACK_REVISION_CONFLICT',409],['CINEMATIC_SOURCE_NOT_FOUND',404],
 ['REQUEST_SUBMIT_INVALID',400],['NGS_ONE_STOP_PAYLOAD_INVALID',400],['NGS_NPC_ANIMATION_REGENERATE_PAYLOAD_INVALID',400],['NGS_NPC_PORTRAIT_REGENERATE_PAYLOAD_INVALID',400],['NPC_PORTRAIT_EDIT_TARGET_NOT_FOUND',404],['NPC_PORTRAIT_EDIT_SOURCE_NOT_FOUND',409],['NGS_CONCEPT_CATEGORY_PAYLOAD_INVALID',400],
 ['NGS_NPC_PLANNING_ADD_PAYLOAD_INVALID',400],['NGS_NPC_PLANNING_UPDATE_PAYLOAD_INVALID',400],
 ['NGS_AUDIO_GENERATE_PAYLOAD_INVALID',400],['NGS_AUDIO_DELETE_PAYLOAD_INVALID',400],
 ['NGS_MOTION_PRESET_CONVERT_2D_PAYLOAD_INVALID',400],
 ['OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT',409],['OFFICIAL_REQUEST_NPC_ALREADY_REGISTERED',409],
 ['OFFICIAL_REQUEST_CONCEPT_CATEGORY_ALREADY_REGISTERED',409],['OFFICIAL_AUDIO_DELETE_TARGET_NOT_COMPLETED',404],
 ['OFFICIAL_AUDIO_DELETE_ALREADY_REGISTERED',409],
]);

function verifyReceipt(r,idempotencyKey,source){
 const local=source==='local';
 if(!(local?exact(r,['officialRequestId','status'])&&r.status==='registered':
    exact(r,['officialRequestId','status','registeredAt'])&&storedStatuses.has(r.status)&&
    Number.isSafeInteger(r.registeredAt)&&r.registeredAt>=0)||
  r.officialRequestId!==officialIdFor(idempotencyKey,source))throw falseReceipt();
 // Forward the exact durable receipt to the private Site queue; its
 // browser-facing state distinguishes acceptance from generation.
 return r;
}
const validCursor=v=>typeof v==='string'&&/^q1\.[1-9][0-9]{0,15}$/.test(v)&&!/[\r\n]/.test(v)&&Number.isSafeInteger(Number(v.slice(3)));
function parseBatch(batch,previous,source){
 if(!exact(batch,['requests'])&&!exact(batch,['requests','nextCursor'])||!Array.isArray(batch.requests)||
  batch.requests.length>limit||Object.hasOwn(batch,'nextCursor')!==(batch.requests.length===limit))
  throw invalid();
 if(Object.hasOwn(batch,'nextCursor')&&(!validCursor(batch.nextCursor)||
  previous&&Number(batch.nextCursor.slice(3))<=Number(previous.slice(3))))throw invalid();
 const ids=new Set(),usedKeys=new Set();
 for(const r of batch.requests){
  if(!exact(r,['queueId','requestType','idempotencyKey','payload'])||!queueId(r.queueId,source)||r.queueId!==r.idempotencyKey||
     ids.has(r.queueId)||usedKeys.has(r.idempotencyKey))throw invalid();
  ids.add(r.queueId);usedKeys.add(r.idempotencyKey);
 }
 return {rows:batch.requests,next:batch.nextCursor??null};
}

function createConsumer({callNGS,callRS,now=Date.now,observeNgs},sourceId){
 const local=sourceId==='local';
 const listTool=local?'ngs_request_queue_list':'space_requests_pending';
 const ackTool=local?'ngs_request_queue_ack':'space_requests_ack';
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
  let commitSha;
  const batch=await callNGS(listTool,listArgs,{limit:4*1024*1024,responseMeta:value=>{commitSha=value;}});
  const {rows,next}=parseBatch(batch,cursor,sourceId);
  // Report successful contact independently of RS registration or NGS ACK.
  if(observeNgs)try{void Promise.resolve(observeNgs(sourceId,commitSha)).catch(()=>{});}catch{}
  // NGS returns an opaque cursor independent of ACK/removal. A full page
  // advances even if its deliveries were all rejected or remain unresolved.
  cursor=next;
  const result={seen:rows.length,acknowledged:0,unresolved:0,rejected:0,deferred:0};
  for(const row of rows){
   if(!kinds.has(row.requestType)||row.payload===null||typeof row.payload!=='object'||Array.isArray(row.payload)||
      row.payload.projectId!==projectId||Buffer.byteLength(JSON.stringify(row.payload))>90*1024||
      (local&&row.requestType===backgroundSourceType&&!validBackgroundRequest(row.payload))||
      (row.requestType===backgroundAnimationType&&(!local||!validBackgroundAnimation(row.payload)||
       row.payload.playback.durationFrames===84&&row.payload.schemaVersion!==backgroundAnimationSchema))||
      (row.requestType===backgroundPixelType&&(!local||!validBackgroundPixelRequest(row.payload)))||
      (mapTypes.includes(row.requestType)&&(!local||!validMapRequest(row.payload,row.requestType)))||
      (row.requestType===fileDeleteType&&(!local||!(validPropFolderDelete(row.payload)||validNpcFolderDelete(row.payload)||validBackgroundFileDelete(row.payload)||validCinematicFileDelete(row.payload)||validMapFolderDelete(row.payload))))){result.rejected++;continue;}
   // Background media v2 has real scheduler stages; relay the contract unchanged,
   // just as for already-queued v1 compatibility rows.
   const stamp=fingerprint(row);
   let entry=memo.get(row.queueId);
   if(entry&&entry.stamp!==stamp){result.unresolved++;continue;}
   if(entry?.until>now()){result[entry.error]++;continue;}
   entry??={stamp,receipt:null};
   try{
    if(!entry.receipt){
     // For Site origin the worker may supply only a ticket. RS re-fetches
     // that ticket via the configured trusted machine MCP connector.
     const value=await callRS(local?rsTool:spaceRsTool,local?{sourceId,requestType:row.requestType,
      idempotencyKey:row.idempotencyKey,payload:row.payload}:{queueId:row.queueId},{limit:8192});
     entry.receipt=verifyReceipt(value,row.idempotencyKey,sourceId);
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

export const createRSQueueConsumer=options=>createConsumer(options,'local');
export const createSpaceRSQueueConsumer=options=>createConsumer(options,'space');
export function watchSpaceRSQueue({pump,signal,onResult=()=>{},onError=()=>{},sleep=pause}){
 return (async()=>{
  while(!signal?.aborted){
   try{onResult(await pump.pollOnce());}
   catch(error){if(!signal?.aborted)onError(error);}
   try{await sleep(1000,undefined,{signal});}
   catch(error){if(!signal?.aborted)throw error;}
  }
 })();
}
export const ngsQueueMcpUrl='http://127.0.0.1:5275/mcp';
export const rsRequestMcpUrl='http://127.0.0.1:8770/mcp';
/** Read the admitted request families, not the presence of a generic submit tool. */
export function rsPropActions(list){
 const entries=Array.isArray(list?.tools)?list.tools.filter(t=>t?.name===rsTool):[];
 if(entries.length!==1)return [];
 const input=entries[0].inputSchema;
 const types=input?.properties?.requestType?.enum;
 const branches=input?.oneOf;
 if(!Array.isArray(types)||!Array.isArray(branches))return [];
 const matchesKeys=(values,keys)=>Array.isArray(values)&&values.length===keys.length&&keys.every(k=>values.includes(k));
 return ['generate','regenerate','animation'].filter(action=>{
  const type=propTypes[action],schema='ngs.prop-'+(action==='animation'?'animation-generate':action)+'.v1';
  const exactBranches=branches.filter(x=>x?.properties?.requestType?.const===type);
  const payload=exactBranches[0]?.properties?.payload,fields=payload?.properties;
  if(types.filter(x=>x===type).length!==1||exactBranches.length!==1||
   fields?.schemaVersion?.const!==schema||fields?.projectId?.const!=='binari')return false;
  if(action!=='animation')return fields?.motion?.const==='still';
  const keys=['schemaVersion','projectId','propId','source','motionId','prompt'];
  const hasCandleProfile=Object.hasOwn(fields,'renderProfile');
  const wireKeys=hasCandleProfile?[...keys,'renderProfile']:keys;
  if(hasCandleProfile&&!(exact(fields.renderProfile,['const'])&&fields.renderProfile.const==='candle-chroma-headroom-v1'&&
      exact(payload.if,['required'])&&matchesKeys(payload.if.required,['renderProfile'])&&exact(payload.then,['properties'])&&
      exact(payload.then.properties,['propId'])&&exact(payload.then.properties.propId,['const'])&&
      payload.then.properties.propId.const==='candle-brass-petal-unlit-clean'))return false;
  return payload.type==='object'&&payload.additionalProperties===false&&matchesKeys(payload.required,keys)&&exact(fields,wireKeys)&&
   fields.propId?.type==='string'&&fields.motionId?.type==='string'&&fields.prompt?.type==='string'&&fields.prompt?.maxLength===2000&&
   fields.source?.type==='object'&&fields.source.additionalProperties===false&&
   matchesKeys(fields.source.required,['revision','sha256'])&&
   exact(fields.source.properties,['revision','sha256'])&&fields.source.properties.revision?.type==='integer'&&
   fields.source.properties.sha256?.type==='string';
 });
}
export function createRSPropReadiness({url=rsRequestMcpUrl}={}){
 const call=loopbackJsonMCP(url,{clientName:'ngs-prop-readiness',transportError:localUnavailable,timeoutMs:2500});
 let pending;
 return ()=>{
  pending??=call.listTools({limit:128*1024}).then(rsPropActions,()=>[]).finally(()=>{pending=undefined;});
  return pending;
 };
}
export function sameMacRSQueue({ngsUrl=ngsQueueMcpUrl,rsUrl=rsRequestMcpUrl,signal,observeNgs}={}){
 // Ports are an injected test seam; the executable takes no host or URL.
 const callNGS=loopbackJsonMCP(ngsUrl,{clientName:'ngs-rs-mcp-consumer',signal,timeoutMs:4000,transportError:localUnavailable});
 const callRS=loopbackJsonMCP(rsUrl,{clientName:'ngs-rs-mcp-consumer',signal,timeoutMs:4000,transportError:localUnavailable,
  decodeToolError(name,result){
   const e=result.structuredContent;
   return name===rsTool&&exact(e,['error','status'])&&definitive.get(e.error)===e.status
    ?Object.assign(Error(e.error),{rsCode:e.error}):null;
  }});
 return createRSQueueConsumer({callNGS,callRS,observeNgs});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const mode=process.argv.length===3?process.argv[2]:null;
 if(!['--watch','--once'].includes(mode)){
  console.error('NGS_RS_MCP_EXPLICIT_MODE_REQUIRED');process.exitCode=2;
 }else{
  const controller=new AbortController();
  const observeNgs=mode==='--watch'?createNgsHealthRelay({signal:controller.signal}):undefined;
  const pump=sameMacRSQueue({signal:controller.signal,observeNgs});
  const health=mode==='--watch'?startOpsHealthReport({serverName:'rs-mcp'}):null;
  let timer,wake,last='';
  const stop=()=>{health?.stop();controller.abort();clearTimeout(timer);wake?.();};
  for(const action of ['SIGTERM','SIGINT'])process.once(action,stop);
  let space;
  if(mode==='--watch'&&process.env.NGS_SPACE_REQUEST_RELAY_ENABLED==='1'){
   try{
    const callNGS=createSpaceMachineMcp({...spaceMachineConfiguration(),signal:controller.signal});
    const callRS=loopbackJsonMCP(rsRequestMcpUrl,{clientName:'ngs-rs-mcp-consumer-space',
     signal:controller.signal,timeoutMs:30_000,transportError:localUnavailable,decodeToolError(name,result){
      const e=result.structuredContent;
      return name===spaceRsTool&&exact(e,['error','status'])&&definitive.get(e.error)===e.status
       ?Object.assign(Error(e.error),{rsCode:e.error}):null;
     }});
    let spaceLast='';
    space=watchSpaceRSQueue({pump:createSpaceRSQueueConsumer({callNGS,callRS,observeNgs}),signal:controller.signal,
     onResult:status=>{
      const safe=JSON.stringify(status);
      if(status.acknowledged||status.seen&&safe!==spaceLast)console.log('NGS_RS_MCP_SPACE_POLL',safe);
      spaceLast=safe;
     },onError:()=>{
      if(spaceLast!=='unavailable')console.error('NGS_RS_MCP_SPACE_UNAVAILABLE');
      spaceLast='unavailable';
     }}).catch(()=>console.error('NGS_RS_MCP_SPACE_UNAVAILABLE'));
   }catch{console.error('NGS_RS_MCP_SPACE_CONFIGURATION_REQUIRED');}
  }
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
  await space;
 }
}
