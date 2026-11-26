import {cinematicSequencePrefix,cinematicArchivePath,validCinematicArchive,validCinematicSequenceResult,validBackgroundResult} from './cinematic-sequence-contract.mjs';
import {backgroundIdFromRequest} from './map-contract.mjs';
import {validBackgroundLoopPlayback} from './cinematic-timeline.mjs';
import {cinematicHash,cinematicId,maxCinematicBytes} from './cinematic-contract.mjs';
import {hashReplicaBytes,readReplicaObject,replicaUnavailable} from './workspace-read-storage.mjs';
const root='cinematics/backgrounds',failure=(message,status)=>Object.assign(Error(message),{status});
async function record(p,sha){
 const row=await readReplicaObject(p,root+'/'+sha+'.json',4096);
 if(!row)return null;
 if(!validBackgroundResult(row)||row.sha256!==sha)throw replicaUnavailable();
 const meta=await p.head(root+'/'+sha+'.png');
 if(!meta||meta.size!==row.bytes||meta.sha256!==undefined&&meta.sha256!==sha)return null;
 return {...row,backgroundId:backgroundIdFromRequest(row.officialRequestId),modifiedAtMs:Number.isSafeInteger(meta.modifiedAtMs)?meta.modifiedAtMs:0};
}
const encode=value=>new TextEncoder().encode(JSON.stringify(value));
const publicationId=async(id,key)=>'request.official.'+await hashReplicaBytes(encode([id,key]));
const suffix={original:' · 시네마틱 원본',draft:' · 픽셀 생성본',final:' · 픽셀 보정'};
function publicBackgrounds(rows,pairs=true){
 const originals=new Set(rows.flatMap(row=>row.cinematic?[row.cinematic.sha256]:[]));
 return rows.filter(row=>!row.title.endsWith(suffix.draft)&&(!pairs||!originals.has(row.sha256)));
}
export async function projectBackgrounds(rows){
 const byRequest=new Map(rows.map(row=>[row.officialRequestId,row]));
 const paired=await Promise.all(rows.map(async row=>{
  if(!row.title.endsWith(suffix.final))return row;
  const title=row.title.slice(0,-suffix.final.length);
  const original=byRequest.get(await publicationId(row.officialRequestId,'background_cinematic_source'));
  const draft=byRequest.get(await publicationId(row.officialRequestId,'background_pixel_generate'));
  return {...row,displayTitle:title,cinematic:original?.title===title+suffix.original?original:null,
   draftAlias:draft?.title===title+suffix.draft?draft.sha256:null,pixel:row};
 }));
 return publicBackgrounds(paired);
}
async function allBackgrounds(p){
 const inventory=await p.listChildren(root);
 if(inventory.length>4096)throw replicaUnavailable();
 const ids=inventory.filter(x=>x.kind==='file'&&x.name.endsWith('.json')&&cinematicHash(x.name.slice(0,-5))).map(x=>x.name.slice(0,-5));
 const backgrounds=[];
 for(let i=0;i<ids.length;i+=12)backgrounds.push(...(await Promise.all(ids.slice(i,i+12).map(id=>record(p,id)))).filter(Boolean));
 return backgrounds.sort((a,b)=>b.modifiedAtMs-a.modifiedAtMs||a.title.localeCompare(b.title,'ko')||a.sha256.localeCompare(b.sha256));
}
export async function admitBackgroundReferences(p,payload){
 const row=await record(p,payload.backgroundSha256);
 if(!row||row.title.endsWith(suffix.draft))throw failure('BACKGROUND_REFERENCE_NOT_FOUND',404);
 const {cinematic,pixel}=payload.references;
 if(row.title.endsWith(suffix.final)){
  if(pixel&&pixel!==row.sha256)throw failure('BACKGROUND_REFERENCE_NOT_FOUND',404);
  if(cinematic){
   const original=await record(p,cinematic);
   if(!original||original.officialRequestId!==await publicationId(row.officialRequestId,'background_cinematic_source')||
      original.title!==row.title.slice(0,-suffix.final.length)+suffix.original)throw failure('BACKGROUND_REFERENCE_NOT_FOUND',404);
  }
 }else if(pixel||cinematic!==row.sha256)throw failure('BACKGROUND_REFERENCE_NOT_FOUND',404);
}
async function readGroups(p,backgroundSha256){
 const archive=await readReplicaObject(p,cinematicArchivePath,512*1024);
 if(archive!==null&&!validCinematicArchive(archive))throw replicaUnavailable();
 const hidden=new Set(archive?.sequenceIds??[]);
 const dirs=await p.listChildren(cinematicSequencePrefix);
 if(dirs.length>4096)throw replicaUnavailable();
 const groups=new Map(),jobs=dirs.filter(x=>x.kind==='directory'&&cinematicId(x.name)&&!hidden.has(x.name));
 for(let i=0;i<jobs.length;i+=12)for(const item of await Promise.all(jobs.slice(i,i+12).map(async ({name})=>{
  const m=await readReplicaObject(p,cinematicSequencePrefix+'/'+name+'/manifest.json',128*1024);
  if(m?.group?.backgroundSha256!==backgroundSha256)return null;
  if(!validBackgroundLoopPlayback(m.playback))return null; // Superseded one-shot previews stay stored but are not offered as backgrounds.
  const {group}=m;
  if(!validCinematicSequenceResult(m)||m.officialRequestId!==name||
     name!==await publicationId(group.requestId,'background_animation_'+group.variant))throw replicaUnavailable();
  const info=await p.head(cinematicSequencePrefix+'/'+name+'/manifest.json');
  return {group,id:name,sourceSha256:m.sourceSha256,modifiedAtMs:info?.modifiedAtMs??0};
 })))if(item){
  const entry=groups.get(item.group.requestId)??{requestId:item.group.requestId,variants:{},modifiedAtMs:0};
  entry.variants[item.group.variant]={id:item.id,sourceSha256:item.sourceSha256};
  entry.modifiedAtMs=Math.max(entry.modifiedAtMs,item.modifiedAtMs);groups.set(entry.requestId,entry);
 }
 return [...groups.values()].sort((a,b)=>b.modifiedAtMs-a.modifiedAtMs||a.requestId.localeCompare(b.requestId));
}
export async function backgroundWorkspaceRead({query,openProject,authorize}){
 const projectId=query.get('projectId'),image=query.get('image'),groups=query.get('groups'),keys=[...query.keys()];
 if(projectId!=='binari'||new Set(keys).size!==keys.length||keys.some(k=>!['projectId','image','groups'].includes(k))||
    (image!==null&&!cinematicHash(image))||(groups!==null&&(!cinematicHash(groups)||image!==null)))throw failure('BACKGROUND_QUERY_INVALID',400);
 await authorize(projectId);
 const p=await openProject(projectId);
 if(!p)throw replicaUnavailable();
 if(groups!==null){if(!await record(p,groups))throw failure('BACKGROUND_NOT_FOUND',404);return {json:{groups:await readGroups(p,groups)}};}
 if(image!==null){
  const m=await record(p,image);if(!m)throw failure('BACKGROUND_NOT_FOUND',404);
  const bytes=await p.readBytes(root+'/'+image+'.png',maxCinematicBytes);
  if(!bytes||bytes.length!==m.bytes||await hashReplicaBytes(bytes)!==image)throw replicaUnavailable();
  return {bytes,mime:'image/png'};
 }
 const backgrounds=await projectBackgrounds(await allBackgrounds(p));
 return {json:{backgrounds}};
}
