import {cinematicUpscaleType,validCinematicUpscale,cinematicSequencePrefix,cinematicSequenceFramePath,cinematicSequenceFrameLimit,cinematicSequenceType,cinematicPlaybackUpdateType,
 validCinematicSequencePayload,validCinematicSequenceResult,validCinematicPlaybackUpdate,validCinematicPlaybackState,
 cinematicCropType,validCinematicCrop,cinematicSourceGenerateType,backgroundSourceType,backgroundPixelType,backgroundAnimationType,validBackgroundAnimation,validBackgroundPixelRequest,validBackgroundRequest,cinematicSequencesRemoveType,cinematicArchivePath,validCinematicSourceGenerate,validCinematicSourceResult,
 validCinematicSequencesRemove,validCinematicArchive} from './cinematic-sequence-contract.mjs';
import {admitBackgroundReferences} from './background-workspace.mjs';
import {hashReplicaBytes,readReplicaObject,replicaUnavailable} from './workspace-read-storage.mjs';
import {cinematicHash,cinematicId,cinematicSourcePath,cinematicSourcePrefix,cinematicResultPrefix,maxCinematicBytes,
 validCinematicPayload,validCinematicResult} from './cinematic-contract.mjs';
const failure=(message,status)=>Object.assign(Error(message),{status});
const missing=()=>failure('CINEMATIC_ARTIFACT_NOT_FOUND',404);
const params=(q,allowed)=>[...q.keys()].every(k=>allowed.includes(k)&&q.getAll(k).length===1);
const pngMagic=[137,80,78,71,13,10,26,10];
const mp4=(bytes)=>bytes.length>=24&&String.fromCharCode(...bytes.subarray(4,8))==='ftyp';
const scenes='cinematics/scenes',locations='cinematics/scene-index';
const sourceRoot=sha=>scenes+'/'+sha;
const loc=(folder,id)=>locations+'/'+folder+'/'+id+'.json';
async function sourcePaths(project,sha){
 const path=sourceRoot(sha)+'/source.png',head=await project.head(path);
 if(head&&await project.head(sourceRoot(sha)+'/source.json'))return {path,head,info:sourceRoot(sha)+'/source.json'};
 const old=cinematicSourcePath(sha);
 return {path:old,head:await project.head(old),info:cinematicSourcePrefix+'/'+sha+'.json'};
}
async function resultRoot(project,folder,id){
 const value=await readReplicaObject(project,loc(folder,id),256);
 if(value===null)return {source:null,root:folder==='sequences'?cinematicSequencePrefix:cinematicResultPrefix};
 if(Object.keys(value??{}).length!==1||!cinematicHash(value.sourceSha256))throw replicaUnavailable();
 return {source:value.sourceSha256,root:sourceRoot(value.sourceSha256)+'/'+folder};
}
async function sourceMeta(project,sha){
 const paths=await sourcePaths(project,sha);
 const h=paths.head;
 if(!h||!Number.isSafeInteger(h.size)||h.size<57||h.size>maxCinematicBytes)return null;
 if(h.sha256!==undefined)return h.sha256===sha?paths:null;
 const bytes=await project.readBytes(paths.path,maxCinematicBytes);
 return bytes&&bytes.length===h.size&&await hashReplicaBytes(bytes)===sha?paths:null;
}
async function result(project,id){
 const {root,source}=await resultRoot(project,'results',id);
 const m=await readReplicaObject(project,root+'/'+id+'.json',4096);
 if(!m)return null;
 if(!validCinematicResult(m)||m.officialRequestId!==id||source!==null&&source!==m.sourceSha256)throw replicaUnavailable();
 const h=await project.head(root+'/'+id+'.mp4');
 if(!h)return null; // sidecar and bytes can arrive in either order
 if((h.sha256!==undefined&&h.sha256!==m.sha256)||h.size!==m.bytes)throw replicaUnavailable();
 return m;
}
const nativeMetadataLimit=128*1024;
async function archivedSequences(p){
 const archive=await readReplicaObject(p,cinematicArchivePath,512*1024);
 if(!archive)return new Set();
 if(!validCinematicArchive(archive))throw replicaUnavailable();
 return new Set(archive.sequenceIds);
}
async function getSequence(p,id,{timeline=true}={}){
 if((await archivedSequences(p)).has(id))return null;
 const location=await resultRoot(p,'sequences',id);
 const root=location.root+'/'+id;
 const m=await readReplicaObject(p,root+'/manifest.json',nativeMetadataLimit);
 if(!m)return null;
 if(!validCinematicSequenceResult(m)||m.officialRequestId!==id||location.source!==null&&(location.source!==m.sourceSha256||m.group))throw replicaUnavailable();
 if(!timeline)return {sequence:m,revision:0,playback:m.playback};
 const state=await readReplicaObject(p,root+'/timeline.json',nativeMetadataLimit);
 if(state!==null&&(!validCinematicPlaybackState(state)||state.sequenceId!==id))throw replicaUnavailable();
 return {sequence:m,revision:state?.revision??0,playback:state?.playback??m.playback};
}
export async function admitCinematicRequest({command,openProject,authorize}){
 const p=command?.payload,type=command?.requestType;
 const validator=type===cinematicUpscaleType?validCinematicUpscale:type===backgroundAnimationType?validBackgroundAnimation:type===cinematicSequenceType?validCinematicSequencePayload:
  type===cinematicPlaybackUpdateType?validCinematicPlaybackUpdate:type===backgroundSourceType?validBackgroundRequest:type===backgroundPixelType?validBackgroundPixelRequest:type===cinematicCropType?validCinematicCrop:type===cinematicSourceGenerateType?validCinematicSourceGenerate:
  type===cinematicSequencesRemoveType?validCinematicSequencesRemove:validCinematicPayload;
 if(!validator(p))throw failure('NGS_CINEMATIC_PAYLOAD_INVALID',400);
 if(await authorize(p.projectId,'cinematics')===false)throw failure('PROJECT_OR_RESOURCE_DENIED',403);
 const storage=await openProject(p.projectId);
 if(type===cinematicCropType||type===cinematicSourceGenerateType||type===backgroundSourceType||type===backgroundPixelType){if(!storage)throw replicaUnavailable();return;}
 if(type===backgroundAnimationType){if(!storage)throw replicaUnavailable();return admitBackgroundReferences(storage,p);}
 if(type===cinematicSequencesRemoveType){
  if(!storage)throw replicaUnavailable();
  const archived=await archivedSequences(storage);
  if(p.sequenceIds.some(id=>archived.has(id)))throw failure('CINEMATIC_SEQUENCE_ALREADY_REMOVED',409);
  for(const id of p.sequenceIds)if(!await getSequence(storage,id,{timeline:false}))throw missing();
  return;
 }
 if(type===cinematicUpscaleType){
  // The shared PDS validates exact input existence and revision. Intake checks shape only.
  if(!storage)throw replicaUnavailable();return;
 }
 if(type===cinematicPlaybackUpdateType){
  const sequence=storage&&await getSequence(storage,p.sequenceId);
  if(!sequence)throw missing();
  if(sequence.revision!==p.expectedRevision)throw failure('CINEMATIC_PLAYBACK_REVISION_CONFLICT',409);
 }else if(!storage||!await sourceMeta(storage,p.sourceSha256))throw failure('CINEMATIC_SOURCE_NOT_FOUND',404);
}
const stamp=meta=>Number.isSafeInteger(meta?.modifiedAtMs)&&meta.modifiedAtMs>0?meta.modifiedAtMs:0;
const newest=(times)=>(a,b)=>(times.get(b)??0)-(times.get(a)??0)||a.localeCompare(b);
async function sceneList(p,sources,clips,sequences,sequenceTimes){
 const sourceTimes=new Map(),clipTimes=new Map();
 const bySource=new Map(sources.map(sourceSha256=>[sourceSha256,{sourceSha256,title:null,sequences:[],clips:[]}]));
 const jobs=[
  ...sources.map(id=>async()=>{
   const {info:path,head:sourceHead}=await sourcePaths(p,id);
   const info=await readReplicaObject(p,path,4096);
   sourceTimes.set(id,stamp(sourceHead));
   if(info!==null&&(!validCinematicSourceResult(info)||info.sha256!==id))throw replicaUnavailable();
   if(info)bySource.get(id).title=info.title;
   if(path===sourceRoot(id)+'/source.json')bySource.get(id).sceneFolder=true;
  }),
  ...sequences.map(id=>async()=>{
   const location=await resultRoot(p,'sequences',id);
   const m=await readReplicaObject(p,location.root+'/'+id+'/manifest.json',nativeMetadataLimit);
   if(m===null)return;
   if(!validCinematicSequenceResult(m)||m.officialRequestId!==id||location.source!==null&&(location.source!==m.sourceSha256||m.group))throw replicaUnavailable();
   if(!m.group){
    const scene=bySource.get(m.sourceSha256);
    scene?.sequences.push(id);
    if(scene&&m.upscale)(scene.upscaledSequences??=[]).push(id);
   }
  }),
  ...clips.map(id=>async()=>{
   const m=await result(p,id);
   if(m){
    bySource.get(m.sourceSha256)?.clips.push(id);
    clipTimes.set(id,stamp(await p.head((await resultRoot(p,'results',id)).root+'/'+id+'.mp4')));
   }
  })
 ];
 for(let i=0;i<jobs.length;i+=12)await Promise.all(jobs.slice(i,i+12).map(job=>job()));
 return [...bySource.values()].sort((a,b)=>newest(sourceTimes)(a.sourceSha256,b.sourceSha256))
  .map(s=>({...s,sequences:s.sequences.sort(newest(sequenceTimes)),clips:s.clips.sort(newest(clipTimes))}));
}
export async function cinematicWorkspaceRead({query,openProject,authorize}){
 if(!params(query,['projectId','source','sourceInfo','clip','video','sequence','frame','grouped'])||query.get('projectId')!=='binari')
  throw failure('CINEMATIC_QUERY_INVALID',400);
 const sha=query.get('source'),id=query.get('clip'),video=query.get('video'),
  sequenceId=query.get('sequence'),frame=query.get('frame'),sourceInfo=query.get('sourceInfo'),grouped=query.get('grouped');
 if(grouped!==null&&(grouped!=='1'||query.size!==2))throw failure('CINEMATIC_QUERY_INVALID',400);
 if(sourceInfo!==null&&(!['1','2'].includes(sourceInfo)||sha===null))throw failure('CINEMATIC_QUERY_INVALID',400);
 if(sequenceId!==null&&(!cinematicId(sequenceId)||sha!==null||id!==null||video!==null)||
   frame!==null&&(sequenceId===null||!/^(?:0|[1-9][0-9]?)$/.test(frame)))throw failure('CINEMATIC_QUERY_INVALID',400);
 if(sha!==null&&(!cinematicHash(sha)||id!==null||video!==null)||id!==null&&!cinematicId(id)||
   video!==null&&(video!=='1'||id===null))throw failure('CINEMATIC_QUERY_INVALID',400);
 if(await authorize('binari','cinematics')===false)throw failure('PROJECT_OR_RESOURCE_DENIED',403);
 const p=await openProject('binari');
 if(!p)throw replicaUnavailable();
 if(sequenceId!==null){
  const state=await getSequence(p,sequenceId,{timeline:frame===null});
  if(!state)throw missing();
  if(frame===null)return {json:state};
  const selected=state.sequence.frames[Number(frame)];
  if(!selected)throw missing();
  const {root}=await resultRoot(p,'sequences',sequenceId);
  const path=cinematicSequenceFramePath(sequenceId,selected.index).replace(cinematicSequencePrefix,root);
  const bytes=await p.readBytes(path,cinematicSequenceFrameLimit);
  if(!bytes)throw missing();
  const ihdr=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes.length!==selected.bytes||!pngMagic.every((n,i)=>n===bytes[i])||ihdr.getUint32(16)!==state.sequence.width||
    ihdr.getUint32(20)!==state.sequence.height||await hashReplicaBytes(bytes)!==selected.sha256)throw replicaUnavailable();
  return {bytes,mime:'image/png'};
 }
 if(sha!==null){
  const paths=await sourceMeta(p,sha);if(!paths)throw missing();
  if(sourceInfo!==null){
   const info=await readReplicaObject(p,paths.info,4096);
   if(info!==null&&(!validCinematicSourceResult(info)||info.sha256!==sha||info.bytes!==paths.head.size))throw replicaUnavailable();
   if(sourceInfo==='2'){
    const bytes=await p.readBytes(paths.path,maxCinematicBytes);
    if(!bytes||bytes.length<24||!pngMagic.every((n,i)=>n===bytes[i])||await hashReplicaBytes(bytes)!==sha)throw replicaUnavailable();
    const hdr=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    return {json:{sourceSha256:sha,width:hdr.getUint32(16),height:hdr.getUint32(20)}};
   }
   return {json:{sourceSha256:sha,title:info?.title??null,...(paths.path===sourceRoot(sha)+'/source.png'?{sceneFolder:true}:{})}};
  }
  const bytes=await p.readBytes(paths.path,maxCinematicBytes);
  if(!bytes)throw missing();
  if(!pngMagic.every((n,i)=>n===bytes[i])||await hashReplicaBytes(bytes)!==sha)throw replicaUnavailable();
  return {bytes,mime:'image/png'};
 }
 if(id!==null){
  const m=await result(p,id);
  if(!m)throw missing();
  if(video===null)return {json:{clip:m}};
  const bytes=await p.readBytes((await resultRoot(p,'results',id)).root+'/'+id+'.mp4',maxCinematicBytes);
  if(!bytes)throw missing();
  if(!mp4(bytes)||bytes.length!==m.bytes||await hashReplicaBytes(bytes)!==m.sha256)throw replicaUnavailable();
  return {bytes,mime:'video/mp4'};
 }
 const [sourceRows,resultRows,physicalScenes,sequenceRows,indexSeq,indexResult]=await Promise.all(
  [cinematicSourcePrefix,cinematicResultPrefix,scenes,cinematicSequencePrefix,locations+'/sequences',locations+'/results'].map(path=>p.listChildren(path)));
 if([sourceRows,resultRows,physicalScenes,sequenceRows,indexSeq,indexResult].some(rows=>rows.length>4096))throw replicaUnavailable();
 const sourceIds=new Set(sourceRows.flatMap(({name,kind})=>kind==='file'&&name.endsWith('.png')&&cinematicHash(name.slice(0,-4))?[name.slice(0,-4)]:[]));
 for(const {name,kind} of physicalScenes)if(kind==='directory'&&cinematicHash(name)&&
  await p.head(sourceRoot(name)+'/source.json')&&await p.head(sourceRoot(name)+'/source.png'))sourceIds.add(name);
 const sources=[...sourceIds].sort();
 const videos=new Set(resultRows.filter(r=>r.kind==='file'&&r.name.endsWith('.mp4')).map(r=>r.name.slice(0,-4)));
 const clipIds=new Set(resultRows.flatMap(({name,kind})=>kind==='file'&&name.endsWith('.json')&&cinematicId(name.slice(0,-5))&&videos.has(name.slice(0,-5))?[name.slice(0,-5)]:[]));
 const indexed=rows=>rows.flatMap(({name,kind})=>kind==='file'&&name.endsWith('.json')&&cinematicId(name.slice(0,-5))?[name.slice(0,-5)]:[]);
 for(const id of indexed(indexResult)){
  const {root}=await resultRoot(p,'results',id);
  if(await p.head(root+'/'+id+'.json')&&await p.head(root+'/'+id+'.mp4'))clipIds.add(id);
 }
 const clips=[...clipIds].sort();
 const sequences=[],sequenceTimes=new Map(),archived=await archivedSequences(p);
 const sequenceIds=new Set([...sequenceRows.filter(x=>x.kind==='directory'&&cinematicId(x.name)).map(x=>x.name),...indexed(indexSeq)]);
 for(const id of sequenceIds){
  if(archived.has(id))continue;
  const {root}=await resultRoot(p,'sequences',id);
  const meta=await p.head(root+'/'+id+'/manifest.json');
  if(meta){sequences.push(id);sequenceTimes.set(id,stamp(meta));}
 }
 if(grouped==='1')return {json:{scenes:await sceneList(p,sources,clips,sequences,sequenceTimes)}};
 return {json:{sources,clips,sequences:sequences.sort()}};
}
// Only used for a verified bounded MP4. Ignore non-single-range syntaxes per
// the wire contract; do not let a media request assemble arbitrary ranges.
export function cinematicVideoResponse(bytes,header){
 const n=bytes.length,headers={'Accept-Ranges':'bytes','Content-Type':'video/mp4'};
 const m=typeof header==='string'?/^bytes=(\d*)-(\d*)$/u.exec(header):null;
 if(!m||(!m[1]&&!m[2]))return {status:200,bytes,headers:{...headers,'Content-Length':String(n)}};
 const start=m[1]?Number(m[1]):Math.max(0,n-Number(m[2]));
 const end=m[1]&&m[2]?Math.min(n-1,Number(m[2])):n-1;
 if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=n||end<start)
  return {status:416,bytes:undefined,headers:{...headers,'Content-Range':'bytes */'+n}};
 const out=bytes.subarray(start,end+1);
 return {status:206,bytes:out,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${n}`,'Content-Length':String(out.length)}};
}
