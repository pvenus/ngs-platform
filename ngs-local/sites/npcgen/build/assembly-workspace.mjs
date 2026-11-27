import {assemblyRoot,validAssemblyState} from './assembly-contract.mjs';
import {officialId} from './map-contract.mjs';
import {readReplicaObject,replicaUnavailable} from './workspace-read-storage.mjs';
const error=(message,status)=>Object.assign(Error(message),{status});
export async function assemblyWorkspaceRead({query,openProject,authorize}){
 const projectId=query.get('projectId'),item=query.get('item'),keys=[...query.keys()];
 if(projectId!=='binari'||keys.length!==new Set(keys).size||keys.some(k=>!['projectId','item'].includes(k))||item!==null&&!officialId(item))throw error('ASSEMBLY_QUERY_INVALID',400);
 await authorize(projectId);const p=await openProject(projectId);if(!p)throw replicaUnavailable();
 async function latest(id){
  const base=assemblyRoot+'/'+id;
  const revisions=(await p.listChildren(base)).filter(f=>f.kind==='file'&&/^[1-9]\d{0,15}\.json$/.test(f.name))
   .map(f=>Number(f.name.slice(0,-5))).filter(Number.isSafeInteger).sort((a,b)=>b-a);
  for(const rev of revisions){
   const row=await readReplicaObject(p,base+'/'+rev+'.json',64*1024);
   if(row===null)continue;
   if(!validAssemblyState(row)||row.assemblyId!==id||row.revision!==rev)throw replicaUnavailable();
   return row;
  }
  return null;
 }
 if(item!==null){const assembly=await latest(item);if(!assembly)throw error('ASSEMBLY_NOT_FOUND',404);return {json:{assembly}};}
 const dirs=(await p.listChildren(assemblyRoot)).filter(x=>x.kind==='directory'&&officialId(x.name));
 if(dirs.length>4096)throw replicaUnavailable();
 const assemblies=[];
 for(let i=0;i<dirs.length;i+=12)assemblies.push(...(await Promise.all(dirs.slice(i,i+12).map(x=>latest(x.name)))).filter(Boolean)
  .map(({assemblyId,title,revision,updatedAt,map})=>({assemblyId,title,revision,updatedAt,mapId:map.mapId})));
 return {json:{assemblies:assemblies.sort((a,b)=>b.updatedAt-a.updatedAt||a.assemblyId.localeCompare(b.assemblyId))}};
}
