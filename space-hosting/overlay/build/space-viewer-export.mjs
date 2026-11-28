/** Read-only exports of committed replica objects to an authenticated team viewer. */
const projectId='binari';
const routes=new Set(['/viewer/bridge','/viewer/bridge.js','/api/viewer/manifest','/api/viewer/file']);
const sizeMax=5*1024**4;
const chunkLimit=1024*1024;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/u.test(v);
const privateHeaders={
 'cache-control':'private, no-store','x-content-type-options':'nosniff',
 'cross-origin-resource-policy':'same-origin','referrer-policy':'no-referrer'
};
const htmlHeaders={...privateHeaders,'content-type':'text/html; charset=utf-8','cross-origin-opener-policy':'unsafe-none',
 'content-security-policy':"default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"};
const need=(valid,status=400,error='VIEWER_INVALID_REQUEST')=>{if(!valid)throw Object.assign(Error(error),{status});};
const problem=(status,error,extra={})=>Response.json({error},{status,headers:{...privateHeaders,...extra}});
const scopes=['project','concept','npcs','motion-presets','props','cinematics','assembly','audio'];
const encoder=new TextEncoder();

export function viewerResource(path){
 if(typeof path!=='string'||!path.isWellFormed()||encoder.encode(path).length>980)return null;
 if(path==='project.json'||path==='icon.png')return 'project';
 const parts=path.split('/');
 if(parts.length<2||parts.length>64||parts.some(part=>!part||part.startsWith('.')||encoder.encode(part).length>255||
  /[\\\u0000-\u001f\u007f]/u.test(part)))return null;
 const root=parts[0];
 return root==='cinematics'&&parts[1]==='assemblies'?'assembly':
  scopes.includes(root)&&root!=='project'&&root!=='assembly'?root:null;
}
const sizeOK=size=>Number.isSafeInteger(size)&&size>=0&&size<=sizeMax;
const versionOK=(item,sha256)=>item?.customMetadata?.sha256===sha256&&sizeOK(item.size)&&
 typeof item.etag==='string'&&item.etag.length>0;
const actorOf=request=>{
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 return userId&&email&&userId.length<=200&&email.length<=320?{userId,email}:null;
};

