import {MASTER_FPS,validCinematicPlayback} from './cinematic-timeline.mjs';
import {cinematicId,cinematicHash,cinematicMotion} from './cinematic-contract.mjs';
export const cinematicSequenceType='cinematic.sequence.generate';
export const cinematicSequenceSchema='ngs.cinematic-sequence-generate.v1';
export const cinematicSequenceResultSchema='ngs.cinematic-sequence-result.v1';
export const cinematicSequencePrefix='cinematics/sequences';
export const cinematicSequenceFrameLimit=4*1024*1024;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validCinematicSequencePayload(p){
 return exact(p,['schemaVersion','projectId','sourceSha256','motionPrompt','playback'])&&p.schemaVersion===cinematicSequenceSchema&&
  p.projectId==='binari'&&cinematicHash(p.sourceSha256)&&cinematicMotion(p.motionPrompt)&&validCinematicPlayback(p.playback);
}
export function validCinematicSequenceResult(m){
 return exact(m,['schemaVersion','projectId','officialRequestId','sourceSha256','width','height','masterFps','frameCount','frames','playback'])&&
  m.schemaVersion===cinematicSequenceResultSchema&&m.projectId==='binari'&&cinematicId(m.officialRequestId)&&cinematicHash(m.sourceSha256)&&
  [m.width,m.height].every(n=>Number.isInteger(n)&&n>=128&&n<=512&&n%32===0)&&m.masterFps===MASTER_FPS&&
  m.frameCount===45&&Array.isArray(m.frames)&&m.frames.length===m.frameCount&&
  m.frames.every((f,i)=>exact(f,['index','sha256','bytes'])&&f.index===i&&cinematicHash(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>=57&&f.bytes<=cinematicSequenceFrameLimit)&&
  m.frames.reduce((a,b)=>a+b.bytes,0)<=64*1024*1024&&validCinematicPlayback(m.playback);
}
export const cinematicSequenceFramePath=(id,i)=>cinematicSequencePrefix+'/'+id+'/frames/'+String(i).padStart(4,'0')+'.png';

export const cinematicPlaybackUpdateType='cinematic.playback.update';
export const cinematicPlaybackUpdateSchema='ngs.cinematic-playback-update.v1';
export const cinematicPlaybackStateSchema='ngs.cinematic-playback-state.v1';
const revision=n=>Number.isSafeInteger(n)&&n>=0&&n<Number.MAX_SAFE_INTEGER;
export const validCinematicPlaybackUpdate=p=>exact(p,['schemaVersion','projectId','sequenceId','expectedRevision','playback'])&&
 p.schemaVersion===cinematicPlaybackUpdateSchema&&p.projectId==='binari'&&cinematicId(p.sequenceId)&&
 revision(p.expectedRevision)&&validCinematicPlayback(p.playback);
export const validCinematicPlaybackState=p=>exact(p,['schemaVersion','projectId','sequenceId','revision','playback'])&&
 p.schemaVersion===cinematicPlaybackStateSchema&&p.projectId==='binari'&&cinematicId(p.sequenceId)&&
 revision(p.revision)&&p.revision>=1&&validCinematicPlayback(p.playback);
export const cinematicNativeTypes=Object.freeze([cinematicSequenceType,cinematicPlaybackUpdateType]);

export const cinematicSourceGenerateType='cinematic.source.generate';
export const cinematicSourceGenerateSchema='ngs.cinematic-source-generate.v1';
export const cinematicSourceResultSchema='ngs.cinematic-source-result.v1';
export const cinematicSequencesRemoveType='cinematic.sequences.remove';
export const cinematicSequencesRemoveSchema='ngs.cinematic-sequences-remove.v1';
export const cinematicArchivePath='cinematics/sequence-archive.json';
export const cinematicArchiveSchema='ngs.cinematic-sequence-archive.v1';
export const maxSelection=30;
const boundedText=(value,max,chars=max)=>typeof value==='string'&&value.isWellFormed()&&value===value.trim()&&value.length>0&&
 [...value].length<=chars&&new TextEncoder().encode(value).length<=max&&!/[\x00-\x1f\x7f]/u.test(value);
const oneEach=(list,test,limit)=>Array.isArray(list)&&list.length>=1&&list.length<=limit&&
 list.every(test)&&new Set(list).size===list.length;
export const validCinematicSourceGenerate=p=>exact(p,['schemaVersion','projectId','title','prompt'])&&
 p.schemaVersion===cinematicSourceGenerateSchema&&p.projectId==='binari'&&boundedText(p.title,480,120)&&cinematicMotion(p.prompt);
export const validCinematicSourceResult=p=>exact(p,['schemaVersion','projectId','officialRequestId','title','sha256','bytes','width','height'])&&
 p.schemaVersion===cinematicSourceResultSchema&&p.projectId==='binari'&&cinematicId(p.officialRequestId)&&boundedText(p.title,480,120)&&
 cinematicHash(p.sha256)&&Number.isSafeInteger(p.bytes)&&p.bytes>=57&&p.bytes<=8*1024*1024&&
 p.width===1536&&p.height===1024;
export const validCinematicSequencesRemove=p=>exact(p,['schemaVersion','projectId','sequenceIds'])&&
 p.schemaVersion===cinematicSequencesRemoveSchema&&p.projectId==='binari'&&oneEach(p.sequenceIds,cinematicId,maxSelection);
export const validCinematicArchive=p=>exact(p,['schemaVersion','projectId','sequenceIds'])&&p.schemaVersion===cinematicArchiveSchema&&p.projectId==='binari'&&
 (Array.isArray(p.sequenceIds)&&p.sequenceIds.length===0||oneEach(p.sequenceIds,cinematicId,4096));
export const cinematicNewTypes=Object.freeze([...cinematicNativeTypes,cinematicSourceGenerateType,cinematicSequencesRemoveType]);
