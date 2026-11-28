/** Authenticate the existing hosted audience; delegate all DTOs to the common registry. */
import {dispatchWorkspaceRead,workspaceReadResource,workspaceReadRoute} from '../ngs-local/sites/npcgen/build/workspace-read-registry.mjs';
import {cinematicVideoResponse} from '../ngs-local/sites/npcgen/build/cinematic-workspace.mjs';
import {openSpaceWorkspaceProject} from './space-workspace-read-storage.mjs';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin'};
const failure=(code,status)=>Object.assign(Error(code),{status});
const error=(code,status)=>Response.json({error:code},{headers,status});
export async function spaceWorkspaceReadResponse(request,replica,{authorize,npcRead}={}){
 const url=new URL(request.url),route=workspaceReadRoute(url.pathname);
 if(!route)return null;
 const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
 if(!userId||!email||userId.length>200||email.length>320)return error('SIGN_IN_REQUIRED',401);
 const origin=request.headers.get('Origin');
 if(origin&&origin!==url.origin||request.headers.get('Sec-Fetch-Site')==='cross-site')return error('ORIGIN_FORBIDDEN',403);
 if(request.method!=='GET')return error('METHOD_NOT_ALLOWED',405);
 try{
  const result=await dispatchWorkspaceRead({pathname:url.pathname,query:url.searchParams,npcRead,
   mediaCache:!request.headers.has('Range')&&!request.headers.has('If-Range'),
   openProject:id=>openSpaceWorkspaceProject(replica,id),
   authorize:async (id,resource)=>{
    const selected=route==='prop'||route==='cinematic'||route==='ui'?resource:
     route==='map'||route==='background'?'cinematics':route==='assembly'?'assembly':
     workspaceReadResource(route==='npc'?'npcs':url.searchParams.get('tab'));
    if(id!=='binari'||await authorize?.({userId,email},id,selected)!==true)
     throw failure('PROJECT_OR_RESOURCE_DENIED',403);
   }});
  if(result.json)return Response.json(result.json,{headers});
  if(route==='cinematic'&&result.mime==='video/mp4'){
   const clip=cinematicVideoResponse(result.bytes,request.headers.get('Range'));
   return new Response(clip.bytes,{status:clip.status,headers:{...headers,...clip.headers,'Content-Security-Policy':"sandbox; default-src 'none'"}});
  }
  return new Response(result.bytes,{headers:{...headers,'Content-Type':result.mime,'Content-Length':String(result.bytes.length),
   'Content-Security-Policy':"sandbox; default-src 'none'"}});
 }catch(e){
  const status=[400,401,403,404,405,409].includes(e?.status)?e.status:503;
  return error(status!==503&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'PROJECT_WORKSPACE_REPLICA_UNAVAILABLE',status);
 }
}
