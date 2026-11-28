/** The platform-authenticated native MCP port. Never grants a second identity. */
import {spaceViewerResponse} from './space-viewer-export.mjs';

const exportsByTool=new Map([
 ['ngs_viewer_manifest','/api/viewer/manifest'],
 ['ngs_viewer_file_chunk','/api/viewer/file'],
]);
const record=x=>x&&typeof x==='object'&&!Array.isArray(x);
const keys=(x,s)=>record(x)&&Object.keys(x).sort().join(',')===s;
const manifestLimit=16*1024*1024, chunkLimit=1024*1024;
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff'};
const response=(value,status=200)=>Response.json(value,{status,headers});
const rpc=(id,value)=>response({jsonrpc:'2.0',id,result:{
 content:[{type:'text',text:value.status===200?'Read succeeded':'Viewer read failed'}],
 structuredContent:value,isError:value.status!==200,
}});
const fail=(id,status)=>rpc(id,{status});
async function parse(request){
 const reader=request.clone().body?.getReader();if(!reader)return null;
 const text=new TextDecoder('utf-8',{fatal:true});let raw='',total=0;
 try{
  for(;;){
   const {value,done}=await reader.read();if(done)break;
   total+=value.byteLength;if(total>16_384)return null;
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

export async function spaceViewerMcpResponse(request,options){
 const url=new URL(request.url);
 if(url.pathname!=='/mcp'||url.search||request.method!=='POST'||request.headers.has('origin')||
    !/^application\/json(?:;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type')??''))return null;
 const m=await parse(request),p=m?.params,route=exportsByTool.get(p?.name);
 if(m?.method!=='tools/call'||!route)return null; // retain the existing native guard for every other tool
 const id=m.id,a=p.arguments;
 if(m.jsonrpc!=='2.0'||!(Number.isSafeInteger(id)||typeof id==='string'&&id.length<=64)||
    !keys(m,'id,jsonrpc,method,params')||!(keys(p,'arguments,name')||keys(p,'_meta,arguments,name'))||
    !keys(a,p.name==='ngs_viewer_manifest'?'':'offset,path,sha256'))
  return response({error:'VIEWER_MCP_INVALID'},400);
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!userId||!email)return fail(id,401);
 const location=new URL(route,url.origin);
 if(p.name==='ngs_viewer_file_chunk'){
  if(typeof a.path!=='string'||typeof a.sha256!=='string'||!Number.isSafeInteger(a.offset))return fail(id,400);
  location.search=new URLSearchParams({path:a.path,sha256:a.sha256,offset:a.offset}).toString();
 }
 const requestIdentity={'oai-authenticated-user-id':userId,'oai-authenticated-user-email':email};
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
