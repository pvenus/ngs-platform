/** Node-only, exact Site-audience transport. No browser cookie or operational key. */
import {randomUUID} from 'node:crypto';
const chunkLimit=1024*1024, maxReply=20*1024*1024;
const tokenSyntax=/^[A-Za-z0-9._~+\/-]+={0,2}$/u;
const deny=(status=503)=>({status,bytes:Buffer.alloc(0)});

async function readReply(response){
 const body=response.body?.getReader();if(!body)return null;
 const payload=[];let total=0;
 try{
  for(;;){
   const {value,done}=await body.read();if(done)break;
   total+=value.byteLength;if(total>maxReply)return null;
   payload.push(value);
  }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(payload,total)));
 }finally{await body.cancel().catch(()=>{});body.releaseLock();}
}

function toolFor(path,site){
 const route=new URL(path,site);
 if(route.origin!==site.origin||route.pathname+route.search!==path)throw Error('VIEWER_NATIVE_MCP_ROUTE');
 if(path==='/api/viewer/manifest')return {name:'ngs_viewer_manifest',args:{}};
 if(route.pathname==='/api/viewer/file'&&[...route.searchParams.keys()].sort().join(',')==='offset,path,sha256'){
  const args={path:route.searchParams.get('path'),sha256:route.searchParams.get('sha256'),
   offset:Number(route.searchParams.get('offset'))};
  if(!Number.isSafeInteger(args.offset)||args.offset<0)throw Error('VIEWER_NATIVE_MCP_ROUTE');
  return {name:'ngs_viewer_file_chunk',args};
 }
 throw Error('VIEWER_NATIVE_MCP_ROUTE');
}
function decode(result,name,args){
 const raw=result?.structuredContent;
 if(!Number.isInteger(raw?.status)||Boolean(result.isError)!==(raw.status!==200))return deny();
 if(raw.status!==200)return deny([400,401,403,404,409,413,416,429,503].includes(raw.status)?raw.status:503);
 if(name==='ngs_viewer_manifest')return {status:200,bytes:Buffer.from(JSON.stringify(raw.manifest))};
 const {base64,fileSize,fileSha256,fileOffset}=raw;
 if(typeof base64!=='string'||base64.length>Math.ceil(chunkLimit/3)*4||
    typeof fileSize!=='string'||fileSha256!==args.sha256||fileOffset!==String(args.offset))return deny();
 const bytes=Buffer.from(base64,'base64');
 if(bytes.length>chunkLimit||bytes.toString('base64')!==base64)return deny();
 return {status:200,bytes,fileSize,fileSha256,fileOffset};
}

export function codexViewerRemote({origin,client}){
 const site=new URL(origin);
 return async(path,{signal}={})=>{
  const {name,args}=toolFor(path,site);
  return decode(await client.tool(name,args,{signal}),name,args);
 };
}

export function nativeViewerRemote({origin,accessToken,request=fetch}){
 const site=new URL(origin);
 if(site.protocol!=='https:'||site.origin!==origin||typeof accessToken!=='function')throw Error('VIEWER_NATIVE_MCP_CONFIGURATION');
 const endpoint=new URL('/mcp',site);
 return async(path,{signal}={})=>{
  const {name,args}=toolFor(path,site);
  const id=randomUUID();
  for(let attempt=0;attempt<2;attempt++){
   const token=await accessToken({refresh:attempt>0,signal});
   if(typeof token!=='string'||token.length>8192||!tokenSyntax.test(token))return deny(401);
   const deadline=AbortSignal.timeout(45_000);
   const r=await request(endpoint,{method:'POST',redirect:'error',credentials:'omit',cache:'no-store',
    signal:signal?AbortSignal.any([signal,deadline]):deadline,
    headers:{'authorization':'Bearer '+token,'mcp-protocol-version':'2026-07-28','accept':'application/json','content-type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id,method:'tools/call',params:{name,arguments:args}})});
   if(r.status===401&&attempt===0){await r.body?.cancel();continue;}
   if(!r.ok){await r.body?.cancel();return deny([401,403,429].includes(r.status)?r.status:503);}
   if(!r.headers.get('content-type')?.startsWith('application/json')){await r.body?.cancel();return deny();}
   const packet=await readReply(r);
   if(packet?.jsonrpc!=='2.0'||packet.id!==id)return deny();
   return decode(packet.result,name,args);
  }
  return deny(401);
 };
}
