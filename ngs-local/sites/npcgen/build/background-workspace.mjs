import {validBackgroundResult} from './cinematic-sequence-contract.mjs';
import {cinematicHash,maxCinematicBytes} from './cinematic-contract.mjs';
import {hashReplicaBytes,readReplicaObject,replicaUnavailable} from './workspace-read-storage.mjs';
const root='cinematics/backgrounds',failure=(message,status)=>Object.assign(Error(message),{status});
async function record(p,sha){
 const row=await readReplicaObject(p,root+'/'+sha+'.json',4096);
 if(!row)return null;
 if(!validBackgroundResult(row)||row.sha256!==sha)throw replicaUnavailable();
 const meta=await p.head(root+'/'+sha+'.png');
 if(!meta||meta.size!==row.bytes||meta.sha256!==undefined&&meta.sha256!==sha)return null;
 return {...row,modifiedAtMs:Number.isSafeInteger(meta.modifiedAtMs)?meta.modifiedAtMs:0};
}
export async function backgroundWorkspaceRead({query,openProject,authorize}){
 const projectId=query.get('projectId'),image=query.get('image'),keys=[...query.keys()];
 if(projectId!=='binari'||new Set(keys).size!==keys.length||keys.some(k=>!['projectId','image'].includes(k))||
    (image!==null&&!cinematicHash(image)))throw failure('BACKGROUND_QUERY_INVALID',400);
 await authorize(projectId);
 const p=await openProject(projectId);
 if(!p)throw replicaUnavailable();
 if(image!==null){
  const m=await record(p,image);if(!m)throw failure('BACKGROUND_NOT_FOUND',404);
  const bytes=await p.readBytes(root+'/'+image+'.png',maxCinematicBytes);
  if(!bytes||bytes.length!==m.bytes||await hashReplicaBytes(bytes)!==image)throw replicaUnavailable();
  return {bytes,mime:'image/png'};
 }
 const inventory=await p.listChildren(root);
 if(inventory.length>4096)throw replicaUnavailable();
 const ids=inventory.filter(x=>x.kind==='file'&&x.name.endsWith('.json')&&cinematicHash(x.name.slice(0,-5))).map(x=>x.name.slice(0,-5));
 const backgrounds=[];
 for(let i=0;i<ids.length;i+=12)backgrounds.push(...(await Promise.all(ids.slice(i,i+12).map(id=>record(p,id)))).filter(Boolean));
 backgrounds.sort((a,b)=>b.modifiedAtMs-a.modifiedAtMs||a.title.localeCompare(b.title,'ko')||a.sha256.localeCompare(b.sha256));
 return {json:{backgrounds}};
}
