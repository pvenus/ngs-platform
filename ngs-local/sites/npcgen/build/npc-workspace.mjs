/** Shared NPC presentation from exact roster, category, and typed media records. */
import {readReplicaObject,hashReplicaBytes} from './workspace-read-storage.mjs';

const mediaLimit=8*1024*1024;
const npcKeys=['id','name','role','kind','chapters','status','summary','publicFace','actualTruth','arc',
 'behavior','belief','desire','fear','relationships','traits','values','voice','numericProfile','openQuestions'];

const invalid=()=>fault('NPC_WORKSPACE_INPUT_INVALID',400);
const missing=()=>fault('NPC_WORKSPACE_NOT_FOUND',404);
const unavailable=()=>fault('NPC_WORKSPACE_MEDIA_UNAVAILABLE',503);
const fault=(code,status)=>Object.assign(Error(code),{status});
const direction=['n','ne','e','se','s','sw','w','nw'];
const pose=['representative','idle','combat'];
const reference=['portrait','pixel','pixel-source'];
const layers={pixel:'assetId',raw:'rawAssetId',alpha:'alphaAssetId'};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)&&!/[\x00-\x20\x7f]/.test(value);
const ids=(value,limit=256)=>Array.isArray(value)?[...new Set(value.filter(id))].slice(0,limit):[];
const string=(s,fallback='')=>typeof s==='string'&&s.trim()?s.trim().slice(0,160):fallback;
const count=n=>Number.isSafeInteger(n)&&n>0&&n<=512;
const fps=n=>Number.isFinite(n)&&n>0&&n<=240;
const pick=(value,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(value,k)).map(k=>[k,value[k]]));
const split=(value,length)=>typeof value==='string'&&value.length<=384&&value.split('/').length===length
 ?value.split('/').every(id)?value.split('/'):null:null;
