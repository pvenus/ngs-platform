/** Folder identity, latest pointer and immutable package; never a generic file browser. */
import {propWorkspacePath,propSlug,propRevision,propSha,propAction,validPropPayload,validPropAnimationRemove} from './prop-workspace-contract.mjs';
import {hashReplicaBytes,readReplicaObject,workspaceItemIds} from './workspace-read-storage.mjs';
import {propDesignPin} from './prop-design-pin.mjs';
import {parsePropPointer,parsePropPackage,propManifestPath,propPointerPath,propAssetPath,propPackageMediaLimit} from './prop-package-contract.mjs';

const fail=(code,status)=>Object.assign(Error(code),{status});
const invalid=()=>fail('PROP_WORKSPACE_INPUT_INVALID',400);
const missing=()=>fail('PROP_WORKSPACE_NOT_FOUND',404);
const unavailable=()=>fail('PROP_WORKSPACE_REPLICA_UNAVAILABLE',503);
const projectId='binari',png=[137,80,78,71,13,10,26,10];
const relative=path=>path.slice('canonical-files/binari/'.length);
async function pointer(project,propId){
 const value=await readReplicaObject(project,relative(propPointerPath(propId)),8192);
 if(value===null)return null;
 try{return parsePropPointer(value,propId);}catch{throw unavailable();}
}
function same(a,b){return a&&b&&a.propId===b.propId&&a.revision===b.revision&&a.sha256===b.sha256&&a.title===b.title;}
function url(p,sha){return propWorkspacePath+'?'+new URLSearchParams({projectId,propId:p.propId,revision:p.revision,sha256:p.sha256,asset:sha});}

async function packageFrom(project,p){
 const bytes=await project.readBytes(relative(propManifestPath(p.propId,p.revision)),512*1024);
 if(!(bytes instanceof Uint8Array)||await hashReplicaBytes(bytes)!==p.sha256)throw unavailable();
 let row;
 try{row=parsePropPackage(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));}
 catch{throw unavailable();}
 if(row.propId!==p.propId||row.revision!==p.revision||p.title!==undefined&&row.title!==p.title)throw unavailable();
 return row;
}
async function selected(project,propId){
 const p=await pointer(project,propId);
 if(!p)throw missing();
 const row=await packageFrom(project,p);
 if(!same(p,await pointer(project,propId)))throw unavailable();
 return {p,row};
}

export async function admitPropRequest({openProject,command,actions=[],authorize}){
 const k=propAction(command.requestType);
 if(command.requestType==='prop.regenerate')throw fail('PROP_WORKSPACE_ACTION_UNAVAILABLE',404);
 if(!k)return;
 if(!actions.includes(k)||k==='generate'&&Array.isArray(command.payload?.scalePercents)&&!actions.includes('scale'))throw fail('PROP_WORKSPACE_ACTION_UNAVAILABLE',404);
 const p=command.payload;
 if(!validPropPayload(command.requestType,p))throw invalid();
 if(k==='generate'&&p.motion==='subtle')throw fail('PROP_WORKSPACE_ACTION_UNAVAILABLE',404);
 if(await authorize?.(p.projectId,'props')===false)throw fail('PROJECT_OR_RESOURCE_DENIED',403);
 const project=await openProject(p.projectId);
 if(!project)throw unavailable();
 if(k==='generate'){
  if(await pointer(project,p.propId))throw fail('PROP_WORKSPACE_TARGET_EXISTS',409);
  if(p.reference){
   const reference=await pointer(project,p.reference.propId);
   if(!reference||reference.revision!==p.reference.revision||reference.sha256!==p.reference.sha256)
    throw fail('PROP_WORKSPACE_REFERENCE_STALE',409);
   const existing=await packageFrom(project,reference);
   if(existing.media.detail.bytes>8*1024*1024)throw fail('PROP_WORKSPACE_REFERENCE_UNAVAILABLE',409);
   if(!same(reference,await pointer(project,reference.propId)))throw fail('PROP_WORKSPACE_REFERENCE_STALE',409);
  }
 }else{
  const {p:current,row}=await selected(project,p.propId);
  if(current.revision!==p.source.revision||current.sha256!==p.source.sha256)throw fail('PROP_WORKSPACE_SOURCE_STALE',409);
  if(k==='animation'&&row.animations.some(a=>a?.id===p.motionId))throw fail('PROP_WORKSPACE_MOTION_EXISTS',409);
 }
 if(k==='generate'){
  await authorize?.(p.projectId,'concept');
  if((await propDesignPin(openProject,p.projectId)).designContextSha256!==p.designContextSha256)
   throw fail('PROP_DESIGN_PIN_STALE',409);
 }
}

