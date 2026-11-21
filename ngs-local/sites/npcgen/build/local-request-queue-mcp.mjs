// A separate local control plane; never attach this request handler to public NGS.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { MAX_QUEUE_LIST, LOCAL_QUEUE_MCP_DEFAULT_PORT, openLocalRequestQueue } from './local-request-queue.mjs';

import {fileSyncChunkTool,fileSyncTools,localFileSyncReceiverFromEnv,maxFileSyncRpcBytes} from './local-replica-file-receiver.mjs';
import {openLocalObjectReplicaFromEnv} from './local-object-replica-runtime.mjs';
import {objectReplicaBatchRpcBytes,objectReplicaBatchTool} from './object-replica.mjs';

const protocolVersion='2025-06-18';
const inputSchema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
const queueId={type:'string',pattern:'^ngs\\.local\\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const receipt=inputSchema({officialRequestId:{type:'string',pattern:'^request\\.official\\.[a-f0-9]{64}$'},status:{const:'registered'}},['officialRequestId','status']);
const tools=[
 {name:'ngs_request_queue_list',description:'Read pending local NGS requests, oldest first.',inputSchema:inputSchema({limit:{type:'integer',minimum:1,maximum:MAX_QUEUE_LIST},cursor:{type:'string',pattern:'^q1\\.[1-9][0-9]{0,15}$'}})},
 {name:'ngs_request_queue_ack',description:'Acknowledge an exact official receipt read from local RS.',inputSchema:inputSchema({queueId,receipt},['queueId','receipt'])},
];
const keys=(value,...names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const toolResult=(value,isError=false)=>({isError,content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
const rpcFailure=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});

export function createLocalRequestQueueMcp(queue,{fileSync,fileSyncToolDefinitions=fileSyncTools}={}){
 const syncNames=new Set(fileSync?fileSyncToolDefinitions.map(tool=>tool.name):[]);
 const maxRequestBody=syncNames.has(objectReplicaBatchTool)?objectReplicaBatchRpcBytes:fileSync?maxFileSyncRpcBytes:8192;
 return createServer({requestTimeout:5000,headersTimeout:5000,maxHeaderSize:8192},async(req,res)=>{
  const port=res.socket.localPort;
  if(req.headers.host!=='127.0.0.1:'+port||req.headers.origin!==undefined||req.headers['sec-fetch-site']!==undefined||
    req.headers['access-control-request-method']!==undefined||Object.keys(req.headers).some(name=>name==='forwarded'||name.startsWith('x-forwarded-'))||res.socket.remoteAddress!=='127.0.0.1'){
   res.writeHead(403).end();return;
  }
  if(req.url!=='/mcp'){res.writeHead(404).end();return;}
  if(req.method!=='POST'){res.writeHead(405,{allow:'POST'}).end();return;}
  if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??'')){res.writeHead(415).end();return;}
  const response=v=>res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(v));
  let message,total=0;
  try{
   const buffers=[];
   for await(const chunk of req.iterator({destroyOnReturn:false})){
    total+=chunk.length;
    if(total>maxRequestBody){res.writeHead(413,{Connection:'close'}).end();return;}
    buffers.push(chunk);
   }
   message=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(buffers)));
  }catch{
   if(total>8192){res.writeHead(413,{Connection:'close'}).end();return;}
   response(rpcFailure(null,-32700,'Parse error'));return;
  }
  if(total>8192){
   const name=message?.params?.name;
   const methodBound=name===fileSyncChunkTool?maxFileSyncRpcBytes:name===objectReplicaBatchTool?objectReplicaBatchRpcBytes:0;
   if(message?.method!=='tools/call'||!syncNames.has(name)||total>methodBound){
    res.writeHead(413,{Connection:'close'}).end();return;
   }
  }
  const id=message?.id;
  if(message?.jsonrpc!=='2.0'||typeof message.method!=='string'||
   (id!==undefined&&typeof id!=='string'&&!Number.isSafeInteger(id))){response(rpcFailure(null,-32600,'Invalid request'));return;}
  const {method,params}=message;
  if(id===undefined){res.writeHead(202).end();return;}
  const ok=value=>response({jsonrpc:'2.0',id,result:value});
  if(method==='initialize'){
   ok({protocolVersion,capabilities:{tools:{}},serverInfo:{name:'ngs-local-request-queue',version:'1'}});return;
  }
  if(req.headers['mcp-protocol-version']&&req.headers['mcp-protocol-version']!==protocolVersion){res.writeHead(400).end();return;}
  if(method==='ping'){ok({});return;}
  if(method==='tools/list'){ok({tools:fileSync?[...tools,...fileSyncToolDefinitions]:tools});return;}
  if(method!=='tools/call'){response(rpcFailure(id,-32601,'Method not found'));return;}
  const args=params?.arguments??{};
  if(fileSync&&syncNames.has(params?.name)){
   try{ok(toolResult(await fileSync.call(params.name,args)));}
   catch(e){const status=Number.isInteger(e?.status)?e.status:503;ok(toolResult({status,error:status===503?'NGS_FILE_SYNC_UNAVAILABLE':e.message},true));}
   return;
  }
  try{
   if(params?.name==='ngs_request_queue_list'&&(keys(args)||keys(args,'limit')||keys(args,'cursor')||keys(args,'cursor','limit'))){ok(toolResult(queue.list(args.limit,args.cursor)));return;}
   if(params?.name==='ngs_request_queue_ack'&&keys(args,'queueId','receipt')){ok(toolResult(queue.ack(args.queueId,args.receipt)));return;}
   response(rpcFailure(id,-32602,'Invalid tool or arguments'));
  }catch(e){
   const status=Number.isInteger(e?.status)?e.status:503;
   const error=status===503?'NGS_REQUEST_QUEUE_UNAVAILABLE':e.message;
   ok(toolResult({status,error},true));
  }
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {NGS_REQUEST_QUEUE_DB,NGS_REQUEST_QUEUE_MCP_PORT}=process.env;
 const port=Number(NGS_REQUEST_QUEUE_MCP_PORT??LOCAL_QUEUE_MCP_DEFAULT_PORT);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('NGS_REQUEST_QUEUE_MCP_PORT_INVALID');
 const queue=openLocalRequestQueue(NGS_REQUEST_QUEUE_DB);
 const service=await openLocalObjectReplicaFromEnv(process.env,{writer:true});
 const fileSync=service?.replica??localFileSyncReceiverFromEnv();
 const server=createLocalRequestQueueMcp(queue,{fileSync,fileSyncToolDefinitions:service?.fileSyncToolDefinitions});
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close(()=>{if(service)service.close();else fileSync?.close();queue.close();}));
 server.listen(port,'127.0.0.1');
}
