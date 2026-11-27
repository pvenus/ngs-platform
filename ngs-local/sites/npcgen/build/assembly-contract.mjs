import {exactScale} from './assembly-sprite-layout.mjs';
import {mapFields,officialId,mapText,regionId} from './map-contract.mjs';
import {propSlug,propSha,propRevision} from './prop-workspace-contract.mjs';
export const assemblyTypes=['assembly.generate','assembly.update'];
export const assemblyPath='/api/assembly-workspace',assemblyRoot='cinematics/assemblies';
export const assemblyPds='/v1/assemblies/ownership/workflow-assembly',assemblyCapability='workflow.assembly.v1';
export const assemblyPuzzleType='binari.ritual-well-water-demo';
const coordinate=(p,lo,hi)=>['x','y'].every(k=>Number.isInteger(p[k])&&p[k]>=lo&&p[k]<=hi);
const roleNames=['table','bowl','well','lid'];
export const bowlStates=Object.freeze(['altar-empty','carried-empty','carried-filled','altar-filled']);
export const validPortalConditions=rows=>Array.isArray(rows)&&rows.length<=16&&
 new Set(rows.map(row=>row?.portalId)).size===rows.length&&rows.every(row=>
  mapFields(row,['portalId','propRole','requiredState'])&&regionId(row.portalId)&&row.propRole==='bowl'&&bowlStates.includes(row.requiredState));
export const portalsMatchGraph=(graph,puzzles)=>puzzles.every(p=>
 (p.portalConditions??[]).every(c=>graph.connections.some(e=>e.id===c.portalId)));
export function permitsAssemblyPortal(conditions,id,propState){
 const matches=(conditions??[]).filter(c=>c.portalId===id);
 return matches.every(c=>propState(c.propRole)===c.requiredState);
}
export function validAssemblyPuzzle(p){
 return mapFields(p,['id','type','layout','attachments','bindings',...(p&&Object.hasOwn(p,'scale')?['scale']:[]),...(p&&Object.hasOwn(p,'portalConditions')?['portalConditions']:[])])&&
  (!Object.hasOwn(p,'portalConditions')||validPortalConditions(p.portalConditions))&&
  (!Object.hasOwn(p,'scale')||mapFields(p.scale,roleNames)&&roleNames.every(k=>exactScale(p.scale[k])))&&typeof p.id==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/u.test(p.id)&&p.type===assemblyPuzzleType&&
  mapFields(p.layout,['altar','well'])&&['altar','well'].every(k=>mapFields(p.layout[k],['regionId','x','y'])&&regionId(p.layout[k].regionId)&&coordinate(p.layout[k],10,90))&&
  mapFields(p.attachments,['bowl','lid'])&&['bowl','lid'].every(k=>mapFields(p.attachments[k],['x','y'])&&coordinate(p.attachments[k],-12,12))&&
  mapFields(p.bindings,roleNames)&&roleNames.every(k=>{const q=p.bindings[k];return mapFields(q,['propId','revision','sha256'])&&propSlug(q.propId)&&propRevision(q.revision)&&propSha(q.sha256);});
}
export const puzzleList=p=>Array.isArray(p)&&p.length<=16&&p.every(validAssemblyPuzzle)&&new Set(p.map(q=>q.id)).size===p.length;
export function validAssemblyRequest(p,type){
 if(!assemblyTypes.includes(type)||p?.projectId!=='binari')return false;
 if(type==='assembly.generate'){
  const shared=officialId(p.mapId)&&mapText(p.title,100)&&mapText(p.intent,2000);
  if(p.schemaVersion==='ngs.assembly-generate.v1')
   return shared&&mapFields(p,['schemaVersion','projectId','title','mapId','puzzleType','intent'])&&p.puzzleType===assemblyPuzzleType;
  return shared&&p.schemaVersion==='ngs.assembly-generate.v2'&&mapFields(p,['schemaVersion','projectId','title','mapId','intent','puzzles'])&&
   Array.isArray(p.puzzles)&&p.puzzles.length>=1&&p.puzzles.length<=8&&p.puzzles.every(q=>mapFields(q,['id','type','intent'])&&
    /^[a-z0-9][a-z0-9-]{0,63}$/u.test(q.id)&&typeof q.id==='string'&&q.type===assemblyPuzzleType&&(q.intent===''||mapText(q.intent,1000)))&&
   new Set(p.puzzles.map(q=>q.id)).size===p.puzzles.length;
 }
 return mapFields(p,['schemaVersion','projectId','assemblyId','expectedRevision','puzzles'])&&p.schemaVersion==='ngs.assembly-update.v1'&&
  officialId(p.assemblyId)&&propRevision(p.expectedRevision)&&puzzleList(p.puzzles);
}
export function validAssemblyState(p){
 return mapFields(p,['schemaVersion','projectId','assemblyId','revision','updatedAt','officialRequestId','title','map','puzzles'])&&
  p.schemaVersion==='ngs.assembly.v1'&&p.projectId==='binari'&&officialId(p.assemblyId)&&officialId(p.officialRequestId)&&
  propRevision(p.revision)&&Number.isSafeInteger(p.updatedAt)&&p.updatedAt>=0&&mapText(p.title,100)&&
  mapFields(p.map,['mapId','revision','officialRequestId'])&&officialId(p.map.mapId)&&propRevision(p.map.revision)&&officialId(p.map.officialRequestId)&&puzzleList(p.puzzles);
}
export function assemblyReachable(graph,puzzles){
 const reaches=(from,to)=>{
  const seen=new Set([from]),pending=[from];
  while(pending.length){const id=pending.shift();if(id===to)return true;
   for(const edge of graph.connections)if(edge.from===id&&!seen.has(edge.to)){seen.add(edge.to);pending.push(edge.to);}}
  return false;
 };
 return puzzles.every(p=>{
  const a=p.layout.altar.regionId,b=p.layout.well.regionId;
  return graph.regions.some(r=>r.id===a)&&graph.regions.some(r=>r.id===b)&&reaches(graph.startRegionId,a)&&reaches(a,b)&&reaches(b,a);
 });
}
