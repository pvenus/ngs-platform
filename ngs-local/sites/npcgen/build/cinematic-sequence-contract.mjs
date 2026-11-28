import {MASTER_FPS,validCinematicPlayback,validBackgroundLoopPlayback} from './cinematic-timeline.mjs';
import {cinematicId,cinematicHash,cinematicMotion} from './cinematic-contract.mjs';
export const cinematicSequenceType='cinematic.sequence.generate';
export const cinematicUpscaleType='cinematic.sequence.upscale';
export const cinematicUpscaleSchema='ngs.cinematic-sequence-upscale.v1';
export const validCinematicUpscale=p=>exact(p,['schemaVersion','projectId','sequenceId','sourceSha256','expectedRevision','playback'])&&
 p.schemaVersion===cinematicUpscaleSchema&&p.projectId==='binari'&&cinematicId(p.sequenceId)&&cinematicHash(p.sourceSha256)&&
 Number.isSafeInteger(p.expectedRevision)&&p.expectedRevision>=0&&p.expectedRevision<Number.MAX_SAFE_INTEGER&&validCinematicPlayback(p.playback);
export const cinematicSequenceSchema='ngs.cinematic-sequence-generate.v1';
export const cinematicSequenceNamedSchema='ngs.cinematic-sequence-generate.v2';
export const nativeCinematicPlayback=count=>({durationFrames:count,speedCurve:[{frame:0,rate:1}],cameraCurve:[{frame:0,zoom:1,x:.5,y:.5}]});
export const cinematicSequenceResultSchema='ngs.cinematic-sequence-result.v1';
export const cinematicSequencePrefix='cinematics/sequences';
export const cinematicSequenceFrameLimit=4*1024*1024;
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export function validCinematicSequencePayload(p){
 if(p?.schemaVersion===cinematicSequenceNamedSchema)
  return exact(p,['schemaVersion','projectId','sourceSha256','motionPrompt','title'])&&p.projectId==='binari'&&
   cinematicHash(p.sourceSha256)&&cinematicMotion(p.motionPrompt)&&boundedText(p.title,480,120);
 return exact(p,['schemaVersion','projectId','sourceSha256','motionPrompt','playback'])&&p.schemaVersion===cinematicSequenceSchema&&
  p.projectId==='binari'&&cinematicHash(p.sourceSha256)&&cinematicMotion(p.motionPrompt)&&validCinematicPlayback(p.playback);
}
export function validCinematicSequenceResult(m){
 const upscale=Object.hasOwn(m??{},'upscale'),grouped=Object.hasOwn(m??{},'group');
 const fields=['schemaVersion','projectId','officialRequestId','sourceSha256','width','height','masterFps','frameCount','frames','playback'];
 if(grouped)fields.push('group');
 if(Object.hasOwn(m??{},'title')){if(grouped||!boundedText(m.title,480,120))return false;fields.push('title');}
 if(upscale)fields.push('upscale');
 const baseSize=n=>Number.isInteger(n)&&n>=128&&n<=512&&n%32===0;
 const u=m?.upscale;
 const compact=grouped&&m.playback?.durationFrames===84&&m.playback?.speedCurve?.[0]?.rate===1/6;
 const count=compact?8:45,reduced=compact&&m.group?.variant==='pixel';
 const hasCorrection=Object.hasOwn(u??{},'pixelCorrection'),c=u?.pixelCorrection;
 const derived=upscale&&!grouped;
 const dimensions=upscale?(grouped||cinematicId(u?.sourceSequenceId)&&u.sourceSequenceId!==m.officialRequestId)&&exact(u,['model','scale','sourceWidth','sourceHeight',...(derived?['sourceSequenceId']:[]),...(hasCorrection?['pixelCorrection']:[])])&&
  (!reduced||hasCorrection)&&
  (!hasCorrection||m.group?.variant==='pixel'&&exact(c,['method','upscaledFramesSha256',...(reduced?['downscale']:[])])&&
   c.method==='reference-palette-v1'&&cinematicHash(c.upscaledFramesSha256)&&(!reduced||c.downscale===2))&&
  u.model==='seedvr2-7b-fp16'&&u.scale===2&&baseSize(u.sourceWidth)&&baseSize(u.sourceHeight)&&
  m.width===u.sourceWidth*(reduced?1:2)&&m.height===u.sourceHeight*(reduced?1:2):[m?.width,m?.height].every(baseSize);
 return exact(m,fields)&&(!grouped||validBackgroundAnimationGroup(m.group))&&
  m.schemaVersion===cinematicSequenceResultSchema&&m.projectId==='binari'&&cinematicId(m.officialRequestId)&&cinematicHash(m.sourceSha256)&&
  dimensions&&m.masterFps===MASTER_FPS&&
  (!compact||upscale)&&m.frameCount===count&&Array.isArray(m.frames)&&m.frames.length===m.frameCount&&
  m.frames.every((f,i)=>exact(f,['index','sha256','bytes'])&&f.index===i&&cinematicHash(f.sha256)&&Number.isSafeInteger(f.bytes)&&f.bytes>=57&&f.bytes<=cinematicSequenceFrameLimit)&&
  m.frames.reduce((a,b)=>a+b.bytes,0)<=(upscale?128:64)*1024*1024&&validCinematicPlayback(m.playback);
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
 validCinematicGeometry(p.width,p.height);
export const validCinematicSequencesRemove=p=>exact(p,['schemaVersion','projectId','sequenceIds'])&&
 p.schemaVersion===cinematicSequencesRemoveSchema&&p.projectId==='binari'&&oneEach(p.sequenceIds,cinematicId,maxSelection);
export const validCinematicArchive=p=>exact(p,['schemaVersion','projectId','sequenceIds'])&&p.schemaVersion===cinematicArchiveSchema&&p.projectId==='binari'&&
 (Array.isArray(p.sequenceIds)&&p.sequenceIds.length===0||oneEach(p.sequenceIds,cinematicId,4096));
export const backgroundSourceType='background.source.generate';
export const backgroundSourceSchema='ngs.background-source-generate.v1';
export const backgroundResultSchema='ngs.background-source-result.v1';
export const backgroundPath='/api/background-workspace';
export const backgroundFields=Object.freeze([
 ['title','배경 이름',120],['timeOfDay','시간대',80],['season','계절',80],['mood','분위기',160],
 ['color','주조색',120],['location','장소',160],['requirements','필수 요청 사항',900],
 ['additionalNotes','추가 요청 사항 (선택)',900]
]);
const bounds=(value,n,multi)=>typeof value==='string'&&value.isWellFormed()&&value.trim()===value&&
 [...value].length>0&&[...value].length<=n&&
 !(multi?/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]|\bembedding:/iu:/[\x00-\x1f\x7f-\x9f]|\bembedding:/iu).test(value);