function bridgePage(message,script=false){
 return '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NGS Viewer 연결</title>'+
 '<main><h1>NGS Viewer 연결</h1><p id="viewer-status">'+message+'</p>'+
 (script?'<button id="viewer-allow" type="button">이 로컬 Viewer 연결 허용</button>':'')+'</main>'+
 (script?'<script type="module" src="/viewer/bridge.js"></script>':'');
}
async function boundedBody(body,length){
 need(body&&typeof body.getReader==='function',503,'VIEWER_EXPORT_UNAVAILABLE');
 const bytes=new Uint8Array(length);const reader=body.getReader();let written=0;
 try{
  for(;;){
   const {value,done}=await reader.read();
   if(done)break;
   need(value instanceof Uint8Array&&written+value.length<=length,503,'VIEWER_EXPORT_UNAVAILABLE');
   bytes.set(value,written);written+=value.length;
  }
  need(written===length,503,'VIEWER_EXPORT_UNAVAILABLE');
  return bytes;
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export async function spaceViewerResponse(request,{replica,authorizeParticipant,authorizeResource,bridgeScript}={}){
 const url=new URL(request.url),route=url.pathname;
 if(!routes.has(route))return null;
 try{
  const bridge=route.startsWith('/viewer/');
  need(request.method==='GET',405,'METHOD_NOT_ALLOWED');
  // Only navigation to the bridge HTML is cross-site; scripts and export API
  // requests must come from the same Space page. There are no CORS headers.
  const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');
  if(route!=='/viewer/bridge'){
   need((!origin||origin===url.origin)&&site!=='cross-site',403,'ORIGIN_FORBIDDEN');
  }else{
   need(!origin||origin===url.origin,403,'ORIGIN_FORBIDDEN');
   need(!request.headers.has('Sec-Fetch-Dest')||request.headers.get('Sec-Fetch-Dest')==='document',403,'ORIGIN_FORBIDDEN');
  }
  const user=actorOf(request);
  if(!user&&route==='/viewer/bridge')return new Response(bridgePage(
   '먼저 <a href="/" target="_blank" rel="noopener noreferrer">Space에서 로그인</a>한 뒤 로컬 Viewer에서 다시 연결하세요.'
  ),{status:401,headers:htmlHeaders});
  need(user,401,'SIGN_IN_REQUIRED');
  need(await authorizeParticipant?.(user)===true,403,'PROJECT_OR_RESOURCE_DENIED');
  const granted=async resource=>resource==='project'||resource==='audio'||
    await authorizeResource?.(user,projectId,resource==='motion-presets'?'npcs':resource)===true;
  if(bridge){
   need(!url.search);
   if(route==='/viewer/bridge')return new Response(bridgePage('본인이 실행한 로컬 NGS Viewer에만 연결을 허용하세요. 접속한 Space 계정으로 팀 파일을 내려받고 정식 요청을 보낼 수 있게 됩니다.',true),{headers:htmlHeaders});
   need(typeof bridgeScript==='string',503,'VIEWER_EXPORT_UNAVAILABLE');
   return new Response(bridgeScript,{headers:{...privateHeaders,'content-type':'text/javascript; charset=utf-8'}});
  }
  need(replica,503,'VIEWER_EXPORT_UNAVAILABLE');
  if(route==='/api/viewer/manifest'){
   need(!url.search);
   const resources=(await Promise.all(scopes.map(async r=>await granted(r)?r:null))).filter(Boolean);
   const inventory=await replica.listWithSizes();
   const files=inventory.filter(item=>resources.includes(viewerResource(item.path)));
   return Response.json({projectId,resources,files},{headers:privateHeaders});
  }
  const q=url.searchParams;
  need([...q.keys()].sort().join(',')==='offset,path,sha256');
  const path=q.get('path'),sha256=q.get('sha256'),rawOffset=q.get('offset'),resource=viewerResource(path);
  need(resource&&hash(sha256)&&/^(?:0|[1-9][0-9]{0,15})$/u.test(rawOffset));
  need(await granted(resource),403,'PROJECT_OR_RESOURCE_DENIED');
  const offset=Number(rawOffset);
  need(sizeOK(offset));
  const info=await replica.head(path);
  need(info,404,'VIEWER_FILE_NOT_FOUND');
  need(versionOK(info,sha256),409,'VIEWER_FILE_VERSION_CHANGED');
  need(info.size===0?offset===0:offset<info.size,416,'VIEWER_FILE_RANGE_INVALID');
  const length=Math.min(chunkLimit,info.size-offset);
  let bytes=null;
  if(length){
   const item=await replica.get(path,{onlyIf:{etagMatches:info.etag},range:{offset,length}});
   if(!versionOK(item,sha256)||item.etag!==info.etag||item.size!==info.size){
    await item?.body?.cancel().catch(()=>{});
    need(false,409,'VIEWER_FILE_VERSION_CHANGED');
   }
   bytes=await boundedBody(item.body,length);
  }
  return new Response(bytes,{headers:{...privateHeaders,'Content-Type':'application/octet-stream','Content-Length':String(length),
   'Content-Security-Policy':"sandbox; default-src 'none'",'x-ngs-file-size':String(info.size),
   'x-ngs-file-sha256':sha256,'x-ngs-file-offset':String(offset)}});
 }catch(e){
  const status=[400,401,403,404,405,409,416].includes(e?.status)?e.status:503;
  return problem(status,status===503?'VIEWER_EXPORT_UNAVAILABLE':e.message,status===405?{Allow:'GET'}:{});
 }
}
