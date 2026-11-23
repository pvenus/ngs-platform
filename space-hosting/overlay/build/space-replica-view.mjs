/** Native Space origin/session authorization for common object read projections. */
import {audioFile,playlist,projectRow,projectIcon,soundConcepts} from '../ngs-local/sites/npcgen/build/object-replica-view.mjs';
const projectId='binari',project='/api/project-folders',icon=project+'/icon',audio='/api/audio-workspace',concepts='/api/space/audio-concepts';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const knownRoutes=new Set([project,icon,audio,concepts]);
const need=(ok,status,code)=>{if(!ok)throw Object.assign(Error(code),{status});};
const unavailable=()=>need(false,503,'SPACE_REPLICA_VIEW_UNAVAILABLE');
const exactKeys=(params,expected)=>[...params.keys()].sort().join(',')===expected;
const json=(body,status=200)=>Response.json(body,{status,headers});
/** Handle only this explicit GET/HEAD route set after existing native auth and Binari grant. */
export async function spaceReplicaView(request,replica,{authorize}={}){
 const url=new URL(request.url),path=url.pathname,q=url.searchParams;
 if(!knownRoutes.has(path))return null;
 try{
  const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
  need(userId&&email&&userId.length<=200&&email.length<=320,401,'SIGN_IN_REQUIRED');
  const origin=request.headers.get('origin');
  need((!origin||origin===url.origin)&&request.headers.get('sec-fetch-site')!=='cross-site',403,'ORIGIN_FORBIDDEN');
  need(await authorize({userId,email},projectId)===true,403,'PROJECT_OR_RESOURCE_DENIED');
  need(replica,503,'SPACE_REPLICA_VIEW_UNAVAILABLE');
  need(request.method==='GET'||request.method==='HEAD',405,'METHOD_NOT_ALLOWED');
  if(path===project){
   need(!url.search,400,'PROJECT_FOLDER_QUERY_INVALID');
   const row=await projectRow(replica);
   return request.method==='HEAD'?new Response(null,{headers}):json({projects:row?[row]:[]});
  }
  if(path===concepts){
   need(!url.search,400,'AUDIO_CONCEPT_QUERY_INVALID');
   return request.method==='HEAD'?new Response(null,{headers}):json(await soundConcepts(replica));
  }
  need(q.getAll('projectId').length===1&&q.get('projectId')===projectId,403,'PROJECT_OR_RESOURCE_DENIED');
  if(path===icon)return await projectIcon(request,replica,q);
  if(q.has('id'))return await audioFile(request,replica,q);
  const data=await playlist(replica,q);
  return request.method==='HEAD'?new Response(null,{headers}):json(data);
 }catch(e){
  const status=[400,401,403,404,405].includes(e?.status)?e.status:503;
  return json({error:status===503?'SPACE_REPLICA_VIEW_UNAVAILABLE':e.message},status);
 }
}
