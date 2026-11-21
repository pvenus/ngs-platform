/** Protected same-Site machine transport. No browser or owner session identity. */
import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync,realpathSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {createRawFileUpload,spaceFileSyncRawUrl} from './file-sync-raw-client.mjs';
export const SPACE_SITE_MCP_URL='https://vinus-npcgen.park-venus0518.chatgpt.site/api/space-machine-mcp';
const protocol='2026-07-28';
export const queueTools=Object.freeze(['space_requests_pending','space_requests_ack','space_requests_get']);
export const fileTools=Object.freeze(['ngs_file_sync_begin','ngs_file_sync_file_reset','ngs_file_sync_plan','ngs_file_sync_file_failed','ngs_file_sync_remove','ngs_file_sync_finish','ngs_file_sync_abort']);
const tools=new Set([...queueTools,...fileTools]);
const fileErrors=new Map([
 ['NGS_FILE_SYNC_INVALID',400],['NGS_FILE_SYNC_SCOPE_DENIED',403],['NGS_FILE_SYNC_TOOL_UNKNOWN',404],
 ['NGS_FILE_SYNC_BUSY',409],['NGS_FILE_SYNC_INVALID_SESSION',409],['NGS_FILE_SYNC_REPLICA_CHANGED',409],
 ['NGS_FILE_SYNC_CONTENT_MISMATCH',409],['NGS_FILE_SYNC_OFFSET_INVALID',409],['NGS_FILE_SYNC_INCOMPLETE',409],
 ['SPACE_MACHINE_OPERATION_UNAVAILABLE',503],
]);
const maxReply=48*1024*1024;
const configError=()=>Error('NGS_SPACE_MACHINE_CONFIGURATION_REQUIRED');
const unavailable=()=>Error('NGS_SPACE_MACHINE_MCP_UNAVAILABLE');
const denied=()=>Error('NGS_SPACE_MACHINE_MCP_DENIED');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,k)=>object(v)&&Object.keys(v).length===k.length&&k.every(x=>Object.hasOwn(v,x));
const ASCII_TOKEN=/^[A-Za-z0-9._~+/=-]+$/;
const validMachineToken=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/.test(v);
const validToken=v=>typeof v==='string'&&v.length>=32&&v.length<=512&&ASCII_TOKEN.test(v)&&!/[\r\n]/.test(v);

export const SPACE_MACHINE_CREDENTIALS_ENV='NGS_SPACE_MACHINE_CREDENTIALS_FILE';
const same=(before,after)=>before.dev===after.dev&&before.ino===after.ino&&before.size===after.size&&
 before.ctimeNs===after.ctimeNs&&before.mode===after.mode&&before.nlink===after.nlink;
export function spaceMachineConfiguration(env=process.env){
 const path=env[SPACE_MACHINE_CREDENTIALS_ENV];
 let fd;
 try{
  if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||realpathSync(path)!==path)
   throw configError();
  const parent=dirname(path),folder=lstatSync(parent);
  if(!folder.isDirectory()||folder.uid!==process.getuid()||(folder.mode&0o077)!==0)throw configError();
  const before=lstatSync(path,{bigint:true});
  if(!before.isFile()||before.uid!==BigInt(process.getuid())||
   (before.mode&0o777n)!==0o600n||before.nlink!==1n||before.size<1n||before.size>2048n)
    throw configError();
  fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  if(!same(before,fstatSync(fd,{bigint:true})))throw configError();
  const bytes=readFileSync(fd);
  if(BigInt(bytes.length)!==before.size||!same(before,fstatSync(fd,{bigint:true}))||!same(before,lstatSync(path,{bigint:true})))
   throw configError();
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!exact(data,['token','platformToken'])||!validMachineToken(data.token)||
     !validToken(data.platformToken)||data.platformToken===data.token)throw configError();
  return data;
 }catch{throw configError();}
 finally{if(fd!==undefined)closeSync(fd);}
}

async function responseJSON(response,limit){
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw unavailable();
 const h=response.headers.get('content-length');
 if(h!==null&&(!/^\d+$/.test(h)||Number(h)>limit))throw unavailable();
 const stream=response.body?.getReader();if(!stream)throw unavailable();
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let amount=0,data='';
 try{
  for(;;){
   const {done,value}=await stream.read();if(done)break;
   amount+=value.length;if(amount>limit)throw unavailable();
   data+=decoder.decode(value,{stream:true});
  }
  return JSON.parse(data+decoder.decode());
 }catch{throw unavailable();}
 finally{void stream.cancel().catch(()=>{});}
}

export function createSpaceMachineMcp({
 token,platformToken,send=fetch,signal,timeoutMs=25_000,
}={}){
 if(!validMachineToken(token)||!validToken(platformToken)||platformToken===token||
  typeof send!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60_000)
  throw configError();
 let seq=0;
 return async function call(name,args,{limit=128*1024,responseMeta}={}){
  if(!tools.has(name)||!object(args)||!Number.isSafeInteger(limit)||limit<1||limit>maxReply)throw denied();
  const id=++seq,body=JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}});
  if(Buffer.byteLength(body)>96*1024)throw denied();
  const deadline=AbortSignal.timeout(timeoutMs);
  let response;
  try{
   response=await send(SPACE_SITE_MCP_URL,{method:'POST',redirect:'error',
    signal:signal?AbortSignal.any([signal,deadline]):deadline,headers:{
     'Content-Type':'application/json','Accept':'application/json','MCP-Protocol-Version':protocol,
     'X-NGS-Machine-Token':token,'OAI-Sites-Authorization':'Bearer '+platformToken,
    },body});
  }catch{throw unavailable();}
  if(response.status!==200){
   void response.body?.cancel().catch(()=>{});
   throw [401,403].includes(response.status)?denied():unavailable();
  }
  const envelope=await responseJSON(response,limit);
  if(!exact(envelope,['jsonrpc','id','result'])||envelope.jsonrpc!=='2.0'||envelope.id!==id||
   !object(envelope.result?.structuredContent))throw unavailable();
  if(envelope.result.isError===true&&fileTools.includes(name)){
   const err=envelope.result.structuredContent;
   if(exact(err,['error','status'])&&typeof err.error==='string'&&fileErrors.get(err.error)===err.status)
    throw Error(err.error);
  }
  if(envelope.result.isError!==false)throw unavailable();
  if(typeof responseMeta==='function')responseMeta(response.headers.get('x-ngs-commit-sha'));
  return envelope.result.structuredContent;
 };
}

/** Use the same scoped machine credentials, never a browser or visitor identity. */
export function createSpaceFileSyncUpload({token,platformToken,send,signal,timeoutMs}={}){
 if(!validMachineToken(token)||!validToken(platformToken)||platformToken===token)throw configError();
 return createRawFileUpload({url:spaceFileSyncRawUrl,send,signal,timeoutMs,headers:{
  'X-NGS-Machine-Token':token,'OAI-Sites-Authorization':'Bearer '+platformToken,
 }});
}
