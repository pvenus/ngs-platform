/** Explicit Site routes for one project. Native visitors and Mac relay have separate identities. */
import {SpaceRequestQueue,exact,record,machineTools,validMachineToken} from './space-request-queue.mjs';
const queue='/api/requests',session='/__npcgen_session',machinePath='/api/space-machine-mcp';
const maxRpc=4*Math.ceil(1024*1024/3)+32*1024,small=32*1024;
const privateHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
const json=(value,status=200)=>Response.json(value,{status,headers:privateHeaders});
const fail=(status,error)=>json({error},status);
const need=(allowed,status=400,code='SPACE_REQUEST_INVALID')=>{if(!allowed)throw Object.assign(Error(code),{status});};
const postJSON=req=>/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers.get('content-type')??'');
const utf8=new TextEncoder();
const hex=buffer=>Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join('');
const hash=async v=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(v)));
async function sameToken(a,b){
 if(!validMachineToken(a)||!validMachineToken(b))return false;
 const aa=await hash(a),bb=await hash(b);let difference=0;
 for(let i=0;i<aa.length;i++)difference|=aa.charCodeAt(i)^bb.charCodeAt(i);
 return difference===0;
}
async function csrf(secret,actor){
 const key=await crypto.subtle.importKey('raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sign=async purpose=>hex(await crypto.subtle.sign('HMAC',key,utf8.encode(JSON.stringify([purpose,'binari',actor]))));
 return {contextId:'space.'+await sign('context.v1'),csrfToken:await sign('csrf.v1')};
}
async function body(req,max){
 need(postJSON(req),415,'JSON_REQUIRED');
 const size=req.headers.get('content-length');
 need(size===null||/^\d{1,9}$/.test(size)&&Number(size)<=max,413,'SPACE_BODY_TOO_LARGE');
 const reader=req.body?.getReader();need(reader);
 const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',read=0;
 try{
  while(true){
   const next=await reader.read();if(next.done)break;
   read+=next.value.length;need(read<=max,413,'SPACE_BODY_TOO_LARGE');
   raw+=decoder.decode(next.value,{stream:true});
  }
  return {value:JSON.parse(raw+decoder.decode()),read};
 }catch(error){if(error?.status)throw error;throw Object.assign(Error('SPACE_REQUEST_INVALID'),{status:400});}
 finally{void reader.cancel().catch(()=>{});}
}
const responseError=error=>{
 const status=[400,401,403,404,405,409,413,415].includes(error?.status)?error.status:503;
 return fail(status,status===503?'SPACE_QUEUE_UNAVAILABLE':error.message);
};
const rpc=(id,result)=>json({jsonrpc:'2.0',id,result});
const rpcResult=(id,value,isError=false)=>rpc(id,{content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError});
const rpcError=(id,code,message)=>json({jsonrpc:'2.0',id,error:{code,message}});
const idOK=id=>typeof id==='string'&&id.length<=128||Number.isSafeInteger(id);
const fields=(v,keys)=>record(v)&&Object.keys(v).every(k=>keys.includes(k));

/** No machine request falls through to visitor MCP, even with an invalid token. */
export async function machineResponse(request,{db,secret,fileReplica,fileTools=[]}={}){
 const url=new URL(request.url),supplied=request.headers.get('X-NGS-Machine-Token');
 if(url.pathname!==machinePath)return supplied===null?null:fail(404,'SPACE_MACHINE_ROUTE_NOT_FOUND');
 if(url.search||request.method!=='POST')return fail(404,'SPACE_MACHINE_ROUTE_NOT_FOUND');
 if(request.headers.has('Origin')||request.headers.has('Sec-Fetch-Site')||
    request.headers.has('Access-Control-Request-Method'))return fail(403,'SPACE_MACHINE_BROWSER_DENIED');
 if(!await sameToken(supplied,secret))return fail(403,'SPACE_MACHINE_AUTH_REQUIRED');
 try{
  const {value:message,read}=await body(request,maxRpc);
  need(fields(message,['jsonrpc','id','method','params'])&&message.jsonrpc==='2.0'&&typeof message.method==='string'&&
    (!Object.hasOwn(message,'id')||idOK(message.id)));
  const {id,method,params}=message;
  const configuredFileTools=fileReplica?fileTools:[];
  const names=new Set(configuredFileTools.map(x=>x.name));
  if(read>small)need(method==='tools/call'&&params?.name==='ngs_file_sync_file_chunk'&&names.has(params.name),413,'SPACE_BODY_TOO_LARGE');
  if(id===undefined){
   return method==='notifications/initialized'&&(!params||exact(params,[]))?new Response(null,{status:202,headers:privateHeaders}):
    fail(400,'SPACE_REQUEST_INVALID');
  }
  if(method==='server/discover')return rpc(id,{supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
  if(method==='initialize')return rpc(id,{protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'ngs-space-machine',version:'1'}});
  if(method==='ping')return rpc(id,{});
  if(method==='tools/list'&&(!params||fields(params,['_meta'])))return rpc(id,{tools:[...machineTools,...configuredFileTools]});
  if(method!=='tools/call')return rpcError(id,-32601,'Method not found');
  if(!fields(params,['name','arguments','_meta'])||typeof params.name!=='string'||!record(params.arguments))
   return rpcError(id,-32602,'Invalid tool or arguments');
  try{
   if(machineTools.some(tool=>tool.name===params.name))return rpcResult(id,await new SpaceRequestQueue(db).call(params.name,params.arguments));
   if(fileReplica&&names.has(params.name))return rpcResult(id,await fileReplica.call(params.name,params.arguments));
   return rpcError(id,-32602,'Invalid tool or arguments');
  }catch(error){
   const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<500?error.status:503;
   return rpcResult(id,{status,error:status===503?'SPACE_MACHINE_OPERATION_UNAVAILABLE':error.message},true);
  }
 }catch(error){return responseError(error);}
}
export async function browserQueueResponse(request,{db,secret,authorize,authorizeWrite,replicaReads=false}={}){
 const url=new URL(request.url);
 if(![queue,session].includes(url.pathname))return null;
 // Keep the exact existing session shape when the machine relay is disabled.
 if(!validMachineToken(secret))return null;
 const id=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!id||!email||id.length>200||email.length>320)return fail(401,'SIGN_IN_REQUIRED');
 try{
  need(typeof authorize==='function'&&await authorize({userId:id,email})===true,403,'PROJECT_OR_RESOURCE_DENIED');
  const actor=await hash(JSON.stringify(['space.queue.actor.v1',id])),tokens=await csrf(secret,actor),service=new SpaceRequestQueue(db);
  if(url.pathname===session){
   need(request.method==='GET'&&!url.search,405,'METHOD_NOT_ALLOWED');
   await service.ready();
   const requestWritable=typeof authorizeWrite==='function'&&await authorizeWrite({userId:id,email})===true;
   return json({state:'authenticated',backend:'space',readOnly:!replicaReads,queueEnabled:true,requestWritable,...tokens});
  }
  if(request.method==='GET'){
   if(!url.search)return json(await service.browserSummary(actor));
   const keys=[...url.searchParams.keys()];
   need(keys.length===1&&keys[0]==='queueId');
   return json(await service.browserStatus(actor,url.searchParams.get('queueId')));
  }
  need(request.method==='POST'&&!url.search,405,'METHOD_NOT_ALLOWED');
  need(request.headers.get('Origin')===url.origin,403,'ORIGIN_FORBIDDEN');
  need(typeof authorizeWrite==='function'&&await authorizeWrite({userId:id,email})===true,403,'SPACE_QUEUE_WRITE_NOT_GRANTED');
  need(await sameToken(request.headers.get('X-NPCGen-Csrf'),tokens.csrfToken)&&
    request.headers.get('X-NPCGen-Frontend-Context')===tokens.contextId,403,'CSRF_INVALID');
  const {value}=await body(request,small);
  return json(await service.enqueue(actor,value),202);
 }catch(error){return responseError(error);}
}
