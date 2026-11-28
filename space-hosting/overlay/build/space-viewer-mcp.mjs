/** The platform-authenticated native MCP port. Never grants a second identity. */
import {spaceViewerResponse} from './space-viewer-export.mjs';

const exportsByTool=new Map([
 ['ngs_viewer_manifest','/api/viewer/manifest'],
 ['ngs_viewer_file_chunk','/api/viewer/file'],
 ['ngs_viewer_request_session','/__npcgen_session'],
 ['ngs_viewer_request_status','/api/requests'],
 ['ngs_viewer_request_submit','/api/requests'],
]);
const schema=(properties,required=[])=>({type:'object',additionalProperties:false,properties,required});
export const spaceViewerMcpTools=[
 {name:'ngs_viewer_manifest',description:'Read only the Binari replica inventory visible to the currently signed-in team member.',
  inputSchema:schema({}),annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:'ngs_viewer_file_chunk',description:'Read a bounded file chunk from the granted Binari replica, pinned to SHA-256.',
  inputSchema:schema({path:{type:'string'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},offset:{type:'integer',minimum:0}},['path','sha256','offset']),
  annotations:{readOnlyHint:true,destructiveHint:false}},
 {name:'ngs_viewer_request_session',description:'Read enabled NGS request actions for the signed-in Binari team member.',inputSchema:schema({}),annotations:{readOnlyHint:true}},
 {name:'ngs_viewer_request_status',description:'Read only this signed-in team member’s formal Space queue status.',
  inputSchema:schema({queueId:{type:'string'}}),annotations:{readOnlyHint:true}},
 {name:'ngs_viewer_request_submit',description:'Immediately submit a user-chosen formal NGS request to Space. Requires the same authenticated write grant and validation as the website.',
  inputSchema:schema({command:{type:'object'}},['command']),annotations:{readOnlyHint:false}},
];
export async function appendViewerDiscovery(request,original){
 if(new URL(request.url).pathname!=='/mcp'||!original.ok||
    !request.headers.get('oai-authenticated-user-id')||!request.headers.get('oai-authenticated-user-email'))return original;
 const call=await parse(request);
 if(call?.method!=='tools/list')return original;
 const body=await original.clone().json().catch(()=>null);
 if(body?.id!==call.id||!Array.isArray(body?.result?.tools))return original;
 return response({...body,result:{...body.result,tools:[...body.result.tools,...spaceViewerMcpTools]}});
}
const record=x=>x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,s)=>record(x)&&Object.keys(x).sort().join(',')===s;
const manifestLimit=16*1024*1024, chunkLimit=1024*1024;
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
const response=(value,status=200)=>Response.json(value,{status,headers});
const rpc=(id,value)=>response({jsonrpc:'2.0',id,result:{
 content:[{type:'text',text:[200,202].includes(value.status)?'Viewer request succeeded':'Viewer request failed'}],
 structuredContent:value,isError:![200,202].includes(value.status),
}});
const fail=(id,status)=>rpc(id,{status});
async function parse(request){
 const reader=request.clone().body?.getReader();if(!reader)return null;
 const text=new TextDecoder('utf-8',{fatal:true});let raw='',total=0;
 try{
  for(;;){
   const {value,done}=await reader.read();if(done)break;
   total+=value.byteLength;if(total>72*1024)return null;
   raw+=text.decode(value,{stream:true});
  }
  return JSON.parse(raw+text.decode());
 }catch{return null;}
 finally{void reader.cancel().catch(()=>{});}
}
function base64(bytes){
 let raw='';
 for(let offset=0;offset<bytes.length;offset+=16_384)raw+=String.fromCharCode(...bytes.subarray(offset,offset+16_384));
 return btoa(raw);
}

const validArgs=(name,a)=>name==='ngs_viewer_file_chunk'?keys(a,'offset,path,sha256'):
 name==='ngs_viewer_request_submit'?keys(a,'command')&&record(a.command):
 name==='ngs_viewer_request_status'?keys(a,'')||keys(a,'queueId')&&typeof a.queueId==='string'&&a.queueId.length<=90:keys(a,'');
export async function spaceViewerMcpResponse(request,options){
 const url=new URL(request.url);
 if(url.pathname!=='/mcp'||url.search||request.method!=='POST'||request.headers.has('origin')||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type')??''))return null;
 const m=await parse(request),p=m?.params,route=exportsByTool.get(p?.name);
 if(m?.method!=='tools/call'||!route)return null; // retain the existing native guard for every other tool
 const id=m.id,a=p.arguments;
 if(m.jsonrpc!=='2.0'||!(Number.isSafeInteger(id)||typeof id==='string'&&id.length<=64)||
    !keys(m,'id,jsonrpc,method,params')||!(keys(p,'arguments,name')||keys(p,'_meta,arguments,name'))||
    !validArgs(p.name,a))
  return response({error:'VIEWER_MCP_INVALID'},400);
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!userId||!email)return fail(id,401);
 const location=new URL(route,url.origin);
 if(p.name==='ngs_viewer_file_chunk'){
  if(typeof a.path!=='string'||typeof a.sha256!=='string'||!Number.isSafeInteger(a.offset))return fail(id,400);
  location.search=new URLSearchParams({path:a.path,sha256:a.sha256,offset:a.offset}).toString();
 }
 const requestIdentity={'oai-authenticated-user-id':userId,'oai-authenticated-user-email':email};
 if(p.name.startsWith('ngs_viewer_request_')){
  if(typeof options?.requestQueue!=='function')return fail(id,503);
  if(await options.authorizeParticipant?.({userId,email})!==true)return fail(id,403);
  if(a.queueId)location.searchParams.set('queueId',a.queueId);
  const result=await options.requestQueue(location,requestIdentity,a.command);
  if(!result?.ok)return fail(id,result?.status??503);
  const data=await result.json();
  // Tokens used to connect the canonical internal route never cross MCP.
  if(p.name==='ngs_viewer_request_session'){
   delete data.csrfToken;delete data.contextId;
  }
  return rpc(id,{status:result.status,data});
 }
 const result=await spaceViewerResponse(new Request(location,{headers:requestIdentity}),options);
 if(!result?.ok)return fail(id,result?.status??503);
 if(p.name==='ngs_viewer_manifest'){
  const body=await result.text();
  if(body.length>manifestLimit)return fail(id,413);
  return rpc(id,{status:200,manifest:JSON.parse(body)});
 }
 const bytes=new Uint8Array(await result.arrayBuffer());
 if(bytes.length>chunkLimit)return fail(id,503);
 return rpc(id,{status:200,base64:base64(bytes),fileSize:result.headers.get('x-ngs-file-size'),
  fileSha256:result.headers.get('x-ngs-file-sha256'),fileOffset:result.headers.get('x-ngs-file-offset')});
}
