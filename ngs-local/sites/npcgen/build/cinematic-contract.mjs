/** Common browser, Local and Space envelope. Paths are derived, never supplied. */
export const cinematicType='cinematic.generate';
export const cinematicSchema='ngs.cinematic-generate.v1';
export const cinematicResultSchema='ngs.cinematic-result.v1';
export const cinematicPath='/api/cinematic-workspace';
export const cinematicSourcePrefix='cinematics/sources';
export const cinematicResultPrefix='cinematics/results';
export const maxCinematicBytes=8*1024*1024;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const cinematicHash=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/u.test(v);
export const cinematicId=v=>typeof v==='string'&&v.length===81&&/^request\.official\.[a-f0-9]{64}$/u.test(v);
export const cinematicSourcePath=sha=>cinematicSourcePrefix+'/'+sha+'.png';
export const cinematicMotion=v=>typeof v==='string'&&v.isWellFormed()&&v===v.trim()&&new TextEncoder().encode(v).length<=2000&&[...v].length>=1&&[...v].length<=1000&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\bembedding:/iu.test(v);
export const validCinematicPayload=v=>exact(v,['schemaVersion','projectId','sourceSha256','motionPrompt'])&&
 v.schemaVersion===cinematicSchema&&v.projectId==='binari'&&cinematicHash(v.sourceSha256)&&cinematicMotion(v.motionPrompt);
export const validCinematicResult=v=>exact(v,['schemaVersion','projectId','officialRequestId','sourceSha256','sha256','bytes','mimeType','width','height','fps','frameCount'])&&
 v.schemaVersion===cinematicResultSchema&&v.projectId==='binari'&&cinematicId(v.officialRequestId)&&cinematicHash(v.sourceSha256)&&
 cinematicHash(v.sha256)&&v.mimeType==='video/mp4'&&Number.isSafeInteger(v.bytes)&&v.bytes>=24&&v.bytes<=maxCinematicBytes&&
 [v.width,v.height].every(x=>Number.isInteger(x)&&x>=128&&x<=512&&x%32===0)&&
 v.fps===24&&v.frameCount===45;
