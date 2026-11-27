import {officialId,mapRoot,validMapState} from './map-contract.mjs';
import {readReplicaObject,replicaUnavailable} from './workspace-read-storage.mjs';
export const mapPath='/api/map-workspace';
const error=(message,status)=>Object.assign(Error(message),{status});
export async function mapWorkspaceRead({query,openProject,authorize}){
 const projectId=query.get('projectId'),item=query.get('item'),keys=[...query.keys()];
 if(projectId!=='binari'||keys.length!==new Set(keys).size||keys.some(k=>!['projectId','item'].includes(k))||
    item!==null&&!officialId(item))throw error('MAP_QUERY_INVALID',400);
 await authorize(projectId);
 const p=await openProject(projectId);
 if(!p)throw replicaUnavailable();
 async function latest(id){
  const base=mapRoot+'/'+id, files=await p.listChildren(base);
  const revisions=files.filter(f=>f.kind==='file'&&/^[1-9]\d{0,15}\.json$/.test(f.name))
   .map(f=>Number(f.name.slice(0,-5))).filter(Number.isSafeInteger).sort((a,b)=>b-a);
  if(!revisions.length)return null;
  const row=await readReplicaObject(p,base+'/'+revisions[0]+'.json',65536);
  if(!validMapState(row)||row.mapId!==id||row.revision!==revisions[0])throw replicaUnavailable();
  return row;
 }
 if(item!==null){
  const map=await latest(item);
  if(!map)throw error('MAP_NOT_FOUND',404);
  return {json:{map}};
 }
 const listing=await p.listChildren(mapRoot);
 if(listing.length>4096)throw replicaUnavailable();
 const maps=[];
 for(let i=0;i<listing.length;i+=12)maps.push(...(await Promise.all(listing.slice(i,i+12).filter(x=>x.kind==='directory'&&officialId(x.name))
  .map(x=>latest(x.name)))).filter(Boolean).map(({mapId,revision,updatedAt,officialRequestId,graph})=>({mapId,revision,updatedAt,officialRequestId,title:graph.title})));
 return {json:{maps:maps.sort((a,b)=>b.updatedAt-a.updatedAt||a.mapId.localeCompare(b.mapId))}};
}