export const validBackgroundRequest=p=>exact(p,['schemaVersion','projectId',...backgroundFields.map(x=>x[0])])&&
 p.schemaVersion===backgroundSourceSchema&&p.projectId==='binari'&&backgroundFields.every(([key,,n])=>
  key==='additionalNotes'&&p[key]===''||bounds(p[key],n,key==='requirements'||key==='additionalNotes'));
export const backgroundPixelType='background.pixel.workflow';
export const backgroundPixelSchema='ngs.background-pixel-workflow.v1';
export const validBackgroundPixelRequest=p=>p?.schemaVersion===backgroundPixelSchema&&typeof p.title==='string'&&
 [...p.title].length<=105&&validBackgroundRequest({...p,schemaVersion:backgroundSourceSchema});
export const validBackgroundResult=p=>p?.schemaVersion===backgroundResultSchema&&p.width===1536&&p.height===1024&&validCinematicSourceResult({...p,schemaVersion:cinematicSourceResultSchema});
export const backgroundAnimationType='background.animation.workflow',backgroundAnimationSchema='ngs.background-animation-workflow.v2';
const legacyBackgroundAnimationSchema='ngs.background-animation-workflow.v1';
export const backgroundLoopInstruction='Continuous seamless ambient loop, static camera.';
export const backgroundLoopPrompt=intent=>backgroundLoopInstruction+
 ' Keep motion present throughout, with no hold or one-shot event. Treat the following as cyclic ambient motion only: '+intent.trim();
export const validBackgroundAnimation=p=>exact(p,['schemaVersion','projectId','backgroundSha256','references','motionPrompt','playback'])&&
 [backgroundAnimationSchema,legacyBackgroundAnimationSchema].includes(p.schemaVersion)&&p.projectId==='binari'&&cinematicHash(p.backgroundSha256)&&
 p.references&&typeof p.references==='object'&&!Array.isArray(p.references)&&Object.keys(p.references).length>=1&&
 Object.entries(p.references).every(([variant,hash])=>['cinematic','pixel'].includes(variant)&&cinematicHash(hash))&&
 new Set(Object.values(p.references)).size===Object.keys(p.references).length&&cinematicMotion(p.motionPrompt)&&
 p.motionPrompt.startsWith(backgroundLoopInstruction+' ')&&validBackgroundLoopPlayback(p.playback)&&
 (p.schemaVersion===backgroundAnimationSchema||p.playback.durationFrames===264);
export const validBackgroundAnimationGroup=g=>exact(g,['requestId','variant','backgroundSha256'])&&
 cinematicId(g.requestId)&&['cinematic','pixel'].includes(g.variant)&&cinematicHash(g.backgroundSha256);
export const cinematicNewTypes=Object.freeze([...cinematicNativeTypes,cinematicUpscaleType,cinematicSourceGenerateType,backgroundSourceType,backgroundPixelType,backgroundAnimationType,cinematicSequencesRemoveType]);

export const cinematicCropType='cinematic.source.crop',cinematicCropSchema='ngs.cinematic-source-crop.v1';
export const validCinematicGeometry=(w,h)=>[w,h].every(n=>Number.isInteger(n)&&n>=1&&n<=4096)&&w*h<=8388608;
const cropKeys=['width','height','left','top','right','bottom'];
export function cinematicCropPresets(width,height){
 if(!validCinematicGeometry(width,height)||width===2*height)return [];
 const wide=width>height*2;
 // An odd width cannot be preserved exactly in a vertical-only 2:1 crop.
 // Drop one right-edge pixel explicitly; the preview shows that second edge.
 const w=wide?height*2:width-width%2,h=wide?height:w/2;
 if(w<2||h<1)return [];
 const dx=width-w,dy=height-h;
 return (wide?[['좌측 자르기',dx,0],['우측 자르기',0,0],['좌우 자르기',Math.floor(dx/2),0]]:
  [['상단 자르기',0,dy],['하단 자르기',0,0],['상하 자르기',0,Math.floor(dy/2)]])
  .map(([label,left,top])=>({label,width,height,left,top,right:left+w,bottom:top+h}));
}
export const validCinematicCrop=p=>exact(p,['schemaVersion','projectId','title','sourceSha256',...cropKeys])&&
 p.schemaVersion===cinematicCropSchema&&p.projectId==='binari'&&boundedText(p.title,480,120)&&cinematicHash(p.sourceSha256)&&
 validCinematicGeometry(p.width,p.height)&&p.width!==2*p.height&&cropKeys.slice(2).every(k=>Number.isInteger(p[k])&&p[k]>=0)&&
 p.left<p.right&&p.right<=p.width&&p.top<p.bottom&&p.bottom<=p.height&&p.right-p.left===2*(p.bottom-p.top);
