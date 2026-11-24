import {hashReplicaBytes,readReplicaObject,replicaUnavailable} from './workspace-read-storage.mjs';
import {cinematicHash,cinematicId,cinematicSourcePath,cinematicSourcePrefix,cinematicResultPrefix,maxCinematicBytes,
 validCinematicPayload,validCinematicResult} from './cinematic-contract.mjs';
const failure=(message,status)=>Object.assign(Error(message),{status});
const missing=()=>failure('CINEMATIC_ARTIFACT_NOT_FOUND',404);
const params=(q,allowed)=>[...q.keys()].every(k=>allowed.includes(k)&&q.getAll(k).length===1);
const pngMagic=[137,80,78,71,13,10,26,10];
const mp4=(bytes)=>bytes.length>=24&&String.fromCharCode(...bytes.subarray(4,8))==='ftyp';
async function sourceMeta(project,sha){
 const h=await project.head(cinematicSourcePath(sha));
 if(!h||!Number.isSafeInteger(h.size)||h.size<57||h.size>maxCinematicBytes)return null;
 if(h.sha256!==undefined)return h.sha256===sha?h:null;
 const bytes=await project.readBytes(cinematicSourcePath(sha),maxCinematicBytes);
 return bytes&&bytes.length===h.size&&await hashReplicaBytes(bytes)===sha?h:null;
}
async function result(project,id){
 const m=await readReplicaObject(project,cinematicResultPrefix+'/'+id+'.json',4096);
 if(!m)return null;
 if(!validCinematicResult(m)||m.officialRequestId!==id)throw replicaUnavailable();
 const h=await project.head(cinematicResultPrefix+'/'+id+'.mp4');
 if(!h)return null; // sidecar and bytes can arrive in either order
 if((h.sha256!==undefined&&h.sha256!==m.sha256)||h.size!==m.bytes)throw replicaUnavailable();
 return m;
}
export async function admitCinematicRequest({command,openProject,authorize}){
 const p=command?.payload;
 if(!validCinematicPayload(p))throw failure('NGS_CINEMATIC_PAYLOAD_INVALID',400);
 if(await authorize(p.projectId,'cinematics')===false)throw failure('PROJECT_OR_RESOURCE_DENIED',403);
 const storage=await openProject(p.projectId);
 if(!storage||!await sourceMeta(storage,p.sourceSha256))throw failure('CINEMATIC_SOURCE_NOT_FOUND',404);
}
export async function cinematicWorkspaceRead({query,openProject,authorize}){
 if(!params(query,['projectId','source','clip','video'])||query.get('projectId')!=='binari')
  throw failure('CINEMATIC_QUERY_INVALID',400);
 const sha=query.get('source'),id=query.get('clip'),video=query.get('video');
 if(sha!==null&&(!cinematicHash(sha)||id!==null||video!==null)||id!==null&&!cinematicId(id)||
   video!==null&&(video!=='1'||id===null))throw failure('CINEMATIC_QUERY_INVALID',400);
 if(await authorize('binari','cinematics')===false)throw failure('PROJECT_OR_RESOURCE_DENIED',403);
 const p=await openProject('binari');
 if(!p)throw replicaUnavailable();
 if(sha!==null){
  if(!await sourceMeta(p,sha))throw missing();
  const bytes=await p.readBytes(cinematicSourcePath(sha),maxCinematicBytes);
  if(!bytes)throw missing();
  if(!pngMagic.every((n,i)=>n===bytes[i])||await hashReplicaBytes(bytes)!==sha)throw replicaUnavailable();
  return {bytes,mime:'image/png'};
 }
 if(id!==null){
  const m=await result(p,id);
  if(!m)throw missing();
  if(video===null)return {json:{clip:m}};
  const bytes=await p.readBytes(cinematicResultPrefix+'/'+id+'.mp4',maxCinematicBytes);
  if(!bytes)throw missing();
  if(!mp4(bytes)||bytes.length!==m.bytes||await hashReplicaBytes(bytes)!==m.sha256)throw replicaUnavailable();
  return {bytes,mime:'video/mp4'};
 }
 const sourceRows=await p.listChildren(cinematicSourcePrefix),resultRows=await p.listChildren(cinematicResultPrefix);
 if(sourceRows.length>4096||resultRows.length>4096)throw replicaUnavailable();
 const sources=sourceRows.flatMap(({name,kind})=>kind==='file'&&name.endsWith('.png')&&cinematicHash(name.slice(0,-4))?[name.slice(0,-4)]:[]).sort();
 // List verified publications from the inventory without opening every MP4.
 const videos=new Set(resultRows.filter(r=>r.kind==='file'&&r.name.endsWith('.mp4')).map(r=>r.name.slice(0,-4)));
 const clips=resultRows.flatMap(({name,kind})=>kind==='file'&&name.endsWith('.json')&&cinematicId(name.slice(0,-5))&&videos.has(name.slice(0,-5))?[name.slice(0,-5)]:[]).sort();
 return {json:{sources,clips}};
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