export async function admitPropAnimationRemove({openProject,command,authorize}){
 const p=command?.payload;
 if(!validPropAnimationRemove(p))throw invalid();
 if(await authorize?.(p.projectId,'props')===false)throw fail('PROJECT_OR_RESOURCE_DENIED',403);
 const project=await openProject(p.projectId);
 if(!project)throw unavailable();
 const {p:current,row}=await selected(project,p.propId);
 if(current.revision!==p.source.revision||current.sha256!==p.source.sha256)throw fail('PROP_WORKSPACE_SOURCE_STALE',409);
 const ids=new Set(row.animations.map(a=>a.id));
 if(!p.motionIds.every(id=>ids.has(id)))throw fail('PROP_WORKSPACE_MOTION_NOT_FOUND',404);
}

function publicMedia(pointer,media){
 const {sha256,width,height,mediaType,frameDurationsMs}=media;
 return {url:url(pointer,sha256),width,height,mediaType,frameDurationsMs};
}
function publicPair(pointer,media){
 return {detail:publicMedia(pointer,media.detail),...(media.pixel?{pixel:publicMedia(pointer,media.pixel)}:{}),
  ...(media.spirit?{spirit:publicMedia(pointer,media.spirit)}:{})};
}

export async function propWorkspaceRead({query,openProject,authorize}){
 const q=[...query.keys()],propId=query.get('propId'),revision=query.get('revision'),sha=query.get('sha256'),asset=query.get('asset');
 const design=query.get('view')==='design',exactPin=revision!==null||sha!==null||asset!==null;
 const expected=design?['projectId','view']:exactPin?['projectId','propId','revision','sha256',...(asset?['asset']:[])]:propId?['projectId','propId']:['projectId'];
 if(new Set(q).size!==expected.length||q.length!==expected.length||!expected.every(k=>q.includes(k))||query.get('projectId')!==projectId||
    propId!==null&&!propSlug(propId)||exactPin&&(!propSlug(propId)||!propSha(sha)||!/^\d{1,16}$/u.test(revision??'')||
     !propRevision(Number(revision))||String(Number(revision))!==revision||asset!==null&&!propSha(asset)))throw invalid();
 await authorize(projectId,design?'concept':'props');
 if(design)return {json:await propDesignPin(openProject,projectId)};
 const project=await openProject(projectId);
 if(!project)throw missing();
 if(!propId){
  const ids=(await workspaceItemIds(project,'props',true)).filter(propSlug);
  if(new Set(ids).size!==ids.length)throw unavailable();
  const props=[];
  for(let i=0;i<ids.length;i+=8){
   for(const p of await Promise.all(ids.slice(i,i+8).map(id=>pointer(project,id)))){
    if(p)props.push({propId:p.propId,title:p.title,revision:p.revision,sha256:p.sha256});
   }
  }
  return {json:{props}};
 }
 let pinned;
 if(exactPin){
  const current=await pointer(project,propId);
  if(!current)throw missing();
  const requested=Number(revision);
  if(requested>current.revision||requested===current.revision&&current.sha256!==sha)throw fail('PROP_WORKSPACE_SOURCE_STALE',409);
  const p={propId,revision:requested,sha256:sha};
  let row;
  try{row=await packageFrom(project,p);}catch{throw fail('PROP_WORKSPACE_SOURCE_STALE',409);}
  pinned={p:{...p,title:row.title},row};
 }
 const {p,row}=pinned??await selected(project,propId);
 if(asset){
  const slots=Object.values(row.media).concat(row.animations.flatMap(a=>Object.values(a.media)),
   (row.scaleVariants??[]).flatMap(v=>[v.pixel,v.spirit]));
  const matches=slots.filter(m=>m.sha256===asset),first=matches[0];
  if(!first||matches.some(m=>m.bytes!==first.bytes||m.mediaType!==first.mediaType))throw missing();
  const bytes=await project.readBytes(relative(propAssetPath(propId,first.assetId)),Math.min(first.bytes,propPackageMediaLimit));
  if(!(bytes instanceof Uint8Array)||bytes.length!==first.bytes||!png.every((n,i)=>bytes[i]===n)||await hashReplicaBytes(bytes)!==asset||
     !(await pointer(project,propId)))throw unavailable();
  return {bytes,mime:first.mediaType};
 }
 return {json:{prop:{propId,title:p.title,source:{revision:p.revision,sha256:p.sha256},
  media:publicPair(p,row.media),interaction:row.interaction,
  ...(row.defaultScalePercent===undefined?{}:{defaultScalePercent:row.defaultScalePercent}),
  ...(row.scaleVariants?{scaleVariants:row.scaleVariants.map(v=>({scalePercent:v.scalePercent,pixel:publicMedia(p,v.pixel),spirit:publicMedia(p,v.spirit)}))}:{}),
  animations:row.animations.map(a=>({id:a.id,title:a.title,media:publicPair(p,a.media)}))}}};
}
