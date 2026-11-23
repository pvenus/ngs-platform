/** Browser and local queue share this transport-free envelope parser. */
import {isNpcWorkflowReplaceSchema,validNpcWorkflowIdentity} from './npc-motion-selection.mjs';
const error=(message,status=400)=>Object.assign(Error(message),{status});
const fields=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);

export function parseRequestSubmission(bytes){
 let command;
 try{command=JSON.parse(bytes.toString('utf8'));}catch{throw error('REQUEST_SUBMIT_INVALID');}
 if(!fields(command,'idempotencyKey,payload,requestType')||!id(command.idempotencyKey)||
  !id(command.requestType)||!command.payload||typeof command.payload!=='object'||Array.isArray(command.payload)||
  !id(command.payload.projectId))throw error('REQUEST_SUBMIT_INVALID');
 if(command.requestType==='npc.workflow'&&!validNpcWorkflowIdentity(command.payload.character,command.payload.schemaVersion))
  throw error(isNpcWorkflowReplaceSchema(command.payload.schemaVersion)?'ONE_STOP_REPLACE_IDENTITY_INVALID':'NGS_ONE_STOP_PAYLOAD_INVALID');
 return command;
}
