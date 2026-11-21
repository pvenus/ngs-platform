/** One verified binary upload per file; only fixed Local or hosted destinations. */
const path='/api/ngs-file-sync-file';
export const spaceFileSyncRawUrl='https://vinus-npcgen.park-venus0518.chatgpt.site'+path;
const sync=/^ngs\.sync\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest=/^[a-f0-9]{64}$/;
const bad=()=>Error('PDS_NGS_FILE_SYNC_INVALID');
const ackSize=4096;
const rejections=new Map([
 ['NGS_FILE_SYNC_INVALID',400],['NGS_FILE_SYNC_SCOPE_DENIED',403],
 ['NGS_FILE_SYNC_INVALID_SESSION',409],['NGS_FILE_SYNC_REPLICA_CHANGED',409],
 ['NGS_FILE_SYNC_CONTENT_MISMATCH',409],['NGS_FILE_SYNC_OFFSET_INVALID',409],
 ['NGS_FILE_SYNC_INCOMPLETE',409],['NGS_FILE_SYNC_BODY_TOO_LARGE',413],
]);
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).join(',')===k;
async function replyJSON(response){
 if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw bad();
 const length=response.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>ackSize))throw bad();
 const reader=response.body?.getReader();if(!reader)throw bad();
 const decoder=new TextDecoder('utf-8',{fatal:true});
 let seen=0,value='';
 try{
  for(;;){
   const {done,value:part}=await reader.read();if(done)break;
   seen+=part.byteLength;if(seen>ackSize)throw bad();value+=decoder.decode(part,{stream:true});
  }
  return JSON.parse(value+decoder.decode());
 }finally{void reader.cancel().catch(()=>{});}
}
export function createRawFileUpload({url,headers={},send=fetch,signal,timeoutMs=240_000}={}){
 const endpoint=new URL(url);
 if(typeof send!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>600_000||
    url!==spaceFileSyncRawUrl&&(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||!endpoint.port||url!==endpoint.origin+path))
  throw bad();
 const unavailable=()=>Error(url===spaceFileSyncRawUrl?'NGS_SPACE_FILE_UPLOAD_UNAVAILABLE':'NGS_LOCAL_FILE_UPLOAD_UNAVAILABLE');
 return async function sendWholeFile(args,bodyFactory){
  const {syncId,path:relative,sha256,size}=args??{};
  if(!sync.test(syncId??'')||typeof relative!=='string'||!relative.isWellFormed()||relative.length===0||
     !digest.test(sha256??'')||!Number.isSafeInteger(size)||size<0||typeof bodyFactory!=='function')throw bad();
  const encoded=Buffer.from(relative,'utf8').toString('base64url');
  if(encoded.length>2048)throw bad();
  const deadline=AbortSignal.timeout(timeoutMs),combined=signal?AbortSignal.any([signal,deadline]):deadline;
  let response,value,body;
  try{
   body=size?bodyFactory():new Uint8Array();
   response=await send(url,{method:'POST',body,...(size?{duplex:'half'}:{}),signal:combined,redirect:'error',headers:{
    ...headers,'Content-Type':'application/octet-stream','Content-Length':String(size),'Accept':'application/json',
    'X-NGS-Sync-Id':syncId,'X-NGS-File-Path':encoded,'X-NGS-File-Sha256':sha256,
   }});
   value=await replyJSON(response);
  }catch{throw unavailable();}
  finally{
   if(response?.body&&!response.body.locked)void response.body.cancel().catch(()=>{});
   if(body instanceof ReadableStream&&!body.locked)void body.cancel().catch(()=>{});
  }
  if(response.status===200&&exact(value,'ok')&&value.ok===true)return value;
  if(exact(value,'error')&&rejections.get(value.error)===response.status)
   throw Object.assign(Error(value.error),{definite:true});
  throw unavailable();
 };
}
export function createLoopbackFileUpload(mcpUrl,options={}){
 const local=new URL(mcpUrl);
 if(local.protocol!=='http:'||local.hostname!=='127.0.0.1'||!local.port||mcpUrl!==local.origin+'/mcp')throw bad();
 return createRawFileUpload({...options,url:local.origin+path,headers:{}});
}
