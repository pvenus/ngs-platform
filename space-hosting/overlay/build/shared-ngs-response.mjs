/** Native Sites-authenticated shared shell only; no local session spoof or legacy data. */
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const errors=(status,error,extra={})=>Response.json({error},{status,headers:{...headers,...extra}});
const auth=req=>Boolean(req.headers.get('oai-authenticated-user-id')&&req.headers.get('oai-authenticated-user-email'));
const unavailable=new Map([
 ['/__npcgen_session','GET'],['/api/project-folders','GET'],['/api/project-folders/discover','GET'],
 ['/api/project-folders/compare','POST'],['/api/project-folders/refresh','POST'],['/api/project-folders/icon','GET'],
 ['/api/folders/compare','POST'],['/api/folders/refresh','POST'],['/api/audio-workspace','GET'],
 ['/api/project-workspace','GET'],['/api/npc-workspace','GET'],['/api/prop-workspace','GET'],['/api/requests','POST'],
]);
const previousHostedBgm=new Set(['/api/space/audio-workspace','/api/space/audio-concepts','/api/space/audio-requests']);
const csp="default-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; img-src 'self' blob:";

export function withProductionAudio(html){
 const opening='<html lang="ko">';
 if(typeof html!=='string'||html.split(opening).length!==2)throw Error('SHARED_NGS_HTML_SOURCE_UNCONFIRMED');
 return html.replace(opening,'<html lang="ko" data-audio-workspace="enabled">');
}

export function createSharedNgsResponse(assets){
 return (request,{catalogRelay=false}={})=>{
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(catalogRelay&&['/__npcgen_session','/api/space/project-catalog'].includes(path))return null;
  if(previousHostedBgm.has(path))return errors(404,'CLEAN_SITE_ROUTE_NOT_FOUND');
  const expected=unavailable.get(path);
  if(expected){
   if(method!==expected)return errors(405,'METHOD_NOT_ALLOWED',{'Allow':expected});
   if(!auth(request))return errors(401,'SIGN_IN_REQUIRED');
   // No live MCP binding exists here yet. Never reuse the owner’s Local
   // session, issue a placeholder CSRF token, or touch legacy D1/R2 data.
   return errors(503,'LIVE_NGS_BACKEND_NOT_CONNECTED');
  }
  const asset=assets.get(path);
  if(!asset)return null;
  if(!['GET','HEAD'].includes(method))return errors(405,'METHOD_NOT_ALLOWED',{'Allow':'GET, HEAD'});
  if(!auth(request)){
   if(path!=='/')return errors(401,'SIGN_IN_REQUIRED');
   const returnTo=url.search.length<=2048?'/'+url.search:'/';
   return new Response(null,{status:302,headers:{...headers,Location:'/signin-with-chatgpt?'+new URLSearchParams({return_to:returnTo})}});
  }
  return new Response(method==='HEAD'?null:asset.body,{headers:{...headers,'Content-Type':asset.type,
   ...(path==='/'?{'Content-Security-Policy':csp}:{})}});
 };
}
