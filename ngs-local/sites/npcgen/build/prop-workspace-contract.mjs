/** Same formal prop request envelopes in Local, Space and fixture. */
export const propWorkspacePath='/api/prop-workspace';
export const propTypes=Object.freeze({
 generate:'prop.generate',regenerate:'prop.regenerate',animation:'prop.animation.generate',
});
const schema={generate:'ngs.prop-generate.v1',regenerate:'ngs.prop-regenerate.v1',animation:'ngs.prop-animation-generate.v1'};
const names=Object.keys(propTypes);
const utf8=new TextEncoder();
export const propSlug=v=>typeof v==='string'&&v.length>=2&&v.length<=80&&/^[a-z0-9]+(?:[-._][a-z0-9]+)*$/u.test(v)&&v===v.trim();
export const propSha=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/u.test(v);
export const propRevision=v=>Number.isSafeInteger(v)&&v>0&&v<Number.MAX_SAFE_INTEGER;
export const propSpiritProfile='spirit-v2';
const supportedSpiritProfiles=['spirit-v1',propSpiritProfile];
export const propMotion=v=>v==='still'||v==='subtle';
export const exactPropKeys=(v,keys)=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const text=(v,max)=>typeof v==='string'&&v.isWellFormed()&&v===v.trim()&&v.length>0&&utf8.encode(v).length<=max&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(v);
const source=v=>exactPropKeys(v,['revision','sha256'])&&propRevision(v.revision)&&propSha(v.sha256);
export const validPropGenerateReference=(v,target)=>exactPropKeys(v,['propId','revision','sha256'])&&
 propSlug(v.propId)&&v.propId!==target&&source({revision:v.revision,sha256:v.sha256});
export const propAction=type=>names.find(k=>propTypes[k]===type);
export function validPropActions(v){
 return Array.isArray(v)&&v.length>0&&v.length<=names.length&&v.every((name,i)=>names.includes(name)&&v.indexOf(name)===i);
}
export function validPropPayload(type,p){
 const k=propAction(type),base=['schemaVersion','projectId','propId'];
 if(!k||p?.schemaVersion!==schema[k]||p.projectId!=='binari'||!propSlug(p.propId))return false;
 if(k==='generate'||k==='regenerate'){
  const reference=k==='generate'&&Object.hasOwn(p,'reference'),profile=Object.hasOwn(p,'presentationProfile');
  const fields=[...base,...(k==='regenerate'?['source']:[]),'intent','designContextSha256',
   ...(Object.hasOwn(p,'motion')?['motion']:[]),...(reference?['reference']:[]),...(profile?['presentationProfile']:[])];
  return exactPropKeys(p,fields)&&(!profile||supportedSpiritProfiles.includes(p.presentationProfile))&&(k!=='regenerate'||source(p.source))&&(!reference||validPropGenerateReference(p.reference,p.propId))&&
   text(p.intent,4000)&&propSha(p.designContextSha256)&&(!Object.hasOwn(p,'motion')||propMotion(p.motion));
 }
 const profile=Object.hasOwn(p,'renderProfile');
 return exactPropKeys(p,[...base,'source','motionId','prompt',...(profile?['renderProfile']:[])])&&
  (!profile||p.propId==='candle-brass-petal-unlit-clean'&&p.renderProfile==='candle-chroma-headroom-v1')&&
  source(p.source)&&propSlug(p.motionId)&&text(p.prompt,2000)&&!/\bembedding:/iu.test(p.prompt);
}
export const propPayload=(action,input)=>({...input,schemaVersion:schema[action],projectId:'binari'});

export const propAnimationRemoveType='prop.animation.remove';
export const propAnimationRemoveSchema='ngs.prop-animation-remove.v1';
export const validPropAnimationRemove=p=>exactPropKeys(p,['schemaVersion','projectId','propId','source','motionIds'])&&
 p.schemaVersion===propAnimationRemoveSchema&&p.projectId==='binari'&&propSlug(p.propId)&&source(p.source)&&
 Array.isArray(p.motionIds)&&p.motionIds.length>=1&&p.motionIds.length<=30&&p.motionIds.every(propSlug)&&new Set(p.motionIds).size===p.motionIds.length;
