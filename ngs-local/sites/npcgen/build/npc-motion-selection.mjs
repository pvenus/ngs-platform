/** Portable browser/Local/Space contract for explicit, immutable motion selections. */
export const selectionSchemaVersion='ngs.npc-one-stop.selection.v1';
export const selectionReplaceSchemaVersion='ngs.npc-one-stop.selection.replace.v1';
export const motionCatalogSchema='ngs.motion-selection-catalog.v1';
export const motionDirections=Object.freeze(['n','ne','e','se','s','sw','w','nw']);
export const motionLimit=8;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const isSelectionSchema=v=>v===selectionSchemaVersion||v===selectionReplaceSchemaVersion;
export const isMotionPresetId=id=>typeof id==='string'&&id.trim()===id&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id);
const sha=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/u.test(v);
const pose=v=>v==='idle'||v==='combat';
export const motionSelectionFields=['presetId','posePreset','assetSetSha256'];
export const motionSelectionOf=({presetId,posePreset,assetSetSha256})=>({presetId,posePreset,assetSetSha256});
const validFields=v=>isMotionPresetId(v.presetId)&&pose(v.posePreset)&&sha(v.assetSetSha256);
export function validMotionSelection(value){
 return Array.isArray(value)&&value.length>=1&&value.length<=motionLimit&&
  value.every(row=>exact(row,motionSelectionFields)&&validFields(row))&&
  new Set(value.map(row=>row.presetId.toLowerCase())).size===value.length;
}
export function validMotionChoice(row){
 return exact(row,[...motionSelectionFields,'label'])&&validFields(row)&&typeof row.label==='string'&&row.label.trim().length>0&&row.label.length<=160;
}
export function sameMotionChoice(a,b){
 return a?.presetId===b?.presetId&&a?.posePreset===b?.posePreset&&a?.assetSetSha256===b?.assetSetSha256;
}
export function validNpcMotionSelectionRequest(value){
 const id=v=>typeof v==='string'&&v===v.trim()&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(v);
 const text=(v,max)=>typeof v==='string'&&v.isWellFormed()&&v===v.trim()&&v.length>0&&[...v].length<=max&&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(v);
 const character=value?.character;
 return exact(value,['schemaVersion','projectId','intent','character','sourceRefs','motionSelection'])&&
  value.projectId==='binari'&&isSelectionSchema(value.schemaVersion)&&text(value.intent,3500)&&[...value.intent].length>=5&&
  exact(character,['npcId','name','slug','role','actId','chapterId'])&&id(character.npcId)&&id(character.slug)&&
  /^[a-z0-9]+(?:[-._][a-z0-9]+)*$/u.test(character.slug)&&character.npcId==='npc.'+character.slug&&
  text(character.name,60)&&text(character.role,300)&&id(character.actId)&&id(character.chapterId)&&
  Array.isArray(value.sourceRefs)&&value.sourceRefs.length>=1&&value.sourceRefs.length<=64&&value.sourceRefs.every(ref=>text(ref,300))&&
  validMotionSelection(value.motionSelection);
}

export async function publishedMotionChoice(id,meta,label){
 if(!isMotionPresetId(id)||meta?.schemaVersion!=='ngs.motion-preset.v1'||meta.presetId!==id||!pose(meta.posePreset)||!Array.isArray(meta.directions)||
  meta.directions.length!==motionDirections.length)return null;
 const assets=new Map();
 for(const row of meta.directions){
  if(!row||!motionDirections.includes(row.direction)||assets.has(row.direction)||!sha(row.sha256)||row.assetId!==row.sha256+'.mp4'||
   !Number.isSafeInteger(row.bytes)||row.bytes<=12||!Number.isSafeInteger(row.frameCount)||row.frameCount<=1||
   !Number.isFinite(row.fps)||row.fps<=0||row.fps>120||row.cycleCount!==1)return null;
  assets.set(row.direction,row.sha256);
 }
 const payload=['ngs.motion-assets.v1',id,meta.posePreset,motionDirections.map(d=>[d,assets.get(d)])];
 const raw=new TextEncoder().encode(JSON.stringify(payload));
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));
 return {presetId:id,posePreset:meta.posePreset,assetSetSha256:Array.from(digest,n=>n.toString(16).padStart(2,'0')).join(''),label};
}

const quickIds=Object.freeze({
 noncombat:Object.freeze(['walk-flat','run-flat']),
 combat:Object.freeze(['walk-flat','run-flat','sword-attack-flat']),
});
export function quickMotionSelection(kind,rows){
 const want=Object.hasOwn(quickIds,kind)?quickIds[kind]:null;
 if(!want)return null;
 const picked=want.map((id,i)=>rows.find(row=>row.presetId===id&&row.posePreset===(i===2?'combat':'idle')));
 return picked.some(row=>!row)?null:picked.map(motionSelectionOf);
}
