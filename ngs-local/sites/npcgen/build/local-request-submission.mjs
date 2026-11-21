import {loopbackJsonMCP} from './folder-mcp-loopback.mjs';

const error=(message,status=400)=>Object.assign(Error(message),{status});
const unavailable=()=>error('REQUEST_SERVICE_UNAVAILABLE',503);
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const errors=new Map([
 ['REQUEST_SUBMIT_INVALID',400],['NGS_NPC_PLANNING_UPDATE_PAYLOAD_INVALID',400],['NGS_NPC_PLANNING_ADD_PAYLOAD_INVALID',400],
 ['OFFICIAL_REQUEST_NPC_PLANNING_ALREADY_REGISTERED',409],['NGS_ONE_STOP_PAYLOAD_INVALID',400],
 ['NGS_AUDIO_GENERATE_PAYLOAD_INVALID',400],['NGS_AUDIO_DELETE_PAYLOAD_INVALID',400],
 ['OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT',409],['ONE_STOP_TARGET_ALREADY_ACTIVE',409],['OFFICIAL_REQUEST_NPC_ALREADY_REGISTERED',409],
 ['OFFICIAL_REQUEST_REGISTER_FAILED',503],
 ['CONCEPT_CATEGORY_REQUEST_INVALID',400],['NGS_CONCEPT_CATEGORY_PAYLOAD_INVALID',400],['OFFICIAL_REQUEST_CONCEPT_CATEGORY_ALREADY_REGISTERED',409],
]);

export function parseRequestSubmission(bytes){
 let command;
 try{command=JSON.parse(bytes.toString('utf8'));}catch{throw error('REQUEST_SUBMIT_INVALID');}
 if(!fields(command,'idempotencyKey,payload,requestType')||!id(command.idempotencyKey)||
  !id(command.requestType)||!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload)||
  !id(command.payload.projectId))throw error('REQUEST_SUBMIT_INVALID');
 return command;
}
export function createLocalRequestSubmission({url,sourceId}){
 if(!id(sourceId))throw unavailable();
 const call=loopbackJsonMCP(url,{clientName:'ngs-request-submission',transportError:unavailable,decodeToolError(_name,result){
  const e=result.structuredContent,status=errors.get(e?.error);
  return status&&status===e?.status?error(e.error,status):null;
 }});
 return async command=>{
  const receipt=await call('request_submit',{sourceId,...command},{limit:8*1024});
  if(!fields(receipt,'officialRequestId,status')||receipt.status!=='registered'||!id(receipt.officialRequestId))throw unavailable();
  return receipt;
 };
}
