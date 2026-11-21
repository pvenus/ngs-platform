/** Same Site, clean application surface. No legacy route may reach the renderer. */
import {catalogActions} from './space-project-catalog.mjs';
const reads=new Set(['GET','HEAD']);
const auth=new Set(['/signin-with-chatgpt','/signout-with-chatgpt','/callback']);
const publicAssets=new Set(['/favicon.svg','/assets/vinus-mark.png','/assets/projects/binari.svg']);
const bgmReads=new Set(['/api/space/audio-workspace','/api/space/audio-concepts']);
const handoffs=new Set(['audio-request-pending','audio-request-get','audio-request-receipt']);
const staticBuild=/^\/_next\/static\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|css|woff2?|ttf|svg|png|webp)$/u;
const limit=65536;
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
const deny=(status,code)=>Response.json({error:code},{status,headers});
const rpc=(id,result)=>Response.json({jsonrpc:'2.0',id,result},{headers});
const record=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const only=(x,keys)=>record(x)&&Object.keys(x).every(k=>keys.includes(k));
const discoveredTool={
 name:'npc_mirror_dispatch',
 description:'Owner-only Binari BGM request handoff. Reads pending requests and records verified local Request Service receipts. Never generates audio.',
 inputSchema:{type:'object',required:['command'],additionalProperties:false,properties:{command:{
  type:'object',required:['action','projectId'],properties:{action:{enum:[...handoffs]},projectId:{const:'binari'},
   queueId:{type:'string'},receipt:{type:'object'}},additionalProperties:false,
 }}},annotations:{readOnlyHint:false},
};

async function json(request){
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))return null;
 // Tee the native Request: pass the original onwards only after admission.
 const stream=request.clone().body?.getReader();
 if(!stream)return null;
 const decoder=new TextDecoder('utf-8',{fatal:true});let raw='',size=0;
 try{
  while(true){
   const {value,done}=await stream.read();if(done)break;
   size+=value.length;if(size>limit)return null;
   raw+=decoder.decode(value,{stream:true});
  }
  return JSON.parse(raw+decoder.decode());
 }catch{return null;}
 finally{void stream.cancel().catch(()=>{});}
}

async function mcp(request,url,{handoffEnabled,catalogCall}){
 if(request.method!=='POST'||url.search||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))
  return deny(404,'CLEAN_SITE_ROUTE_NOT_FOUND');
 // These headers are supplied by the existing Sites audience gateway, not a new login.
 if(!request.headers.get('oai-authenticated-user-id')||!request.headers.get('oai-authenticated-user-email'))
  return deny(401,'SIGN_IN_REQUIRED');
 const message=await json(request);
 if(!only(message,['jsonrpc','id','method','params'])||message.jsonrpc!=='2.0'||typeof message.method!=='string'||
    (Object.hasOwn(message,'id')&&typeof message.id!=='string'&&!Number.isSafeInteger(message.id)))
  return deny(400,'CLEAN_SITE_MCP_INVALID');
 const origin=request.headers.get('origin');
 if(origin&&origin!==url.origin)return deny(403,'ORIGIN_FORBIDDEN');
 if(!Object.hasOwn(message,'id')){
  return message.method==='notifications/initialized'&&(!message.params||only(message.params,[]))?
   new Response(null,{status:202,headers}):deny(403,'CLEAN_SITE_MCP_DENIED');
 }
 if(message.method==='initialize'){
  const v=message.params;
  if(!only(v,['protocolVersion','capabilities','clientInfo','_meta'])||typeof v.protocolVersion!=='string'||
     !record(v.capabilities)||!record(v.clientInfo))return deny(400,'CLEAN_SITE_MCP_INVALID');
  return rpc(message.id,{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'npcgen-site',version:'1.0.0'}});
 }
 if(message.method==='ping'&&(!message.params||only(message.params,['_meta'])))return rpc(message.id,{});
 if(message.method==='tools/list'&&(!message.params||only(message.params,['_meta'])))return rpc(message.id,{tools:catalogCall?[{...discoveredTool,description:'Configured Site owner only: request and verify the ephemeral Binari project catalog through approved local PDS MCP.',
  inputSchema:{type:'object',required:['command'],additionalProperties:false,properties:{command:{oneOf:[
   {type:'object',required:['action'],additionalProperties:false,properties:{action:{const:'project-catalog-read-pending'}}},
   {type:'object',required:['action','requestId','result'],additionalProperties:false,properties:{action:{const:'project-catalog-read-reply'},requestId:{type:'string'},result:{type:'object'}}},
  ]}}},annotations:{readOnlyHint:false}}]:handoffEnabled?[discoveredTool]:[]});
 const params=message.params,args=params?.arguments,command=args?.command;
 if(catalogCall&&message.method==='tools/call'&&only(params,['name','arguments','_meta'])&&params.name==='npc_mirror_dispatch'&&
    only(args,['command'])&&record(command)&&catalogActions.has(command.action)&&!request.headers.has('origin'))
  return catalogCall(request,message);
 if(!handoffEnabled||message.method!=='tools/call'||!only(params,['name','arguments','_meta'])||params.name!=='npc_mirror_dispatch'||
    !only(args,['command'])||!only(command,['action','projectId','queueId','receipt'])||
    !handoffs.has(command.action)||command.projectId!=='binari'||request.headers.has('origin'))
  return deny(403,'CLEAN_SITE_MCP_DENIED');
 // The existing handoff route still performs actual Sites-owner, action/ID,
 // payload and receipt checks. The guard alone grants no capability.
 return null;
}

export function rejectCleanSpaceRequest(request,{handoffEnabled=false,catalogCall}={}){
 const url=new URL(request.url),path=url.pathname,method=request.method;
 if(path==='/mcp')return mcp(request,url,{handoffEnabled:handoffEnabled===true,catalogCall});
 if(auth.has(path)&&reads.has(method))return null;
 if(reads.has(method)&&(path==='/'||publicAssets.has(path)||staticBuild.test(path)))return null;
 if(method==='GET'&&bgmReads.has(path))return null;
 if(handoffEnabled===true&&(method==='POST'||method==='GET')&&path==='/api/space/audio-requests')return null;
 return deny(404,'CLEAN_SITE_ROUTE_NOT_FOUND');
}