function tokens(values,length){
 return Array.isArray(values)?[...new Set(values.slice(0,256))].map(key=>split(key,length)).filter(Boolean):[];
}
function mediaAsset(value,ext){
 return typeof value==='string'&&value.length===64+ext.length&&value.endsWith(ext)&&/^[a-f0-9]{64}$/.test(value.slice(0,64));
}
const url=(npcId,locator,binding)=>'/api/npc-workspace?'+new URLSearchParams({projectId:'binari',npcId,media:locator,sha256:binding.asset.slice(0,64)});
const pngHead=[137,80,78,71,13,10,26,10],mp4Head=[102,116,121,112];
const bytesMatch=(bytes,wanted,offset=0)=>wanted.every((n,i)=>bytes[offset+i]===n);
async function sequenceMap(input,map){
 const rows=[];
 for(let i=0;i<input.length;i+=6)rows.push(...await Promise.all(input.slice(i,i+6).map(map)));
 return rows;
}
const poseLabel={representative:'대표',idle:'대기',combat:'전투'};
const portraitSlots={portrait:'portraitAssetId',pixel:'pixelAssetId','pixel-source':'pixelSourceAssetId'};
const portraitLabel={portrait:'포트레이트',pixel:'픽셀', 'pixel-source':'픽셀 원본'};
function picture(npc,pos,ref){
 if(!pose.includes(pos)||!Object.hasOwn(portraitSlots,ref))return null;
 const pair=npc.portraitSets?.[pos],asset=pair?.[portraitSlots[ref]];
 if(!mediaAsset(asset,'.png'))return null;
 // Workflows that publish an explicit proof cannot carry a pixel preview
 // across a different current original. Old rows without that proof remain readable.
 const proof=pair?.pixelProvenance;
 if(ref!=='portrait'&&Object.hasOwn(proof?.postprocess??{},'workflowTaskId')){
  const p=proof.pipeline;
  if(typeof proof.postprocess.workflowTaskId!=='string'||!/^workflow\.task\.[a-f0-9]{64}$/.test(proof.postprocess.workflowTaskId)
   ||!['portraitAssetId','pixelAssetId','pixelSourceAssetId'].every(k=>mediaAsset(pair[k],'.png'))
   ||p?.postprocessCompleted!==true||pair.pixelSourceAssetId!==pair.portraitAssetId
   ||!mediaAsset(pair.referencePortraitAssetId,'.png')
   ||pair.referencePortraitAssetId!==npc.portraitSets?.representative?.portraitAssetId
   ||p.portraitSha256+'.png'!==pair.portraitAssetId||p.pixelSha256+'.png'!==pair.pixelAssetId
   ||p.pixelSourceSha256+'.png'!==pair.pixelSourceAssetId||p.postprocessInputSha256!==p.pixelSourceSha256)return null;
 }
 return {asset,path:'npcs/'+npc.id+'/assets/portraits/'+pos+'/'+ref+'.png',ext:'.png'};
}
async function poseViewRow(project,npc,pos,ref,d){
 if(!pose.includes(pos)||!reference.includes(ref)||!direction.includes(d))return null;
 const base=[pos,ref,d].join('/');
 const row=await readReplicaObject(project,'npcs/'+npc.id+'/pose-views/'+base+'.json');
 if(row?.schemaVersion!=='ngs.npc-pose-view.v1'||row.posePreset!==pos||row.referenceType!==ref||row.direction!==d
   ||!mediaAsset(row.assetId,'.png')||row.mimeType!=='image/png')return null;
 return row;
}
async function view(project,npc,pos,ref,d){
 const row=await poseViewRow(project,npc,pos,ref,d);
 if(!row)return null;
 if(ref==='pixel'&&Object.hasOwn(row,'referenceArtifactId')){
  const center=picture(npc,pos,'pixel'),key=[pos,'portrait',d].join('/');
  const original=tokens(npc.poseViewKeys,3).some(parts=>parts.join('/')===key)
   ?await poseViewRow(project,npc,pos,'portrait',d):null;
  if(!center||center.asset!==row.referenceArtifactId||!original||original.referenceArtifactId!==center.asset
   ||original.assetId!==row.sourceArtifactId||row.sourceHash!==original.assetId.slice(0,64))return null;
 }
 return {asset:row.assetId,path:'npcs/'+npc.id+'/assets/pose-views/'+[pos,ref,d].join('/')+'/image.png',ext:'.png'};
}
async function video(project,npc,pos,preset,d){
 if(!pose.includes(pos)||!id(preset)||!direction.includes(d))return null;
 const base=[pos,preset,d].join('/');
 const row=await readReplicaObject(project,'npcs/'+npc.id+'/animations/'+base+'.json');
 if(row?.schemaVersion!=='ngs.npc-animation-slot.v1'||row.posePreset!==pos||row.presetId!==preset||row.direction!==d
   ||!mediaAsset(row.assetId,'.mp4')||row.mimeType!=='video/mp4'||!fps(row.fps)||!count(row.frameCount))return null;
 return {asset:row.assetId,path:'npcs/'+npc.id+'/assets/animations/'+base+'/video.mp4',ext:'.mp4',fps:row.fps,frameCount:row.frameCount};
}
async function frameSet(project,npc,pos,preset){
 if(!pose.includes(pos)||!id(preset))return null;
 const base=pos+'/'+preset;
 const row=await readReplicaObject(project,'npcs/'+npc.id+'/animation-frames/'+base+'.json');
 if(row?.schemaVersion!=='ngs.npc-animation-frame-set.v1'||row.posePreset!==pos||row.presetId!==preset)return null;
 return {directions:row.directions,base:'npcs/'+npc.id+'/assets/animation-frames/'+base};
}
function sequence(set,d){
 const row=set?.directions?.[d];
 if(!direction.includes(d)||!fps(row?.fps)||!count(row?.frameCount)||!Array.isArray(row.frames)||
  row.frames.length!==row.frameCount||!row.frames.every((frame,index)=>frame?.index===index&&mediaAsset(frame.assetId,'.png')))return null;
 return row;
}
function frame(set,d,row,index,layer){
 const field=Object.hasOwn(layers,layer)?layers[layer]:null;
 const asset=field&&row?.frames?.[index]?.[field];
 return mediaAsset(asset,'.png')?{asset,path:set.base+'/'+d+'/'+layer+'-'+index+'.png',ext:'.png'}:null;
}
async function mediaInventory(project,npcId){
 const prefix='npcs/'+npcId+'/assets/',rows=await project.listFiles(prefix.slice(0,-1));
 const paths=new Set(rows.flatMap(row=>typeof row?.path==='string'&&row.path.startsWith(prefix)&&
  (row.size===undefined||Number.isSafeInteger(row.size)&&row.size>=0&&row.size<=mediaLimit)?[row.path]:[]));
 return binding=>binding&&paths.has(binding.path);
}
const nativeMotions=['walk','run'];
const nativeFiles={
 raw:['animation-sequences','ngs.animation-native-png-sequence.v1','assetId'],
 alpha:['animation-alpha','ngs.animation-alpha-output.v1','alphaAssetId'],
 pixel:['animation-processed-directions','workflow.animation-pixel-direction.v1','assetId'],
};
const nativeIdentity=['npcId','generationId','posePreset','presetId','direction','sourceBindingHash','frameCount','fps'];
const hash=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
async function nativeTrack(project,npc,pos,preset,d,markPartial=()=>{}){
 if(pos!=='idle'||!nativeMotions.includes(preset)||!direction.includes(d))return null;
 const base=[pos,preset,d].join('/'),prefix='npcs/'+npc.id+'/';
 const read=async layer=>{
  const [directory,schema,assetKey]=nativeFiles[layer];
  const row=await readReplicaObject(project,prefix+directory+'/'+base+'.json');
  const valid=row?.schemaVersion===schema&&row.npcId===npc.id&&row.posePreset===pos&&row.presetId===preset&&row.direction===d&&
   id(row.generationId)&&hash(row.sourceBindingHash)&&fps(row.fps)&&
   Number.isSafeInteger(row.frameCount)&&row.frameCount>0&&row.frameCount<=1000&&Array.isArray(row.frames)&&
   row.frames.length===row.frameCount&&row.frames.every((frame,index)=>frame?.index===index&&mediaAsset(frame[assetKey],'.png'))
  if(row&&!valid)markPartial();
  return valid?row:null;
 };
 const raw=await read('raw');
 if(!raw)return null;
 const same=row=>row&&nativeIdentity.every(k=>raw[k]===row[k])&&
  row.frames.every((frame,i)=>frame.rawAssetId===raw.frames[i].assetId);
 const [a,p]=await Promise.all([read('alpha'),read('pixel')]);
 const alpha=same(a)?a:null;
 const pixel=alpha&&same(p)&&p.frames.every((f,i)=>f.alphaAssetId===alpha.frames[i].alphaAssetId)?p:null;
 if(a&&!alpha||p&&!pixel)markPartial();
 return {base,prefix,raw,alpha,pixel};
}
function nativeFrame(track,index,layer){
 if(!track||!Object.hasOwn(nativeFiles,layer))return null;
 const [directory,,assetKey]=nativeFiles[layer];
 const asset=track[layer]?.frames[index]?.[assetKey];
 return mediaAsset(asset,'.png')?{asset,path:track.prefix+'assets/'+directory+'/'+track.base+'/'+layer+'-'+index+'.png',ext:'.png'}:null;
}
async function nativeFrameSets(project,npc,sets,materialized,markPartial){
 for(const motion of nativeMotions){
  const merged=new Map(sets.find(x=>x.posePreset==='idle'&&x.presetId===motion)?.directions.map(row=>[row.direction,row])??[]);
  let changed=false;
  const tracks=await sequenceMap(direction,d=>nativeTrack(project,npc,'idle',motion,d,markPartial));
  for(const [i,d] of direction.entries()){
   const track=tracks[i];
   if(!track)continue;
   const frames=track.raw.frames.map((_,index)=>{
    const layerUrl=layer=>{
     const binding=nativeFrame(track,index,layer);
     if(binding&&!materialized(binding))markPartial();
     return materialized(binding)?url(npc.id,['native-frame','idle',motion,d,String(index),layer].join('/'),binding):null;
    };
    return {index,pixelUrl:layerUrl('pixel'),rawUrl:layerUrl('raw'),alphaUrl:layerUrl('alpha')};
   });
   if(!frames.every(f=>f.rawUrl))continue;
   for(const layer of ['pixelUrl','alphaUrl']){
    if(!frames.every(f=>f[layer]))for(const f of frames)f[layer]=null;
   }
   merged.set(d,{direction:d,fps:track.raw.fps,frameCount:frames.length,frames});
   changed=true;
  }
  if(changed){
   const next={posePreset:'idle',presetId:motion,directions:direction.flatMap(d=>merged.has(d)?[merged.get(d)]:[])};
   const index=sets.findIndex(x=>x.posePreset==='idle'&&x.presetId===motion);
   if(index===-1)sets.push(next);
   else sets[index]=next;
  }
 }
 return sets;
}
async function planningDocuments(project,npc,markPartial){
 const prefix='npcs/'+npc.id+'/planning/';
 return (await sequenceMap(ids(npc.planningCategoryOrder),async category=>{
  const info=await readReplicaObject(project,prefix+category+'.json');
  if(info?.id!==category){markPartial();return [];}
  const row={...pick(info,['id','planningRole']),name:string(info.name,category)};
  if(!Object.hasOwn(info,'contentFormat')&&!Object.hasOwn(info,'contentSha256'))
   return [{...row,...pick(info,['content'])}];
  // Indexed Markdown is the only authority once a marker exists. A failed
  // planning-body read never downgrades to cached JSON or breaks media tabs.
  const typed={...row,contentFormat:'markdown.v1'};
  if(info.contentFormat!=='markdown.v1'||Object.hasOwn(info,'content')||
     typeof info.contentSha256!=='string'||!/^[a-f0-9]{64}$/.test(info.contentSha256)){markPartial();return [typed];}
  try{
   const bytes=await project.readBytes(prefix+category+'/content.md',1024*1024);
   if(bytes&&await hashReplicaBytes(bytes)===info.contentSha256)
    typed.markdown=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  }catch{/* Unavailable for this document only; no fallback. */}
  if(typeof typed.markdown!=='string')markPartial();
  return [typed];
 })).flat();
}
async function detail(project,npc,markPartial){
 const np=npc.id,[planning,materialized]=await Promise.all([planningDocuments(project,npc,markPartial),mediaInventory(project,np)]);
 const portraits=[];
 for(const pos of pose)for(const ref of Object.keys(portraitSlots)){
  const locator=['portrait',pos,ref].join('/');
  const binding=picture(npc,pos,ref);
  if(npc.portraitSets?.[pos]?.[portraitSlots[ref]]&&!materialized(binding))markPartial();
  if(materialized(binding))portraits.push({id:locator,label:poseLabel[pos]+' '+portraitLabel[ref],
   posePreset:pos,referenceType:ref,url:url(np,locator,binding)});
 }
 for(const [pos,ref,d] of tokens(npc.poseViewKeys,3)){
  const locator=['pose',pos,ref,d].join('/');
  const binding=await view(project,npc,pos,ref,d);
  if(!materialized(binding))markPartial();
  if(materialized(binding))portraits.push({id:locator,label:poseLabel[pos]+' '+d.toUpperCase(),
   posePreset:pos,referenceType:ref,direction:d,url:url(np,locator,binding)});
 }
 const animations=(await sequenceMap(tokens(npc.animationSlotKeys,3),async ([pos,preset,d])=>{
  const binding=await video(project,npc,pos,preset,d);
  if(!materialized(binding))markPartial();
  return materialized(binding)?[{posePreset:pos,presetId:preset,direction:d,fps:binding.fps,frameCount:binding.frameCount,
   url:url(np,['animation',pos,preset,d].join('/'),binding)}]:[];
 })).flat();
 const frameSets=(await sequenceMap(tokens(npc.animationFrameSetKeys,2).slice(0,24),async ([pos,preset])=>{
  const set=await frameSet(project,npc,pos,preset);
  if(!set)markPartial();
  const directions=direction.flatMap(d=>{
   const row=sequence(set,d);
   if(!row){if(set?.directions?.[d])markPartial();return [];}
   const frames=row.frames.map((_,index)=>{
    const layerUrl=layer=>{
     const binding=frame(set,d,row,index,layer);
     if(binding&&!materialized(binding))markPartial();
     return materialized(binding)?url(np,['frame',pos,preset,d,String(index),layer].join('/'),binding):null;
    };
    return {index,pixelUrl:layerUrl('pixel'),rawUrl:layerUrl('raw'),alphaUrl:layerUrl('alpha')};
   });
   return frames.every(f=>f.pixelUrl)?[{direction:d,fps:row.fps,frameCount:row.frameCount,frames}]:[];
  });
  return directions.length?[{posePreset:pos,presetId:preset,directions}]:[];
 })).flat();
 return {npc:pick(npc,npcKeys),planning,portraits,animations,frameSets:await nativeFrameSets(project,npc,frameSets,materialized,markPartial)};
}
async function media(project,npc,locator,sha256){
 const fields=locator.split('/'),[kind,pos,a,b,c,d]=fields;
 let source;
 if(kind==='portrait'&&fields.length===3)source=picture(npc,pos,a);
 if(kind==='pose'&&fields.length===4&&tokens(npc.poseViewKeys,3).some(k=>k.join('/')===pos+'/'+a+'/'+b))source=await view(project,npc,pos,a,b);
 if(kind==='animation'&&fields.length===4&&tokens(npc.animationSlotKeys,3).some(k=>k.join('/')===pos+'/'+a+'/'+b))source=await video(project,npc,pos,a,b);
 if(kind==='frame'&&fields.length===6&&/^(?:0|[1-9][0-9]{0,2})$/.test(c)&&tokens(npc.animationFrameSetKeys,2).some(k=>k.join('/')===pos+'/'+a)){
  const set=await frameSet(project,npc,pos,a);
  source=frame(set,b,sequence(set,b),Number(c),d);
 }
 if(kind==='native-frame'&&fields.length===6&&/^(?:0|[1-9][0-9]{0,2})$/.test(c))
  source=nativeFrame(await nativeTrack(project,npc,pos,a,b),Number(c),d);
 if(!source)throw missing();
 if(source.asset.slice(0,64)!==sha256)throw fault('NPC_WORKSPACE_MEDIA_CHANGED',409);
 const bytes=await project.readBytes(source.path,mediaLimit);
 if(!bytes)throw missing();
 const mime=source.ext==='.png'?'image/png':'video/mp4';
 if(await hashReplicaBytes(bytes)!==source.asset.slice(0,64)||
    mime==='image/png'&&!bytesMatch(bytes,pngHead)||
    mime==='video/mp4'&&!bytesMatch(bytes,mp4Head,4))throw unavailable();
 return {bytes,mime};
}
const mediaFolderParts=Object.freeze({
 portraits:['assets/portraits','pose-views','assets/pose-views'],
 animations:['animation-frames','assets/animation-frames',
  ...Object.values(nativeFiles).flatMap(([dir])=>[dir,'assets/'+dir])],
});
function mediaScopes(projectId,npcId){
 const base=projectId+'/npcs/'+npcId+'/';
 return Object.fromEntries(Object.entries(mediaFolderParts).map(([key,values])=>[key,values.map(value=>base+value)]));
}
export function isOptionalNpcMediaScope(scope){
 const [project,folder,npc,...rest]=scope.split('/');
 return id(project)&&folder==='npcs'&&id(npc)&&rest.length>0
  &&Object.values(mediaFolderParts).some(values=>values.includes(rest.join('/')));
}
export async function npcWorkspaceRead({openProject,query,authorize}){
 const projectId=query.get('projectId'),npcId=query.get('npcId'),locator=query.get('media'),sha256=query.get('sha256'),keys=[...query.keys()];
 if(keys.length!==new Set(keys).size||keys.some(k=>!['projectId','npcId','media','sha256'].includes(k))||!id(projectId)||
   npcId!==null&&!id(npcId)||(locator===null)!==(sha256===null)||
   locator!==null&&(!npcId||!split(locator,locator.split('/').length)||sha256.length!==64||!/^[a-f0-9]{64}$/.test(sha256)))throw invalid();
 await authorize(projectId);
 if(projectId!=='binari')throw missing();
 const project=await openProject(projectId);
 const cache=locator===null?project?.npcCache:null;
 let generation;
 if(cache){
  try{
   generation=await cache.version();
   if(generation!==null){
    const hit=await cache.read(npcId,generation);
    if(hit?.projectId===projectId&&Array.isArray(hit.npcs)&&
       (npcId===null?!Object.hasOwn(hit,'npc'):hit.npc?.id===npcId)&&
       await cache.version()===generation)return {json:hit};
   }
  }catch{generation=null;} // Cache is optional; source reads still carry normal errors.
 }
 const index=project?await readReplicaObject(project,'npcs/metadata.json'):null;
 const actId=id(index?.actId)?index.actId:null;
 const allowed=ids(index?.characterOrder);
 const one=async np=>{
  const row=await readReplicaObject(project,'npcs/'+np+'/metadata.json');
  return row?.id===np?row:null;
 };
 if(locator!==null){
  const selected=allowed.includes(npcId)&&await one(npcId);
  if(!selected)throw missing();
  return media(project,selected,locator,sha256);
 }
 const roster=(await sequenceMap(allowed,one)).filter(Boolean);
 const base={projectId,actId,chapters:[...new Set(roster.flatMap(row=>ids(row.chapters)))].map(id=>({id,label:id})),
  npcs:roster.map(row=>({id:row.id,name:string(row.name,row.id),role:string(row.role),kind:string(row.kind),
   status:string(row.status),actId:id(row.actId)?row.actId:actId,chapters:ids(row.chapters),scope:projectId+'/npcs/'+row.id}))};
 let full=Array.isArray(index?.characterOrder)&&roster.length===allowed.length;
 const markPartial=()=>{full=false;};
 let json=base;
 if(npcId){
  const npc=roster.find(row=>row.id===npcId);
  if(!npc)throw missing();
  json={...base,...await detail(project,npc,markPartial),mediaScopes:mediaScopes(projectId,npcId)};
 }
 if(cache&&generation!=null&&full){
  try{await cache.store(npcId,generation,json);}catch{/* A cache write must not fail the authorized read. */}
 }
 return {json};
}
