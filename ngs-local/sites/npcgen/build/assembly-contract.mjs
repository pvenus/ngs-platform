import {exactScale} from './assembly-sprite-layout.mjs';
import {mapFields,officialId,mapText,regionId} from './map-contract.mjs';
import {propSlug,propSha,propRevision} from './prop-workspace-contract.mjs';
export const assemblyTypes=['assembly.generate','assembly.update'];
export const assemblyPath='/api/assembly-workspace',assemblyRoot='cinematics/assemblies';
export const assemblyPds='/v1/assemblies/ownership/workflow-assembly',assemblyCapability='workflow.assembly.v1';
export const assemblyPuzzleType='binari.ritual-well-water-demo',spiritPuzzleType='binari.ritual-spirit-manifestation';
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
const validManifestation=p=>mapFields(p,['id','type','layout','attachments','bindings',...(p&&Object.hasOwn(p,'scale')?['scale']:[])])&&
 typeof p.id==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/u.test(p.id)&&
 mapFields(p.layout,['spirit'])&&mapFields(p.layout.spirit,['regionId','x','y'])&&regionId(p.layout.spirit.regionId)&&coordinate(p.layout.spirit,10,90)&&
 mapFields(p.attachments,[])&&mapFields(p.bindings,['spirit'])&&mapFields(p.bindings.spirit,['propId','revision','sha256'])&&
 propSlug(p.bindings.spirit.propId)&&propRevision(p.bindings.spirit.revision)&&propSha(p.bindings.spirit.sha256)&&
 (!Object.hasOwn(p,'scale')||mapFields(p.scale,['spirit'])&&exactScale(p.scale.spirit));
const actions=['pickup','drop','activate'],modules=['inventory.move.v1','prop.interact.v1','switch.v1'];
const label=v=>typeof v==='string'&&v.length>=1&&v.length<=64&&/^[a-z][a-z0-9]*(?:[-._][a-z0-9]+)*$/u.test(v);
const stateRef=v=>mapFields(v,['role','state'])&&label(v.role)&&label(v.state);
const action=v=>mapFields(v,['kind','target','item'])&&actions.includes(v.kind)&&label(v.target)&&(v.item===null||label(v.item));
const waterRules=[
 ['inventory.move.v1','pickup','bowl',null,'bowl','altar-empty','carried-empty',[]],
 ['switch.v1','activate','lid',null,'lid','closed','open',[]],
 ['prop.interact.v1','drop','well','bowl','bowl','carried-empty','carried-filled',[['lid','open']]],
 ['inventory.move.v1','drop','altar','bowl','bowl','carried-filled','altar-filled',[]],
];
const waterRoles={bowl:['altar-empty','carried-empty','carried-filled','altar-filled'],well:['ready'],altar:['ready'],lid:['closed','open']};
export function validPuzzleDefinition(v){
 if(!mapFields(v,['schemaVersion','entities','rules','goal','solution'])||v.schemaVersion!=='ngs.puzzle-definition.v1'||
 !Array.isArray(v.entities)||v.entities.length!==4||!Array.isArray(v.rules)||v.rules.length!==4||
 !Array.isArray(v.solution)||v.solution.length!==4)return false;
 const seen=new Set();
 for(const entity of v.entities){
  if(!mapFields(entity,['role','initial','states'])||!Object.hasOwn(waterRoles,entity.role)||seen.has(entity.role)||
     entity.initial!==waterRoles[entity.role][0]||!Array.isArray(entity.states)||entity.states.length!==waterRoles[entity.role].length)return false;
  const ids=new Set();
  for(const state of entity.states){
   if(!mapFields(state,['id','held','payload'])||!waterRoles[entity.role].includes(state.id)||ids.has(state.id)||
      state.held!==(entity.role==='bowl'&&state.id.startsWith('carried-'))||
      state.payload!==(entity.role==='bowl'?state.id.split('-')[1]:state.id))return false;
   ids.add(state.id);
  }
  seen.add(entity.role);
 }
 const known=v=>stateRef(v)&&Object.hasOwn(waterRoles,v.role)&&waterRoles[v.role].includes(v.state);
 const knownAction=v=>action(v)&&Object.hasOwn(waterRoles,v.target)&&(v.item===null||Object.hasOwn(waterRoles,v.item));
 if(!known(v.goal)||v.goal.role!=='bowl'||v.goal.state!=='altar-filled'||!v.solution.every(knownAction))return false;
 const expected=new Set(waterRules.map(r=>JSON.stringify(r)));
 for(const r of v.rules){
  if(!mapFields(r,Object.keys({module:0,action:0,from:0,to:0,requires:0}))||!modules.includes(r.module)||!knownAction(r.action)||
     !known(r.from)||!known(r.to)||r.from.role!==r.to.role||!Array.isArray(r.requires)||r.requires.length>32||!r.requires.every(known)||
     !expected.delete(JSON.stringify([r.module,r.action.kind,r.action.target,r.action.item,r.from.role,r.from.state,r.to.state,
      r.requires.map(c=>[c.role,c.state])])))return false;
 }
 return expected.size===0;
}
export function validAssemblyPuzzle(p){
 if(p?.type===spiritPuzzleType)return validManifestation(p);
 return mapFields(p,['id','type','layout','attachments','bindings',...(p&&Object.hasOwn(p,'scale')?['scale']:[]),...(p&&Object.hasOwn(p,'portalConditions')?['portalConditions']:[]),...(p&&Object.hasOwn(p,'definition')?['definition']:[])])&&
  (!Object.hasOwn(p,'definition')||validPuzzleDefinition(p.definition))&&
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
  const v3=p.schemaVersion==='ngs.assembly-generate.v3', v4=p.schemaVersion==='ngs.assembly-generate.v4';
  return shared&&(v3||v4||p.schemaVersion==='ngs.assembly-generate.v2')&&mapFields(p,['schemaVersion','projectId','title','mapId','intent','puzzles'])&&
   Array.isArray(p.puzzles)&&p.puzzles.length>=1&&p.puzzles.length<=(v4?1:8)&&p.puzzles.every(q=>{
    const spirit=v3&&q?.type===spiritPuzzleType;
    return mapFields(q,['id','type','intent',...(spirit?['prop']:[])])&&typeof q.id==='string'&&/^[a-z0-9][a-z0-9-]{0,63}$/u.test(q.id)&&
     (spirit?mapFields(q.prop,['propId','revision','sha256'])&&propSlug(q.prop.propId)&&propRevision(q.prop.revision)&&propSha(q.prop.sha256):q.type===assemblyPuzzleType)&&
     (q.intent===''||mapText(q.intent,1000));
   })&&
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
  if(p.type===spiritPuzzleType){const {regionId}=p.layout.spirit;return graph.regions.some(r=>r.id===regionId)&&reaches(graph.startRegionId,regionId);}
  const a=p.layout.altar.regionId,b=p.layout.well.regionId;
  return graph.regions.some(r=>r.id===a)&&graph.regions.some(r=>r.id===b)&&reaches(graph.startRegionId,a)&&reaches(a,b)&&reaches(b,a);
 });
}
