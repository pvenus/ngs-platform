// Share the exact Workspace and audio response schemas; data comes only from P2.
import {openObjectWorkspaceProject} from '../../ngs-local/sites/npcgen/build/object-workspace-read-storage.mjs';
import {openLocalWorkspaceProject} from '../../ngs-local/sites/npcgen/build/local-project-workspace.mjs';
import {dispatchWorkspaceRead,workspaceReadResource,workspaceReadRoute} from '../../ngs-local/sites/npcgen/build/workspace-read-registry.mjs';
import {cinematicVideoResponse} from '../../ngs-local/sites/npcgen/build/cinematic-workspace.mjs';
import {audioFile,playlist,projectIcon,projectRow,soundConcepts} from '../../ngs-local/sites/npcgen/build/object-replica-view.mjs';
import {audioIndexPath,readAudioIndexBytes,parseAudioCursor,audioCursor,audioPageSize,audioIndexResult} from '../../ngs-local/sites/npcgen/build/audio-result-index.mjs';

const fault=(code,status)=>Object.assign(Error(code),{status});
const readRoutes=new Set(['/api/project-folders','/api/project-folders/icon','/api/audio-workspace','/api/space/audio-concepts']);
export const viewerReadRoute=path=>readRoutes.has(path)||Boolean(workspaceReadRoute(path));

const cachedView=new WeakMap();
function view(root,rows,openProject){
 const cached=cachedView.get(rows);
 if(cached?.root===root)return cached.local;
 const local=openProject?openProject():openLocalWorkspaceProject(root,'binari');
 if(!local)return null;
 const inventory=new Map(rows.map(row=>[row.path,row])), directories=new Map();
 for(const path of inventory.keys()){
  let parent='';
  const parts=path.split('/');
  for(let i=0;i<parts.length;i++){
   const name=parts[i];
   if(!directories.has(parent))directories.set(parent,new Map());
   directories.get(parent).set(name,{name,kind:i+1===parts.length?'file':'directory'});
   parent=parent?parent+'/'+name:name;
  }
 }
 const visible={
  head(path){const row=inventory.get(path),info=row&&local.head(path);return row&&info?.size===row.size?info:null;},
  readBytes(path,limit){const row=inventory.get(path);if(!row||row.size>limit)return null;
   const bytes=local.readBytes(path,limit);return bytes?.length===row.size?bytes:null;},
  listChildren(prefix){return [...(directories.get(prefix)?.values()??[])];},
  listFiles(prefix){return rows.filter(row=>!prefix||row.path.startsWith(prefix+'/')).flatMap(row=>{
   const info=this.head(row.path);return info?[{path:row.path,size:info.size}]:[];
  });},
  inventory
 };
 cachedView.set(rows,{root,local:visible});
 return visible;
}

function objectView(local){
 const indexed=[];
 const head=path=>{
  const r=local?.inventory.get(path),h=r&&local.head(path);
  return h&&{size:r.size,etag:r.sha256,customMetadata:{sha256:r.sha256}};
 };
 return {
  head,
  get(path,{onlyIf,range}={}){
   const meta=head(path);
   if(!meta||onlyIf?.etagMatches&&meta.etag!==onlyIf.etagMatches)return null;
   let bytes=local.readBytes(path,Math.max(1,meta.size));
   if(!bytes)return null;
   if(range)bytes=bytes.subarray(range.offset,range.offset+range.length);
   return {...meta,body:bytes,arrayBuffer:async()=>Uint8Array.from(bytes).buffer};
  },
  audioIndex({projectId,resultId,cursor}){
   for(const [path,entry] of local?.inventory??[]){
    const pick=audioIndexPath(path);
    if(!pick||pick[2]!=='metadata.json'||entry.size>65536||resultId&&pick[1]!==resultId)continue;
    const id=pick[1],raw=local.readBytes(path,65536);
    const summary=raw&&readAudioIndexBytes(raw,id,entry.sha256),wav=head('audio/'+id+'/audio.wav');
    if(summary&&wav?.etag===summary.sha256&&wav.size===summary.bytes)
     indexed.push({id,generated_at:summary.generatedAt,title:summary.title,bpm:summary.bpm,separated:summary.separated,
      metadata_audio_sha:summary.sha256,duration_seconds:summary.durationSeconds});
   }
   if(resultId)return {projectId,results:indexed.map(audioIndexResult)};
   const boundary=cursor?parseAudioCursor(cursor):null;
   const sorted=indexed.sort((a,b)=>b.generated_at-a.generated_at||b.id.localeCompare(a.id))
      .filter(row=>!boundary||row.generated_at<boundary.date||row.generated_at===boundary.date&&row.id<boundary.id);
   const page=sorted.slice(0,audioPageSize);
   return {projectId,results:page.map(audioIndexResult),nextCursor:sorted.length>page.length?audioCursor(page.at(-1)):null};
  }
 };
}

