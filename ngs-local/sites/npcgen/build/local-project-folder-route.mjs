import {validProjectId} from './local-project-folders.mjs';

export const projectFolderRoutes=new Set([
 '/api/project-folders','/api/project-folders/discover','/api/project-folders/compare','/api/project-folders/refresh','/api/project-folders/icon',
]);
const reject=(code,status)=>Object.assign(Error(code),{status});

export async function localProjectFolderRoute(req,res,{origin,catalog,session,auth,projectPermission,bytes}){
 const target=new URL(req.url,origin);
 const path=target.pathname;
 if(!projectFolderRoutes.has(path))throw reject('NOT_FOUND',404);
 const post=path.endsWith('/refresh')||path.endsWith('/compare');
 if(req.method!==(post?'POST':'GET'))throw reject('METHOD_NOT_ALLOWED',405);
 if(!session?.principal)throw reject('LOCAL_SIGN_IN_REQUIRED',401);
 const latest=()=>{
  const current=auth.read(req);
  if(!current?.principal||current.contextId!==session.contextId)throw reject('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
  return current.principal;
 };
 const allowed=(principal,projectId)=>projectPermission(principal,projectId,undefined,false);
 const filter=principal=>projectId=>{
  try{allowed(principal,projectId);return true;}
  catch(error){if(error.status===403)return false;throw error;}
 };
 function reply(body,type='application/json'){
  res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',type);
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-NPCGen-Frontend-Context',session.contextId);
  return res.end(type==='application/json'?JSON.stringify(body):body);
 }
 if(path.endsWith('/icon')){
  const entries=[...target.searchParams],projectId=target.searchParams.get('projectId'),hash=target.searchParams.get('sha256');
  if(entries.length!==2||!validProjectId(projectId)||hash?.length!==64||!/^[a-f0-9]{64}$/.test(hash)){
   throw reject('PROJECT_FOLDER_ICON_QUERY_INVALID',400);
  }
  allowed(latest(),projectId);
  const icon=catalog.icon(projectId,hash);
  if(!icon)throw reject('PROJECT_FOLDER_ICON_NOT_FOUND',404);
  return reply(icon,'image/png');
 }
 if(target.search)throw reject('PROJECT_FOLDER_QUERY_INVALID',400);
 if(post){
  if(req.headers.origin!==origin)throw reject('ORIGIN_OR_CSRF_REJECTED',403);
  auth.csrf(req,session);
  if(req.headers['x-npcgen-frontend-context']!==session.contextId)throw reject('FRONTEND_SESSION_CONTEXT_CHANGED',409);
  let input;
  try{input=JSON.parse(bytes.toString());}catch{throw reject('PROJECT_FOLDER_ACTION_INVALID',400);}
  if(path.endsWith('/compare')){
   const ids=input?.projectIds;
   if(!input||Object.keys(input).join(',')!=='projectIds'||!Array.isArray(ids)||!ids.length
      ||ids.some(id=>!validProjectId(id))||new Set(ids).size!==ids.length){
    throw reject('PROJECT_FOLDER_COMPARE_INVALID',400);
   }
   const principal=latest();
   for(const id of ids)allowed(principal,id);
   const result=await catalog.compare(ids);
   const readable=filter(latest());
   return reply({groups:result.groups.filter(group=>readable(group.projectId)),
    unavailable:result.unavailable.filter(readable)});
  }
  if(!input||Object.keys(input).join(',')!=='projectId'||!validProjectId(input.projectId)){
   throw reject('PROJECT_FOLDER_REFRESH_INVALID',400);
  }
  allowed(latest(),input.projectId);
  let result;
  try{result=await catalog.refresh(input.projectId);}catch(error){
   if(['PROJECT_FOLDER_COMPARE_REQUIRED','FOLDER_SYNC_COMPARE_REQUIRED'].includes(error.message))throw reject(error.message,409);
   throw reject('PROJECT_FOLDER_REFRESH_UNAVAILABLE',503);
  }
  allowed(latest(),input.projectId);
  return reply(result);
 }
 if(path.endsWith('/discover')){
  let ids;
  try{ids=await catalog.discover();}catch{throw reject('PROJECT_FOLDER_DISCOVERY_UNAVAILABLE',503);}
  return reply({projects:ids.filter(filter(latest()))});
 }
 const readable=filter(latest());
 const projects=catalog.list(readable),refreshes=catalog.refreshes?.(readable);
 return reply({projects,...(refreshes?.length?{refreshes}:{})});
}
