import {fileUpdateType,assemblyUpdateRoot,validFileUpdate} from '../ngs-local/sites/npcgen/build/file-update-envelope.mjs';
/** Read/write policies for the explicitly hosted map and assembly families only. */
import {mapTypes,validMapRequest} from '../ngs-local/sites/npcgen/build/map-contract.mjs';
import {assemblyTypes,validAssemblyRequest,assemblyReachable} from '../ngs-local/sites/npcgen/build/assembly-contract.mjs';
import {fileDeleteType,validMapFolderDelete,validAssemblyFolderDelete} from '../ngs-local/sites/npcgen/build/prop-folder-delete-contract.mjs';

export function mapAssemblyAction(type,payload){
 if(type===fileUpdateType)return 'fileUpdateEnabled';
 if(mapTypes.includes(type))return 'mapEnabled';
 if(assemblyTypes.includes(type))return 'assemblyEnabled';
 if(type===fileDeleteType){
  if(validMapFolderDelete(payload))return 'mapDeleteEnabled';
  if(validAssemblyFolderDelete(payload))return 'assemblyDeleteEnabled';
 }
 return null;
}

export function validSpaceMapAssemblyCommand(type,payload){
 if(type===fileUpdateType)return validFileUpdate(payload);
 if(mapTypes.includes(type))return validMapRequest(payload,type);
 if(assemblyTypes.includes(type))return validAssemblyRequest(payload,type);
 return type===fileDeleteType&&(validMapFolderDelete(payload)||validAssemblyFolderDelete(payload));
}

export function spaceMapAssemblyCapabilities(grant,writable){
 if(grant?.projectId!=='binari'||!['owner','editor','viewer'].includes(grant.role))return {};
 return {mapReadEnabled:true,assemblyReadEnabled:true,
  ...(writable&&['owner','editor'].includes(grant.role)?{mapEnabled:true,assemblyEnabled:true,fileUpdateEnabled:true}:{}),
  ...(writable&&grant.role==='owner'?{mapDeleteEnabled:true,assemblyDeleteEnabled:true}:{})};
}

const need=(okay,status,code)=>{if(!okay)throw Object.assign(Error(code),{status});};
export async function admitSpaceMapAssembly({command,read}){
 const type=command.requestType,p=command.payload;
 need(validSpaceMapAssemblyCommand(type,p),400,'SPACE_REQUEST_INVALID');
 // Deletes are bound to an exact protected root, directory, revision and
 // producing request. Filex validates the current head under its write lock;
 // using the hosted replica as authority would reject a valid retry after sync.
 if(type===fileDeleteType)return;
 const query=new URLSearchParams({projectId:p.projectId});
 if(type===fileUpdateType&&p.target.root===assemblyUpdateRoot){
  query.set('item',p.target.path);
  const {assembly}=await read('/api/assembly-workspace',query);
  need(assembly.revision===p.expected.revision&&assembly.officialRequestId===p.expected.officialRequestId,409,'FILE_UPDATE_REVISION_CONFLICT');
  need(assembly.title===p.content.title&&assembly.map.mapId===p.content.mapId,409,'ASSEMBLY_IDENTITY_IMMUTABLE');
  query.set('item',assembly.map.mapId);
  const {map}=await read('/api/map-workspace',query);
  need(assemblyReachable(map.graph,p.content.puzzles),400,'ASSEMBLY_LAYOUT_UNREACHABLE');
  return;
 }
 if(mapTypes.includes(type)||type===fileUpdateType){
  const {backgrounds}=await read('/api/background-workspace',query);
  const pins=new Map(backgrounds.filter(b=>!b.title.endsWith(' · 시네마틱 원본')).map(b=>[b.backgroundId,b.sha256]));
  const graph=type===fileUpdateType?p.content:p.graph;
  need(graph.regions.every(r=>pins.get(r.backgroundId)===r.imageSha256),404,'MAP_BACKGROUND_NOT_FOUND');
  if(type===fileUpdateType){
   query.set('item',p.target.path);
   const {map}=await read('/api/map-workspace',query);
   need(map.revision===p.expected.revision&&map.officialRequestId===p.expected.officialRequestId,409,'FILE_UPDATE_REVISION_CONFLICT');
   need(map.graph.title===graph.title,409,'MAP_TITLE_IMMUTABLE');
  }
  if(type===mapTypes[1]){
   query.set('item',p.mapId);
   const {map}=await read('/api/map-workspace',query);
   need(map.revision===p.expectedRevision,409,'MAP_REVISION_CONFLICT');
   need(map.graph.title===p.graph.title,409,'MAP_TITLE_IMMUTABLE');
  }
 }else if(type===assemblyTypes[1]){
  query.set('item',p.assemblyId);
  const {assembly}=await read('/api/assembly-workspace',query);
  need(assembly.revision===p.expectedRevision,409,'ASSEMBLY_REVISION_CONFLICT');
  query.set('item',assembly.map.mapId);
  const {map}=await read('/api/map-workspace',query);
  need(assemblyReachable(map.graph,p.puzzles),400,'ASSEMBLY_LAYOUT_UNREACHABLE');
 }else{
  query.set('item',p.mapId);
  await read('/api/map-workspace',query);
 }
}