// Audio uses the same replica files; use the committed manifest to enumerate
// candidates for historical reads while the shared live D1 index is ahead.
function pinnedObject(replica,snapshot){
 const object=replica.atVersion(snapshot.version);
 return {...object,async audioIndex({projectId,resultId,cursor}){
  const boundary=cursor?parseAudioCursor(cursor):null;
  if(!boundary&&cursor)throw fault('NGS_AUDIO_CURSOR_INVALID',400);
  const index=new Map(snapshot.files.map(row=>[row.path,row]));
  const rows=[];
  for(const [path,entry] of index){
   const pick=audioIndexPath(path);
   if(!pick||pick[2]!=='metadata.json'||entry.size>65536||resultId&&pick[1]!==resultId)continue;
   const id=pick[1],wav=index.get('audio/'+id+'/audio.wav');
   if(!wav)continue;
   const meta=await object.get(path);
   if(meta?.customMetadata?.sha256!==entry.sha256){await meta?.body?.cancel();continue;}
   const summary=readAudioIndexBytes(new Uint8Array(await meta.arrayBuffer()),id,entry.sha256);
   if(summary&&wav.sha256===summary.sha256&&wav.size===summary.bytes)
    rows.push({id,generated_at:summary.generatedAt,title:summary.title,bpm:summary.bpm,separated:summary.separated,
      metadata_audio_sha:summary.sha256,duration_seconds:summary.durationSeconds});
  }
  if(resultId)return {projectId,result:rows[0]?audioIndexResult(rows[0]):null};
  const sorted=rows.sort((a,b)=>b.generated_at-a.generated_at||b.id.localeCompare(a.id))
   .filter(row=>!boundary||row.generated_at<boundary.date||row.generated_at===boundary.date&&row.id<boundary.id);
  const page=sorted.slice(0,audioPageSize);
  return {projectId,results:page.map(audioIndexResult),nextCursor:sorted.length>page.length?audioCursor(page.at(-1)):null};
 }};
}

export async function localProjection({root,snapshot,url,method,range,openProject,replica}){
 const path=url.pathname,section=workspaceReadRoute(path);
 if(!snapshot)throw fault('VIEWER_SYNC_REQUIRED',503);
 const r2=replica?pinnedObject(replica,snapshot):null;
 const resources=new Set(snapshot.resources), project=(id,resource)=>{
  if(id!=='binari'||!resources.has(resource))throw fault('PROJECT_OR_RESOURCE_DENIED',403);
 };
 if(section){
  if(method!=='GET')throw fault('METHOD_NOT_ALLOWED',405);
  const local=r2?openObjectWorkspaceProject(r2,'binari'):view(root,snapshot.files,openProject);
  const result=await dispatchWorkspaceRead({pathname:path,query:url.searchParams,openProject:id=>id==='binari'?local:null,
   authorize:(id,resource)=>project(id,section==='prop'||section==='cinematic'?resource:
     section==='map'||section==='background'?'cinematics':section==='assembly'?'assembly':
     workspaceReadResource(section==='npc'?'npcs':url.searchParams.get('tab')))});
  if(result.json)return Response.json(result.json);
  if(section==='cinematic'&&result.mime==='video/mp4'){
   const clip=cinematicVideoResponse(result.bytes,range);
   return new Response(clip.bytes,{status:clip.status,headers:clip.headers});
  }
  return new Response(result.bytes,{headers:{'Content-Type':result.mime,'Content-Length':String(result.bytes.length)}});
 }
 if(!['GET','HEAD'].includes(method))throw fault('METHOD_NOT_ALLOWED',405);
 const object=r2??objectView(view(root,snapshot.files,openProject));
 if(path==='/api/project-folders'){
  project('binari','project');
  if(url.search)throw fault('PROJECT_FOLDER_QUERY_INVALID',400);
  const row=await projectRow(object);
  return Response.json({projects:row?[row]:[]});
 }
 if(path==='/api/space/audio-concepts'){
  project('binari','concept');
  if(url.search)throw fault('AUDIO_CONCEPT_QUERY_INVALID',400);
  return Response.json(await soundConcepts(object));
 }
 const request=new Request(url,{method,headers:range?{Range:range}:{}});
 const id=url.searchParams.get('projectId');
 if(url.searchParams.getAll('projectId').length!==1)throw fault('PROJECT_OR_RESOURCE_DENIED',403);
 if(path==='/api/project-folders/icon'){
  project(id,'project');return projectIcon(request,object,url.searchParams);
 }
 project(id,'audio');
 return url.searchParams.has('id')?audioFile(request,object,url.searchParams):Response.json(await playlist(object,url.searchParams));
}
