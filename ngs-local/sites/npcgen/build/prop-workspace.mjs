import {validPropFolderDelete} from './prop-folder-delete-contract.mjs';
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
 if(!k)return;
 if(!actions.includes(k))throw fail('PROP_WORKSPACE_ACTION_UNAVAILABLE',404);
 const p=command.payload;
 if(!validPropPayload(command.requestType,p))throw invalid();
 if(k!=='animation'&&p.motion==='subtle')throw fail('PROP_WORKSPACE_ACTION_UNAVAILABLE',404);
 await authorize?.(p.projectId,'props');
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
 if(k!=='animation'){
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

export async function admitPropFolderDelete({openProject,command,authorize}){
 const p=command?.payload;
 if(!validPropFolderDelete(p))throw invalid();
 if(await authorize?.(p.projectId,'props')===false)throw fail('PROJECT_OR_RESOURCE_DENIED',403);
 const project=await openProject(p.projectId);
 if(!project)throw unavailable();
 const {p:current}=await selected(project,p.target.path);
 if(current.revision!==p.expected.revision||current.sha256!==p.expected.sha256)
  throw fail('PROP_WORKSPACE_SOURCE_STALE',409);
}

function publicMedia(pointer,media){
 const {sha256,width,height,mediaType,frameDurationsMs}=media;
 return {url:url(pointer,sha256),width,height,mediaType,frameDurationsMs};
}
function publicPair(pointer,media){
 return {detail:publicMedia(pointer,media.detail),pixel:publicMedia(pointer,media.pixel),
  ...(media.spirit?{spirit:publicMedia(pointer,media.spirit)}:{})};
}

export async function propWorkspaceRead({query,openProject,authorize}){
 const q=[...query.keys()],propId=query.get('propId'),revision=query.get('revision'),sha=query.get('sha256'),asset=query.get('asset');
 const design=query.get('view')==='design';
 const expected=design?['projectId','view']:asset?['projectId','propId','revision','sha256','asset']:propId?['projectId','propId']:['projectId'];
 if(new Set(q).size!==expected.length||q.length!==expected.length||!expected.every(k=>q.includes(k))||query.get('projectId')!==projectId||
    propId!==null&&!propSlug(propId)||asset!==null&&(!propSha(asset)||!propSha(sha)||!/^\d{1,16}$/u.test(revision??'')||
     !propRevision(Number(revision))||String(Number(revision))!==revision))throw invalid();
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
 const {p,row}=await selected(project,propId);
 if(asset){
  if(p.revision!==Number(revision)||p.sha256!==sha)throw fail('PROP_WORKSPACE_SOURCE_STALE',409);
  const slots=Object.values(row.media).concat(row.animations.flatMap(a=>Object.values(a.media)));
  const matches=slots.filter(m=>m.sha256===asset),first=matches[0];
  if(!first||matches.some(m=>m.bytes!==first.bytes||m.mediaType!==first.mediaType))throw missing();
  const bytes=await project.readBytes(relative(propAssetPath(propId,first.assetId)),Math.min(first.bytes,propPackageMediaLimit));
  if(!(bytes instanceof Uint8Array)||bytes.length!==first.bytes||!png.every((n,i)=>bytes[i]===n)||await hashReplicaBytes(bytes)!==asset||
     !same(p,await pointer(project,propId)))throw unavailable();
  return {bytes,mime:first.mediaType};
 }
 return {json:{prop:{propId,title:p.title,source:{revision:p.revision,sha256:p.sha256},
  media:publicPair(p,row.media),interaction:row.interaction,
  animations:row.animations.map(a=>({id:a.id,title:a.title,media:publicPair(p,a.media)}))}}};
}

// Local assembly renderer resolves only an immutable manifest explicitly pinned by a published assembly.
export async function assemblyPinnedPropRead({query,openProject,authorize,allowPin}){
 const keys=[...query.keys()],projectId=query.get('projectId'),propId=query.get('propId'),revision=Number(query.get('revision')),sha256=query.get('sha256'),asset=query.get('asset');
 const expected=['projectId','propId','revision','sha256','assemblyId',...(asset?['asset']:[])];
 if(projectId!=='binari'||keys.length!==expected.length||!expected.every(k=>keys.includes(k))||!propSlug(propId)||!propRevision(revision)||
    String(revision)!==query.get('revision')||!propSha(sha256)||asset&&!propSha(asset))throw invalid();
 await authorize(projectId,'props');
 if(!await allowPin({assemblyId:query.get('assemblyId'),propId,revision,sha256}))throw missing();
 const project=await openProject(projectId);
 if(!project||!await pointer(project,propId))throw missing();
 const row=await packageFrom(project,{propId,revision,sha256});
 const media=row.media.pixel;
 const bound=new URLSearchParams(query);bound.set('asset',media.sha256);
 if(!asset)return {json:{prop:{propId,title:row.title,source:{revision,sha256},
  media:{pixel:{...publicMedia({propId,revision,sha256},media),url:'/api/assembly-prop?'+bound}}}}};
 if(asset!==media.sha256||media.mediaType!=='image/png')throw missing();
 const bytes=await project.readBytes(relative(propAssetPath(propId,media.assetId)),Math.min(media.bytes,propPackageMediaLimit));
 if(!(bytes instanceof Uint8Array)||bytes.length!==media.bytes||!png.every((n,i)=>bytes[i]===n)||await hashReplicaBytes(bytes)!==asset)throw unavailable();
 return {bytes,mime:media.mediaType};
}
