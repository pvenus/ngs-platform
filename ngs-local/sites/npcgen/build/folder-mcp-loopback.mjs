/** Stateless streamable HTTP MCP JSON-RPC on the exact local OPS origin. */
import {request} from 'node:http';

export const DEFAULT_PROJECT_FOLDER_MCP_URL='http://127.0.0.1:8030/mcp';
const protocolVersion='2025-06-18';
const rpcError=()=>Error('FOLDER_MCP_UNAVAILABLE');

async function readJSON(response,limit){
 let length=0,raw='';
 const decoder=new TextDecoder('utf-8',{fatal:true});
 try{
  for await(const value of response){
   length+=value.byteLength;
   if(length>limit)throw rpcError();
   raw+=decoder.decode(value,{stream:true});
  }
  raw+=decoder.decode();
  return JSON.parse(raw);
 }catch(error){response.destroy();throw error;}
}

export function loopbackJsonMCP(url,{
 clientName='ngs-project-folders',transportError=rpcError,decodeToolError=()=>null,timeoutMs=60_000,signal,
}={}){
 const endpoint=new URL(url);
 if(endpoint.protocol!=='http:'||endpoint.hostname!=='127.0.0.1'||!endpoint.port
  ||endpoint.pathname!=='/mcp'||url!==endpoint.origin+'/mcp')throw transportError();
 let sequence=0,initialized;
 async function post(message,{limit=4*1024*1024,notification=false,handshake=false,responseMeta}={}){
  const body=Buffer.from(JSON.stringify(message));
  // Native HTTP streams also support Python's HTTP/1.0 close and large MCP chunk JSON.
  const response=await new Promise((resolve,reject)=>{
   const timeout=AbortSignal.timeout(timeoutMs);
   const req=request(endpoint,{method:'POST',signal:signal?AbortSignal.any([signal,timeout]):timeout,headers:{
    Accept:'application/json, text/event-stream','Content-Type':'application/json','Content-Length':String(body.byteLength),
    ...(handshake?{}:{'MCP-Protocol-Version':protocolVersion}),
   }},resolve);
   req.once('error',()=>reject(transportError()));req.end(body);
  });
  if(notification){
   if(response.statusCode!==202){response.destroy();throw transportError();}
   response.resume();return;
  }
  if(response.statusCode!==200||!/^application\/json(?:\s*;|$)/i.test(response.headers['content-type']??'')){
   response.destroy();throw transportError();
  }
  let envelope;
  try{envelope=await readJSON(response,limit);}catch{throw transportError();}
  if(envelope?.jsonrpc!=='2.0'||envelope.id!==message.id||envelope.error||!envelope.result)throw transportError();
  if(envelope.result.isError===false&&typeof responseMeta==='function')
   responseMeta(response.headers['x-ngs-commit-sha']);
  return envelope.result;
 }
 function rpc(method,params,options){
  return post({jsonrpc:'2.0',id:++sequence,method,params},options);
 }
 function initialize(){
  if(!initialized)initialized=(async()=>{
   const value=await rpc('initialize',{protocolVersion,capabilities:{},clientInfo:{name:clientName,version:'1'}},{handshake:true});
   if(value.protocolVersion!==protocolVersion||!value.capabilities?.tools)throw transportError();
   await post({jsonrpc:'2.0',method:'notifications/initialized'},{notification:true});
  })().catch(error=>{initialized=undefined;throw error;});
  return initialized;
 }
 const call=async(name,arguments_,options)=>{
  await initialize();
  const result=await rpc('tools/call',{name,arguments:arguments_},options);
  if(result.isError===true)throw decodeToolError(name,result)??transportError();
  if(result.isError||!result.structuredContent||typeof result.structuredContent!=='object')throw transportError();
  return result.structuredContent;
 };
 call.listTools=async(options)=>{await initialize();return rpc('tools/list',{},options);};
 return call;
}

export function loopbackFolderMCP(url=DEFAULT_PROJECT_FOLDER_MCP_URL){
 return loopbackJsonMCP(url,{decodeToolError(name,result){
  if(name!=='npc_folders_compare'||!Array.isArray(result.content)||result.content.length!==1)return null;
  const content=result.content[0];
  if(content?.type!=='text'||typeof content.text!=='string'||content.text.length>=256)return null;
  try{
   const failure=JSON.parse(content.text);
   return failure?.error==='FOLDER_SCOPE_NOT_FOUND'&&failure.status===404
    ?Object.assign(Error('FOLDER_SCOPE_NOT_FOUND'),{status:404}):null;
  }catch{return null;}
 }});
}
