import {officialId,mapRoot,validMapState,mapFields} from './map-contract.mjs';
import {readReplicaObject,replicaUnavailable,hashReplicaBytes} from './workspace-read-storage.mjs';
export const mapPath='/api/map-workspace';
const error=(message,status)=>Object.assign(Error(message),{status});
const componentNames=['start','portals','collisions'];
const groupFields=['schemaVersion','projectId','mapId','revision','updatedAt','officialRequestId','title','regions','parts'];
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const maxMapMetadataBytes=65536;
async function readMapRevision(project,base,id,rev){
 const prefix=base+'/'+rev;
 const stored=await readReplicaObject(project,prefix+'.json',maxMapMetadataBytes);
 if(stored===null)return null;
 if(stored.mapId!==id||stored.revision!==rev)throw replicaUnavailable();
 if(stored.schemaVersion!=='ngs.map-group.v1'){
  if(!validMapState(stored))throw replicaUnavailable();
  return stored;
 }
 const names=stored.parts&&Object.hasOwn(stored.parts,'decorations')?[...componentNames,'decorations']:componentNames;
 if(!mapFields(stored,groupFields)||!mapFields(stored.parts,names)||!names.every(key=>hash(stored.parts[key])))
  throw replicaUnavailable();
 const parts=await Promise.all(names.map(async key=>{
  const bytes=await project.readBytes(prefix+'.'+key+'.json',maxMapMetadataBytes);
  if(bytes===null)return null;
  if(!(bytes instanceof Uint8Array)||bytes.length>maxMapMetadataBytes||await hashReplicaBytes(bytes)!==stored.parts[key])throw replicaUnavailable();
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw replicaUnavailable();}
 }));
 // Sync might copy the group manifest before a referenced part. Keep the
 // preceding complete revision visible without mixing any version's parts.
 if(parts.some(part=>part===null))return null;
 const [start,portals,collisions,decorations]=parts;
 if(!(mapFields(start,['startRegionId'])||mapFields(start,['startRegionId','startPoint']))||!mapFields(portals,['connections'])||
    !(mapFields(collisions,['colliders'])||mapFields(collisions,[]))||
    (names.length===4&&!mapFields(decorations,['decorations'])))throw replicaUnavailable();
 const {projectId,mapId,revision,updatedAt,officialRequestId,title,regions}=stored;
 const composite={schemaVersion:'ngs.map-metadata.v1',projectId,mapId,revision,updatedAt,officialRequestId,
  graph:{title,regions,...start,...portals,...collisions,...decorations}};
 if(!validMapState(composite))throw replicaUnavailable();
 return composite;
}
export async function mapWorkspaceRead({query,openProject,authorize}){
 const projectId=query.get('projectId'),item=query.get('item'),version=query.get('revision'),keys=[...query.keys()];
 if(projectId!=='binari'||keys.length!==new Set(keys).size||keys.some(k=>!['projectId','item','revision'].includes(k))||
    item!==null&&!officialId(item)||version!==null&&(!item||!/^[1-9]\d{0,15}$/.test(version)||!Number.isSafeInteger(Number(version))))throw error('MAP_QUERY_INVALID',400);
 await authorize(projectId);
 const p=await openProject(projectId);
 if(!p)throw replicaUnavailable();
 async function latest(id){
  const base=mapRoot+'/'+id, files=await p.listChildren(base);
  const revisions=files.filter(f=>f.kind==='file'&&/^[1-9]\d{0,15}\.json$/.test(f.name))
   .map(f=>Number(f.name.slice(0,-5))).filter(Number.isSafeInteger).sort((a,b)=>b-a);
  for(const revision of revisions){
   const row=await readMapRevision(p,base,id,revision);
   if(row)return row;
  }
  return null;
 }
 if(item!==null){
  const map=version!==null?await readMapRevision(p,mapRoot+'/'+item,item,Number(version)):await latest(item);
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
