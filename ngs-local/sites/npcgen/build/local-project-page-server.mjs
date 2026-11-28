import {puzzleCoreVersion,withPuzzleCore,servePuzzleCore,puzzleCoreCsp} from './puzzle-core-release.mjs';
import {workspaceReleaseCapabilities as released} from './workspace-release-capabilities.mjs';
import {fileUpdateType,fileUpdatePds} from './file-update-envelope.mjs';
import {admitWorkspaceMapAssembly} from './workspace-map-assembly-admission.mjs';
import {assemblyTypes,assemblyPath,assemblyPds,assemblyCapability} from './assembly-contract.mjs';
import {assemblyWorkspaceRead} from './assembly-workspace.mjs';
import {mapTypes,mapPds,mapCapability} from './map-contract.mjs';
import {fileDeleteType,propsDeleteRoot,npcDeleteRoot,backgroundDeleteRoot,cinematicDeleteRoot,cinematicDeletePayloads,mapDeleteRoot,assemblyDeleteRoot,workspaceDeleteFamily} from './prop-folder-delete-contract.mjs';
/** NGS browser app: serve the local replica and enqueue validated requests. */
import {readFileSync,lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {createServer,get as loopbackGet} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectPermission} from './auth-core.mjs';
import {replicaSyncProgressPath,readReplicaSyncProgress} from './replica-sync-progress.mjs';
import {assertLoopbackRequest,createLoopbackAuth} from './loopback-auth.mjs';
import {createLocalProjectFolders,validProjectId} from './local-project-folders.mjs';
import {localProjectFolderRoute,projectFolderRoutes} from './local-project-folder-route.mjs';
import {validFolderPath} from './local-recursive-folders.mjs';
import {openLocalWorkspaceProject} from './local-project-workspace.mjs';
import {localObjectReplicaViews} from './local-object-replica-views.mjs';
import {openLocalObjectReplicaFromEnv} from './local-object-replica-runtime.mjs';
import {cinematicUpscaleType,cinematicSequenceType,cinematicPlaybackUpdateType,cinematicSourceGenerateType,backgroundSourceType,backgroundPixelType,backgroundAnimationType,cinematicSequencesRemoveType} from './cinematic-sequence-contract.mjs';
import {cinematicPath,cinematicType} from './cinematic-contract.mjs';
import {admitCinematicRequest,cinematicVideoResponse} from './cinematic-workspace.mjs';
import {propAction,validPropActions} from './prop-workspace-contract.mjs';
import {admitPropRequest,admitPropAnimationRemove} from './prop-workspace.mjs';
import {createRSPropReadiness} from './rs-mcp.mjs';
import {dispatchWorkspaceRead,workspaceReadRoute} from './workspace-read-registry.mjs';
import {uiStagePath,uiMaxPng,uiSchemas,validUiRequest} from './ui-asset-contract.mjs';
import {stageLocalUiPng} from './local-ui-stage.mjs';
import {parseRequestSubmission} from './local-request-submission.mjs';
import {openLocalRequestQueue} from './local-request-queue.mjs';
import {conceptCategoryRequestType,validConceptCategoryRequest} from './local-concept-category-contract.mjs';
import {npcPlanningAddType,npcPlanningRequestType,validNpcPlanningAdd,validNpcPlanningUpdate} from './local-npc-planning-ui.mjs';
import {audioResponseRange,localAudioResults,localAudioSeparationSource} from './local-audio-results.mjs';
import {openPuzzleBundle,puzzlePrefix} from './local-puzzle-media.mjs';
import {audioSeparationType,validAudioSeparationPayload,validLocalAudioPayload} from './local-audio-workspace.mjs';
import {motionPresetConvertType,validMotionPresetConvert} from './motion-preset-convert-2d.mjs';
import {isPoseSelectionV2,validNpcWorkflowRequest,animationRegenerateType,validNpcAnimationRegenerate,npcBasicSchema,portraitRegenerateType,validNpcPortraitRegeneration} from './npc-motion-selection.mjs';

const canonicalPolicy=new URL('../../../dev/catalog-read-policy.json',import.meta.url);
const assets=new Map([
 ['/browser-sha256.mjs',['text/javascript; charset=utf-8',new URL('./browser-sha256.mjs',import.meta.url)]],
 ['/browser-request-id.mjs',['text/javascript; charset=utf-8',new URL('./browser-request-id.mjs',import.meta.url)]],
 ['/', ['text/html; charset=utf-8', new URL('./local-project-page.html',import.meta.url)]],
 ['/local-project-page.css', ['text/css; charset=utf-8', new URL('./local-project-page.css',import.meta.url)]],
 ['/local-project-page.js', ['text/javascript; charset=utf-8', new URL('./local-project-page.js',import.meta.url)]],
 ['/prop-package-contract.mjs',['text/javascript; charset=utf-8',new URL('./prop-package-contract.mjs',import.meta.url)]],
 ['/cinematic-sequence-contract.mjs',['text/javascript; charset=utf-8',new URL('./cinematic-sequence-contract.mjs',import.meta.url)]],
 ['/cinematic-timeline.mjs',['text/javascript; charset=utf-8',new URL('./cinematic-timeline.mjs',import.meta.url)]],
 ...['ui-asset-contract.mjs','ui-workspace-ui.mjs'].map(name=>['/'+name,['text/javascript; charset=utf-8',new URL('./'+name,import.meta.url)]]),
 ...['file-update-envelope.mjs','map-contract.mjs','map-workspace-ui.mjs','map-warp.mjs'].map(name=>['/'+name,['text/javascript; charset=utf-8',new URL('./'+name,import.meta.url)]]),
 ...['puzzle-state-runtime.mjs','well-puzzle-demo.mjs','well-assembly-ui.mjs','assembly-contract.mjs','assembly-catalog-ui.mjs','assembly-sprite-layout.mjs','assembly-actor.mjs'].map(name=>['/'+name,['text/javascript; charset=utf-8',new URL('./'+name,import.meta.url)]]),
 ['/background-playback.mjs',['text/javascript; charset=utf-8',new URL('./background-playback.mjs',import.meta.url)]],
 ['/cinematic-player.mjs',['text/javascript; charset=utf-8',new URL('./cinematic-player.mjs',import.meta.url)]],
 ['/cinematic-contract.mjs',['text/javascript; charset=utf-8',new URL('./cinematic-contract.mjs',import.meta.url)]],
 ['/prop-folder-delete-contract.mjs',['text/javascript; charset=utf-8',new URL('./prop-folder-delete-contract.mjs',import.meta.url)]],
 ['/catalog-roster-edit.mjs',['text/javascript; charset=utf-8',new URL('./catalog-roster-edit.mjs',import.meta.url)]],
 ['/cinematic-workspace-ui.mjs',['text/javascript; charset=utf-8',new URL('./cinematic-workspace-ui.mjs',import.meta.url)]],
 ['/prop-workspace-ui.mjs',['text/javascript; charset=utf-8',new URL('./prop-workspace-ui.mjs',import.meta.url)]],
 ['/prop-workspace-contract.mjs',['text/javascript; charset=utf-8',new URL('./prop-workspace-contract.mjs',import.meta.url)]],
 ['/local-npc-workspace-ui.mjs', ['text/javascript; charset=utf-8', new URL('./local-npc-workspace-ui.mjs',import.meta.url)]],
 ['/npc-motion-selection.mjs', ['text/javascript; charset=utf-8', new URL('./npc-motion-selection.mjs',import.meta.url)]],
 ['/local-npc-one-stop-ui.mjs', ['text/javascript; charset=utf-8', new URL('./local-npc-one-stop-ui.mjs',import.meta.url)]],
 ['/local-concept-category-ui.mjs', ['text/javascript; charset=utf-8', new URL('./local-concept-category-ui.mjs',import.meta.url)]],
 ['/local-concept-category-contract.mjs', ['text/javascript; charset=utf-8', new URL('./local-concept-category-contract.mjs',import.meta.url)]],
 ['/local-npc-planning-ui.mjs', ['text/javascript; charset=utf-8', new URL('./local-npc-planning-ui.mjs',import.meta.url)]],
 ['/local-audio-workspace.mjs', ['text/javascript; charset=utf-8', new URL('./local-audio-workspace.mjs',import.meta.url)]],
 ['/motion-preset-convert-2d.mjs', ['text/javascript; charset=utf-8', new URL('./motion-preset-convert-2d.mjs',import.meta.url)]],
 ['/local-request-queue-browser.mjs', ['text/javascript; charset=utf-8', new URL('./local-request-queue-browser.mjs',import.meta.url)]],
]);
const puzzleCode=new Map([
 ['', ['text/html; charset=utf-8','local-puzzle-empty-veranda.html']],
 ['play.css', ['text/css; charset=utf-8','local-puzzle-play.css']],
 ['play.mjs', ['text/javascript; charset=utf-8','local-puzzle-play.mjs']],
 ['ending-state.mjs', ['text/javascript; charset=utf-8','local-puzzle-ending-state.mjs']],
 ['scene-input.mjs', ['text/javascript; charset=utf-8','local-puzzle-scene-input.mjs']],
 ['v28-pointer-collector.js', ['text/javascript; charset=utf-8','local-puzzle-v28-pointer.js']],
]);
const failure=(code,status)=>Object.assign(Error(code),{status});

// Branding is optional, external to the source tree. Public clones still boot.
const transparentMark=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=','base64');
function brandMark(path){
 if(path===undefined)return transparentMark;
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)throw failure('LOCAL_BRAND_MARK_INVALID',503);
 const st=lstatSync(path);
 if(!st.isFile()||st.size<8||st.size>2*1024*1024)throw failure('LOCAL_BRAND_MARK_INVALID',503);
 const png=readFileSync(path);
 if(png.length!==st.size||!png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw failure('LOCAL_BRAND_MARK_INVALID',503);
 return png;
}

function approvedProjectReads(){
 const ids=JSON.parse(readFileSync(canonicalPolicy)).projects?.map(row=>row.id);
 if(!Array.isArray(ids)||ids.some(id=>!validProjectId(id))||new Set(ids).size!==ids.length){
  throw failure('PROJECT_READ_POLICY_INVALID',503);
 }
 return ids.map(id=>({id,resources:[],write:false}));
}
function prepareFreshParent(root){
 const parent=dirname(root);
 try{lstatSync(parent);}catch(error){
  if(error.code!=='ENOENT'||realpathSync(dirname(parent))!==dirname(parent))throw error;
  try{mkdirSync(parent,{mode:0o700});}catch(err){if(err.code!=='EEXIST')throw err;}
 }
 const st=lstatSync(parent);
 if(!st.isDirectory()||st.uid!==process.getuid()||(st.mode&0o022)||realpathSync(parent)!==parent){
  throw failure('LOCAL_PROJECT_PARENT_NOT_PRIVATE',503);
 }
}
async function readSmallBody(req,limit){
 const chunks=[];
 let n=0;
 for await(const chunk of req){
  n+=chunk.length;
  if(n>limit)throw failure('PAYLOAD_TOO_LARGE',413);
  chunks.push(chunk);
 }
 return Buffer.concat(chunks,n);
}

const nativeMacEntry=new URL('./local-miniflare-app.mjs',import.meta.url).href;
const isNativeMac=(platform,entryPoint)=>platform==='darwin'&&typeof entryPoint==='string'&&
 pathToFileURL(entryPoint).href===nativeMacEntry;
function macPuzzleDefault(platform,entryPoint){
 return isNativeMac(platform,entryPoint)
  ?join(homedir(),'Workspaces','NGS','runtime','puzzle-design-assets','binari-bad-ending-v1')
  :undefined;
}
async function readWorkflowCapability(path,schema){
 try{
  const r=await fetch('http://127.0.0.1:8030'+path,{redirect:'error',signal:AbortSignal.timeout(350)});
  if(!r.ok)return false;
  const v=await r.json();
  return v?.schemaVersion===schema&&v.enabled===true;
 }catch{return false;}
}
const readLocalCinematicReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow','workflow.cinematic-write.v1');
const readLocalSequenceReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow-sequence','workflow.cinematic-sequence-write.v1');
const readLocalUpscaleReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow-sequence/upscale','workflow.cinematic-sequence-upscale.v1');
const readLocalBackgroundAnimationReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow-sequence/background-status','workflow.background-animation-write.v1');
const readLocalPlaybackReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow-playback','workflow.cinematic-playback-write.v1');
const readLocalBackgroundReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow-background','workflow.background-source-write.v1');
const readLocalSourceReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow-source','workflow.cinematic-source-write.v1');
const readLocalBackgroundPixelReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow-background-pixel','workflow.background-pixel-write.v1');
const readLocalRemoveReady=()=>readWorkflowCapability('/v1/cinematics/ownership/workflow-sequence-remove','workflow.cinematic-sequence-remove.v1');
const readLocalPropRemoveReady=()=>readWorkflowCapability('/v1/props/ownership/workflow-animation-remove','workflow.prop-animation-remove.v1');
async function readLocalDeleteJson(path,limit=8192){
 // This capability is authoritative. Probe it independently of the burst of
 // unrelated capability reads during bootstrap and never infer readiness.
 return await new Promise(resolve=>{
  const req=loopbackGet({host:'127.0.0.1',port:8030,path,
    agent:false,signal:AbortSignal.timeout(2000)},res=>{
   if(res.statusCode!==200){res.resume();resolve(null);return;}
   let raw='';
   res.setEncoding('utf8');res.on('error',()=>resolve(null));
   res.on('data',data=>{raw+=data;if(raw.length>limit){res.destroy();resolve(null);}});
   res.on('end',()=>{
    try{
     resolve(JSON.parse(raw));
    }catch{resolve(null);}
   });
  });
  req.on('error',()=>resolve(null));
 });
}
async function readLocalFolderDeleteReady(path,root){
 const v=await readLocalDeleteJson(path);
 return v?.schemaVersion==='workflow.single-target-delete.v1'&&v.enabled===true&&
  Array.isArray(v.roots)&&v.roots.includes(root);
}
const readLocalCinematicDeleteReady=()=>readLocalFolderDeleteReady('/v1/storage/delete-target/cinematic',cinematicDeleteRoot);
const readLocalMapDeleteReady=()=>readLocalFolderDeleteReady('/v1/storage/delete-target/map',mapDeleteRoot);
const readLocalAssemblyDeleteReady=()=>readLocalFolderDeleteReady('/v1/storage/delete-target/assembly',assemblyDeleteRoot);
const readLocalCinematicDeleteInventory=source=>readLocalDeleteJson('/v1/storage/delete-target/cinematic-inventory?'+new URLSearchParams({sourceSha256:source}),256*1024);
const readLocalBackgroundDeleteReady=()=>readLocalFolderDeleteReady('/v1/storage/delete-target/background',backgroundDeleteRoot);
const readLocalPropFolderDeleteReady=()=>readLocalFolderDeleteReady('/v1/storage/delete-target',propsDeleteRoot);
const readLocalNpcFolderDeleteReady=()=>readLocalFolderDeleteReady('/v1/storage/delete-target/npc-standalone',npcDeleteRoot);
export function configuration(env=process.env,{platform=process.platform,entryPoint=process.argv[1]}={}){

 const port=Number(env.NGS_PROJECT_LISTEN_PORT??'5274');
 if(!Number.isInteger(port)||port<1||port>65535)throw failure('LOCAL_PROJECT_PORT_INVALID',503);
 const root=env.NGS_PROJECT_CATALOG_ROOT??join(homedir(),'Workspaces','NGS','data','project-catalog');
 if(!isAbsolute(root)||resolve(root)!==root)throw failure('LOCAL_PROJECT_ROOT_INVALID',503);
 return {port,root,requestQueueDb:env.NGS_REQUEST_QUEUE_DB,releaseCapabilities:released,
  readFileUpdateReady:isNativeMac(platform,entryPoint)?()=>readWorkflowCapability(fileUpdatePds,'workflow.file-update.v1'):undefined,
  readMapReady:isNativeMac(platform,entryPoint)?()=>readWorkflowCapability(mapPds,mapCapability):undefined,
  readAssemblyReady:isNativeMac(platform,entryPoint)?()=>readWorkflowCapability(assemblyPds,assemblyCapability):undefined,
  readPropActions:isNativeMac(platform,entryPoint)?createRSPropReadiness():undefined,
  ...(isNativeMac(platform,entryPoint)?{readCinematicReady:readLocalCinematicReady,readCinematicSequenceReady:readLocalSequenceReady,readCinematicUpscaleReady:readLocalUpscaleReady,readCinematicPlaybackReady:readLocalPlaybackReady,readCinematicSourceReady:readLocalSourceReady,readBackgroundReady:readLocalBackgroundReady,readBackgroundPixelReady:readLocalBackgroundPixelReady,readBackgroundAnimationReady:readLocalBackgroundAnimationReady,readCinematicRemoveReady:readLocalRemoveReady,readPropAnimationRemoveReady:readLocalPropRemoveReady,readPropFolderDeleteReady:readLocalPropFolderDeleteReady,readNpcFolderDeleteReady:readLocalNpcFolderDeleteReady,readBackgroundDeleteReady:readLocalBackgroundDeleteReady,readCinematicDeleteReady:readLocalCinematicDeleteReady,readMapDeleteReady:readLocalMapDeleteReady,readAssemblyDeleteReady:readLocalAssemblyDeleteReady,readCinematicDeleteInventory:readLocalCinematicDeleteInventory}:{}),
  audioWorkspaceEnabled:released.audioFullLengthEnabled,audioSeparationEnabled:released.audioSeparationEnabled,poseSelectionV2Enabled:released.poseSelectionV2Enabled,npcBasicPortraitEnabled:released.npcBasicPortraitEnabled,npcScopedPortraitEnabled:false,brandMarkPath:env.NGS_BRAND_MARK_PATH,localPuzzleMediaRoot:env.NGS_LOCAL_PUZZLE_MEDIA_ROOT??macPuzzleDefault(platform,entryPoint)};
}

export function createLocalProjectPageServer({root,requestQueueDb,requestQueue,objectReplica,closeReplica,readFileUpdateReady,readMapReady,readAssemblyReady,readCinematicReady,readCinematicSequenceReady,readCinematicUpscaleReady,readCinematicPlaybackReady,readCinematicSourceReady,readBackgroundReady,readBackgroundPixelReady,readBackgroundAnimationReady,readCinematicRemoveReady,readPropAnimationRemoveReady,readPropFolderDeleteReady,readNpcFolderDeleteReady,readBackgroundDeleteReady,readCinematicDeleteReady,readMapDeleteReady,readAssemblyDeleteReady,readCinematicDeleteInventory,releaseCapabilities,audioWorkspaceEnabled=false,audioSeparationEnabled=false,poseSelectionV2Enabled=false,npcBasicPortraitEnabled=false,npcScopedPortraitEnabled=false,propActions=[],readPropActions,brandMarkPath,localPuzzleMediaRoot,stageUiPng=stageLocalUiPng}){
 const projects=approvedProjectReads();
 const object=objectReplica?localObjectReplicaViews(objectReplica):null;
 if(!object)prepareFreshParent(root);
 const projectCatalog=object?.catalog??createLocalProjectFolders({root});
 const openProject=object?.openProject??(id=>openLocalWorkspaceProject(root,id));
 const readWorkspace=(pathname,query,authorize,mediaCache)=>dispatchWorkspaceRead({pathname,query,openProject,authorize,mediaCache});
 // Preserve the established browser paths, but only the separate receiver
 // may mutate content. Discovery, list, icon and workspace use local files.
 const catalog={...projectCatalog,
  discover:async()=>(await projectCatalog.list(()=>true)).map(project=>project.projectId),
  compare:async()=>({groups:[],unavailable:[]}),
  refresh:async()=>{throw failure('NGS_FILE_SYNC_PUSH_OWNED',409);},
 };
 const auth=createLoopbackAuth({loadReadProjects:()=>projects});
 const ownedQueue=requestQueueDb&&!requestQueue?openLocalRequestQueue(requestQueueDb):null;
 const queue=requestQueue??ownedQueue;
 const cinematicReads={[cinematicType]:readCinematicReady,[cinematicSequenceType]:readCinematicSequenceReady,[cinematicUpscaleType]:readCinematicUpscaleReady,[cinematicPlaybackUpdateType]:readCinematicPlaybackReady,[cinematicSourceGenerateType]:readCinematicSourceReady,[backgroundSourceType]:readBackgroundReady,[backgroundPixelType]:readBackgroundPixelReady,[backgroundAnimationType]:readBackgroundAnimationReady,[cinematicSequencesRemoveType]:readCinematicRemoveReady};
 const activeCinematic=async(type)=>{
  if(!queue)return false;
  const read=cinematicReads[type];
  if(type===cinematicUpscaleType)return releaseCapabilities?.cinematicUpscaleEnabled===true&&
   (typeof read!=='function'||await read()===true);
  return Boolean(releaseCapabilities||typeof read==='function'&&await read());
 };
 const activeAssembly=async()=>Boolean(queue&&(releaseCapabilities||typeof readAssemblyReady==='function'&&await readAssemblyReady()));
 const activeMap=async()=>Boolean(queue&&(releaseCapabilities||typeof readMapReady==='function'&&await readMapReady()));
 const activePropRemoval=async()=>Boolean(queue&&(releaseCapabilities||typeof readPropAnimationRemoveReady==='function'&&await readPropAnimationRemoveReady()));
 const propFolderDeleteReady=async()=>Boolean(queue&&(releaseCapabilities||typeof readPropFolderDeleteReady==='function'&&await readPropFolderDeleteReady()));
 const npcFolderDeleteReady=async()=>Boolean(queue&&(releaseCapabilities||typeof readNpcFolderDeleteReady==='function'&&await readNpcFolderDeleteReady()));
 const backgroundDeleteReady=async()=>Boolean(queue&&(releaseCapabilities||typeof readBackgroundDeleteReady==='function'&&await readBackgroundDeleteReady()));
 const assemblyDeleteReady=async()=>Boolean(queue&&(releaseCapabilities||typeof readAssemblyDeleteReady==='function'&&await readAssemblyDeleteReady()));
 const fileUpdateReady=async()=>Boolean(queue&&(releaseCapabilities||typeof readFileUpdateReady==='function'&&await readFileUpdateReady()));
 const mapDeleteReady=async()=>Boolean(queue&&(releaseCapabilities||typeof readMapDeleteReady==='function'&&await readMapDeleteReady()));
 const cinematicDeleteReady=async()=>Boolean(queue&&(releaseCapabilities||typeof readCinematicDeleteReady==='function'&&await readCinematicDeleteReady()));
 const activePropActions=async()=>{
  if(!queue)return [];
  if(releaseCapabilities)return releaseCapabilities.propActions;
  const actions=typeof readPropActions==='function'?await readPropActions():propActions;
  return validPropActions(actions)?actions:[];
 };
 const deleteReadyByAction={assemblyDeleteEnabled:assemblyDeleteReady,mapDeleteEnabled:mapDeleteReady,cinematicDeleteEnabled:cinematicDeleteReady,
  backgroundDeleteEnabled:backgroundDeleteReady,npcFolderDeleteEnabled:npcFolderDeleteReady,propFolderDeleteEnabled:propFolderDeleteReady};
 const sourceAssets=new Map([...assets].map(([url,[type,path]])=>[url,{type,body:readFileSync(path)}]));
 sourceAssets.set('/assets/vinus-mark.png',{type:'image/png',body:brandMark(brandMarkPath)});
 const puzzle=openPuzzleBundle(localPuzzleMediaRoot);
 const flags=[
  ...(audioWorkspaceEnabled===true?['data-audio-workspace="enabled"']:[]),
  ...(puzzle?['data-puzzle-workspace="enabled"']:[]),
  'data-well-puzzle-demo="enabled"',
 ];
 {
  const page=sourceAssets.get('/');
  sourceAssets.set('/',{...page,body:Buffer.from(withPuzzleCore(page.body.toString('utf8').replace('<html lang="ko">',`<html lang="ko"${flags.length?' '+flags.join(' '):''}>`)))});
 }
 const puzzleAssets=puzzle?new Map([...puzzleCode].map(([name,[type,file]])=>
  [name,{type,body:readFileSync(new URL('./'+file,import.meta.url))}])):null;
 const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; img-src 'self' blob:");
  const json=(status,body)=>{
   res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));
  };
  try{
   const port=server.address()?.port,origin='http://127.0.0.1:'+port;
   assertLoopbackRequest(req,port,req.method==='POST');
   if(!req.url?.startsWith('/'))throw failure('NOT_FOUND',404);
   const url=new URL(req.url,origin);
   if(url.origin!==origin)throw failure('NOT_FOUND',404);
   if(url.pathname==='/')res.setHeader('Content-Security-Policy',
    `default-src 'self'; ${puzzleCoreCsp} object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; img-src 'self' blob:`);
   if(url.pathname.startsWith('/puzzle-core/')){
    if(req.url!==url.pathname||!['GET','HEAD'].includes(req.method))throw failure('NOT_FOUND',404);
    if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))throw failure('LOCAL_IPV4_LOOPBACK_ORIGIN_REQUIRED',403);
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    projectPermission(session.principal,'binari',undefined,false);
    const member=await servePuzzleCore(url.pathname,req.method);
    if(!member)throw failure('NOT_FOUND',404);
    for(const [key,value] of member.headers)res.setHeader(key,value);
    return res.end(req.method==='HEAD'?undefined:Buffer.from(await member.arrayBuffer()));
   }
   if(url.pathname.startsWith(puzzlePrefix)){
    if(!puzzleAssets||req.url!==url.pathname)throw failure('NOT_FOUND',404);
    if(req.method!=='GET'&&req.method!=='HEAD')throw failure('METHOD_NOT_ALLOWED',405);
    if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))
     throw failure('LOCAL_IPV4_LOOPBACK_ORIGIN_REQUIRED',403);
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    projectPermission(session.principal,'binari',undefined,false);
    const member=url.pathname.slice(puzzlePrefix.length);
    if(member.startsWith('assets/'))return await puzzle.respond(member.slice(7),req,res);
    const code=puzzleAssets.get(member);
    if(!code)throw failure('NOT_FOUND',404);
    if(member===''){
     // Only this same-origin child can be framed by the in-app puzzle page.
     res.setHeader('X-Frame-Options','SAMEORIGIN');
     res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'none'; form-action 'none'");
    }
    res.setHeader('Content-Type',code.type);
    res.setHeader('Content-Length',String(code.body.length));
    return res.end(req.method==='HEAD'?undefined:code.body);
   }
   if(url.pathname==='/api/cinematic-delete-inventory'){
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED',405);
    const q=url.searchParams,source=q.get('sourceSha256');
    if([...q.keys()].join(',')!=='projectId,sourceSha256'||q.get('projectId')!=='binari'||
       !/^[a-f0-9]{64}$/u.test(source??''))throw failure('NGS_CINEMATIC_DELETE_INVENTORY_INVALID',400);
    projectPermission(session.principal,'binari',undefined,false);
    if(!await cinematicDeleteReady()||typeof readCinematicDeleteInventory!=='function')
     throw failure('CINEMATIC_DELETE_UNAVAILABLE',404);
    const value=await readCinematicDeleteInventory(source);
    try{cinematicDeletePayloads(source,value);}catch{throw failure('CINEMATIC_DELETE_INVENTORY_UNAVAILABLE',409);}
    if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    return json(200,value);
   }
   if(url.pathname===uiStagePath){
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    if(req.method!=='POST'||url.search)throw failure('METHOD_NOT_ALLOWED',405);
    if(!queue)throw failure('NGS_REQUEST_QUEUE_UNAVAILABLE',503);
    auth.csrf(req,session);
    if(req.headers['x-npcgen-frontend-context']!==session.contextId)throw failure('FRONTEND_SESSION_CONTEXT_CHANGED',409);
    projectPermission(session.principal,'binari',undefined,false);
    if(req.headers['content-type']!=='image/png')throw failure('NGS_UI_PNG_REQUIRED',415);
    if(Number(req.headers['content-length'])>uiMaxPng)throw failure('PAYLOAD_TOO_LARGE',413);
    const bytes=await readSmallBody(req,uiMaxPng);
    if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    return json(200,await stageUiPng(bytes));
   }
   if(url.pathname==='/api/requests'){
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    if(req.method==='GET'){
     if(url.search)throw failure('NGS_QUEUE_QUERY_INVALID',400);
     if(!queue)throw failure('NGS_REQUEST_QUEUE_UNAVAILABLE',503);
     const allowed=new Set(session.principal.projects.map(project=>project.id));
     return json(200,{requests:queue.pendingSummary().filter(item=>allowed.has(item.projectId))});
    }
    if(req.method!=='POST'||url.search)throw failure('METHOD_NOT_ALLOWED',405);
    auth.csrf(req,session);
    if(req.headers['x-npcgen-frontend-context']!==session.contextId)throw failure('FRONTEND_SESSION_CONTEXT_CHANGED',409);
    if(!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type']??''))throw failure('JSON_REQUIRED',415);
    const command=parseRequestSubmission(await readSmallBody(req,64*1024));
    if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    projectPermission(session.principal,command.payload.projectId,undefined,false);
    if(releaseCapabilities&&!queue)throw failure('NGS_REQUEST_QUEUE_UNAVAILABLE',503);
    if(Object.hasOwn(uiSchemas,command.requestType)&&!validUiRequest(command.requestType,command.payload))throw failure('NGS_UI_PAYLOAD_INVALID',400);
    if(Object.hasOwn(cinematicReads,command.requestType)){
     if(!await activeCinematic(command.requestType))throw failure('CINEMATIC_GENERATION_UNAVAILABLE',404);
     await admitCinematicRequest({openProject,command,authorize:id=>projectPermission(session.principal,id,undefined,false)});
     if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    }
    if(assemblyTypes.includes(command.requestType)||mapTypes.includes(command.requestType)||command.requestType===fileUpdateType){
     const family=assemblyTypes.includes(command.requestType)?[activeAssembly,'ASSEMBLY_WORKFLOW_UNAVAILABLE']:
      mapTypes.includes(command.requestType)?[activeMap,'MAP_WORKFLOW_UNAVAILABLE']:[fileUpdateReady,'FILE_UPDATE_WORKFLOW_UNAVAILABLE'];
     if(!await family[0]())throw failure(family[1],404);
     await admitWorkspaceMapAssembly({command,puzzleProofReady:true,read:async(path,query)=>
      (path===assemblyPath?await assemblyWorkspaceRead({query,openProject,authorize:()=>{}}):await readWorkspace(path,query,()=>{})).json});
     if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    }
    if(command.requestType===fileDeleteType){
     const family=workspaceDeleteFamily(command.payload);
     if(!family)throw failure('NGS_FILE_DELETE_PAYLOAD_INVALID',400);
     if(!await deleteReadyByAction[family.action]())throw failure(family.unavailable,404);
     if(!family.valid(command.payload))throw failure(family.invalid,400);
     // No replica preflight: the common delete worker/authority checks the
     // exact pinned target against the original immediately before mutation.
     if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    }
    if(command.requestType==='prop.animation.remove'){
     if(!await activePropRemoval())throw failure('PROP_WORKSPACE_ACTION_UNAVAILABLE',404);
     await admitPropAnimationRemove({openProject,command,authorize:id=>projectPermission(session.principal,id,undefined,false)});
     if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    }else if(command.requestType.startsWith('prop.')){
     if(!propAction(command.requestType))throw failure('PROP_WORKSPACE_ACTION_UNAVAILABLE',404);
     await admitPropRequest({openProject,command,actions:await activePropActions(),authorize:id=>projectPermission(session.principal,id,undefined,false)});
     if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    }
    if(command.requestType==='audio.generate'){
     if(audioWorkspaceEnabled!==true)throw failure('AUDIO_WORKSPACE_UNAVAILABLE',404);
     if(!validLocalAudioPayload(command.payload))throw failure('NGS_AUDIO_GENERATE_PAYLOAD_INVALID',400);
    }
    if(command.requestType===audioSeparationType){
     if(audioWorkspaceEnabled!==true||audioSeparationEnabled!==true)throw failure('AUDIO_SEPARATION_UNAVAILABLE',404);
     if(!validAudioSeparationPayload(command.payload))throw failure('NGS_AUDIO_SEPARATE_PAYLOAD_INVALID',400);
     const found=object?await object.audioSeparationSource(command.payload):localAudioSeparationSource(root,command.payload);
     if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
     if(!found)throw failure('AUDIO_SEPARATION_SOURCE_NOT_FOUND',404);
    }
    if(command.requestType==='audio.delete'){
     if(audioWorkspaceEnabled!==true)throw failure('AUDIO_WORKSPACE_UNAVAILABLE',404);
     const target=command.payload;
     if(Object.keys(target).sort().join(',')!=='officialRequestId,projectId,schemaVersion'||
        target.schemaVersion!=='ngs.audio-delete.v1'||target.projectId!=='binari'||
        typeof target.officialRequestId!=='string'||!/^request\.official\.[a-f0-9]{64}$/u.test(target.officialRequestId))
      throw failure('NGS_AUDIO_DELETE_PAYLOAD_INVALID',400);
    }
    if(command.requestType===motionPresetConvertType&&!validMotionPresetConvert(command.payload))
     throw failure('NGS_MOTION_PRESET_CONVERT_2D_PAYLOAD_INVALID',400);
    if(command.requestType===conceptCategoryRequestType&&!validConceptCategoryRequest(command.payload))
     throw failure('CONCEPT_CATEGORY_REQUEST_INVALID',400);
    if(command.requestType===npcPlanningAddType&&!validNpcPlanningAdd(command.payload))
     throw failure('NGS_NPC_PLANNING_ADD_PAYLOAD_INVALID',400);
    if(command.requestType===npcPlanningRequestType&&!validNpcPlanningUpdate(command.payload))
     throw failure('NGS_NPC_PLANNING_UPDATE_PAYLOAD_INVALID',400);
    if((command.requestType==='npc.workflow'||command.requestType===animationRegenerateType)&&
       isPoseSelectionV2(command.payload.schemaVersion)&&poseSelectionV2Enabled!==true)
     throw failure('NPC_POSE_SELECTION_V2_UNAVAILABLE',404);
    if(command.requestType===animationRegenerateType&&!validNpcAnimationRegenerate(command.payload))
     throw failure('NGS_NPC_ANIMATION_REGENERATE_PAYLOAD_INVALID',400);
    if(command.requestType===portraitRegenerateType){
     if(!npcScopedPortraitEnabled)throw failure('NPC_PORTRAIT_EDIT_UNAVAILABLE',404);
     if(!validNpcPortraitRegeneration(command.payload))throw failure('NGS_NPC_PORTRAIT_REGENERATE_PAYLOAD_INVALID',400);
     const {projectId,npcId}=command.payload;
     const {json:{npcs}}=await readWorkspace('/api/npc-workspace',new URLSearchParams({projectId}),()=>{});
     if(!npcs?.some(npc=>npc.id===npcId))throw failure('NPC_PORTRAIT_EDIT_TARGET_NOT_FOUND',404);
    }
    if(command.requestType==='npc.workflow'){
     if(command.payload.schemaVersion===npcBasicSchema&&!npcBasicPortraitEnabled)
      throw failure('NPC_BASIC_PORTRAIT_UNAVAILABLE',404);
     if(!validNpcWorkflowRequest(command.payload))throw failure('NGS_ONE_STOP_PAYLOAD_INVALID',400);
    }
    if(!queue)throw failure('NGS_REQUEST_QUEUE_UNAVAILABLE',503);
    return json(202,queue.enqueue(command));
   }
   const asset=sourceAssets.get(url.pathname);
   if(asset&&req.method==='GET'){
    res.setHeader('Content-Type',asset.type);
    return res.end(asset.body);
   }
   if(url.pathname==='/__npcgen_session'&&req.method==='GET'&&!url.search){
    const session=auth.bootstrap(req);
    if(session.setCookie)res.setHeader('Set-Cookie',
     'npcgen_local_session='+session.sid+'; HttpOnly; SameSite=Strict; Path=/; Max-Age=900');
    if(releaseCapabilities)return json(200,{state:'authenticated',contextId:session.contextId,csrfToken:session.csrfToken,
     ...releaseCapabilities,cinematicUpscaleEnabled:await activeCinematic(cinematicUpscaleType),puzzleCoreVersion,...(readCinematicDeleteInventory?{cinematicLegacyInventoryEnabled:true}:{})});
    const deleteProp=await propFolderDeleteReady(),deleteNpc=await npcFolderDeleteReady(),deleteBackground=await backgroundDeleteReady(),deleteCinematic=await cinematicDeleteReady();
    const [mapReady,deleteMap,assemblyReady,deleteAssembly,updateReady]=await Promise.all([activeMap(),mapDeleteReady(),activeAssembly(),assemblyDeleteReady(),fileUpdateReady()]);
    const [pixelBackground,animateBackground,upscaleCine]=await Promise.all([activeCinematic(backgroundPixelType),activeCinematic(backgroundAnimationType),activeCinematic(cinematicUpscaleType)]);
    const [actions,legacyCine,sequenceCine,playbackCine,sourceCine,backgroundReady,removeCine,removeProp]=await Promise.all([activePropActions(),activeCinematic(cinematicType),activeCinematic(cinematicSequenceType),activeCinematic(cinematicPlaybackUpdateType),activeCinematic(cinematicSourceGenerateType),activeCinematic(backgroundSourceType),activeCinematic(cinematicSequencesRemoveType),activePropRemoval()]);
    return json(200,{state:'authenticated',contextId:session.contextId,csrfToken:session.csrfToken,
     ...(actions.length?{propActions:actions}:{}),...(mapReady?{mapEnabled:true}:{}),...(updateReady?{fileUpdateEnabled:true}:{}),...(assemblyReady?{assemblyEnabled:true}:{}),...(deleteMap?{mapDeleteEnabled:true}:{}),...(deleteAssembly?{assemblyDeleteEnabled:true}:{}),
     ...(legacyCine?{cinematicEnabled:true}:{}),
     ...(sequenceCine?{cinematicSequenceEnabled:true}:{}),...(upscaleCine?{cinematicUpscaleEnabled:true}:{}),...(playbackCine?{cinematicPlaybackEnabled:true}:{}),
     ...(sourceCine?{cinematicSourceEnabled:true}:{}),...(backgroundReady?{backgroundSourceEnabled:true}:{}),...(pixelBackground?{backgroundPixelEnabled:true}:{}),...(animateBackground?{backgroundAnimationEnabled:true}:{}),...(removeCine?{cinematicRemoveEnabled:true}:{}),...(removeProp?{propAnimationRemoveEnabled:true}:{}),...(deleteProp?{propFolderDeleteEnabled:true}:{}),...(deleteNpc?{npcFolderDeleteEnabled:true}:{}),...(deleteBackground?{backgroundDeleteEnabled:true}:{}),...(deleteCinematic?{cinematicDeleteEnabled:true,cinematicLegacyInventoryEnabled:true}:{}),
     ...(poseSelectionV2Enabled===true?{poseSelectionV2Enabled:true}:{}),
     ...(queue&&npcBasicPortraitEnabled===true?{npcBasicPortraitEnabled:true}:{}),
     ...(queue&&npcScopedPortraitEnabled===true?{npcScopedPortraitEnabled:true}:{}),
     ...(queue&&audioWorkspaceEnabled===true?{audioFullLengthEnabled:true}:{}),
     ...(queue&&audioWorkspaceEnabled===true&&audioSeparationEnabled===true?{audioSeparationEnabled:true}:{})});
   }
   if(url.pathname===replicaSyncProgressPath){
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    return json(200,await readReplicaSyncProgress({
     method:req.method,query:url.searchParams,read:objectReplica?.progress,
     authorize:id=>{projectPermission(session.principal,id,undefined,false);return true;},
    }));
   }
   if(url.pathname==='/api/audio-workspace'){
    if(audioWorkspaceEnabled!==true)throw failure('AUDIO_WORKSPACE_UNAVAILABLE',404);
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED',405);
    const args={root,query:url.searchParams,range:req.headers.range,
     authorize:projectId=>projectPermission(session.principal,projectId,undefined,false)};
    const result=object?await object.audio(args):localAudioResults(args);
    if(object&&auth.read(req)?.contextId!==session.contextId){
     result.response?.body?.cancel().catch(()=>{});
     throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    }
    res.setHeader('X-NPCGen-Frontend-Context',session.contextId);
    if(result.json)return json(200,result.json);
    if(result.response){
     for(const key of ['Accept-Ranges','Content-Type','Content-Length','Content-Range','Content-Security-Policy']){
      const value=result.response.headers.get(key);
      if(value!==null)res.setHeader(key,value);
     }
     res.statusCode=result.response.status;
     if(!result.response.body)return res.end();
     await pipeline(Readable.fromWeb(result.response.body),res);
     return;
    }
    const size=result.bytes.length,range=audioResponseRange(req.headers.range,size);
    res.setHeader('Accept-Ranges','bytes');
    if(!range){
     res.statusCode=416;res.setHeader('Content-Range','bytes */'+size);return res.end();
    }
    const {start,end}=range;
    if(req.headers.range!==undefined){
     res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Content-Type',result.mime);
    res.setHeader('Content-Length',String(end-start+1));
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
    return res.end(result.bytes.subarray(start,end+1));
   }
   if(url.pathname===assemblyPath){
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED',405);
    const result=await assemblyWorkspaceRead({query:url.searchParams,openProject,authorize:id=>projectPermission(session.principal,id,undefined,false)});
    if(auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    return json(200,result.json);
   }
   if(workspaceReadRoute(url.pathname)){
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED',405);
    const result=await readWorkspace(url.pathname,url.searchParams,
     projectId=>projectPermission(session.principal,projectId,undefined,false),
     req.headers.range===undefined&&req.headers['if-range']===undefined);
    if(object&&auth.read(req)?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
    res.setHeader('X-NPCGen-Frontend-Context',session.contextId);
    if(result.json)return json(200,result.json);
    if(url.pathname===cinematicPath&&result.mime==='video/mp4'){
     const clip=cinematicVideoResponse(result.bytes,req.headers.range);
     res.statusCode=clip.status;
     for(const [k,v] of Object.entries(clip.headers))res.setHeader(k,v);
     res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
     return res.end(clip.bytes);
    }
    res.setHeader('Content-Type',result.mime);
    res.setHeader('Content-Length',String(result.bytes.length));
    res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");
    return res.end(result.bytes);
   }
   const inner=['/api/folders/compare','/api/folders/refresh'].includes(url.pathname);
   if(projectFolderRoutes.has(url.pathname)||inner){
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    let bytes;
    if(req.method==='POST'){
     if(!/^[a-f0-9]{64}$/.test(req.headers['x-npcgen-csrf']??''))throw failure('CSRF_INVALID',403);
     const bound=url.pathname.endsWith('/compare')?64*1024:1024;
     const length=Number(req.headers['content-length']);
     if(Number.isFinite(length)&&length>bound)throw failure('PAYLOAD_TOO_LARGE',413);
     bytes=await readSmallBody(req,bound);
    }
    if(inner){
     if(req.method!=='POST')throw failure('METHOD_NOT_ALLOWED',405);
     if(url.search)throw failure('FOLDER_SCOPE_QUERY_INVALID',400);
     auth.csrf(req,session);
     if(req.headers['x-npcgen-frontend-context']!==session.contextId)throw failure('FRONTEND_SESSION_CONTEXT_CHANGED',409);
     let input;
     try{input=JSON.parse(bytes.toString());}catch{throw failure('FOLDER_SCOPE_INVALID',400);}
     const compare=url.pathname.endsWith('/compare'),keys=compare?'scope':'folder,scope';
     if(!input||Object.keys(input).sort().join(',')!==keys||!validFolderPath(input.scope)
        ||!compare&&(typeof input.folder!=='string'||input.folder!==''&&(!validFolderPath(input.folder)||input.folder.includes('/')))){
      throw failure('FOLDER_SCOPE_INVALID',400);
     }
     const projectId=input.scope.split('/')[0];
     projectPermission(session.principal,projectId,undefined,false);
     if(!compare)throw failure('NGS_FILE_SYNC_PUSH_OWNED',409);
     const result={scope:input.scope,groups:[],unavailable:[]};
     const latest=auth.read(req);
     if(latest?.contextId!==session.contextId)throw failure('LOCAL_SESSION_EXPIRED_OR_REVOKED',401);
     projectPermission(latest.principal,projectId,undefined,false);
     res.setHeader('X-NPCGen-Frontend-Context',session.contextId);
     return json(200,result);
    }
    return await localProjectFolderRoute(req,res,{origin,catalog,session,auth,projectPermission,bytes});
   }
   throw failure('NOT_FOUND',404);
  }catch(error){
   if(!res.writableEnded&&!res.headersSent)json(error.status??(error.message==='FOLDER_SYNC_COMPARE_REQUIRED'?409:503),{error:/^[A-Z0-9_]+$/.test(error.message)?error.message:'LOCAL_PROJECT_PAGE_UNAVAILABLE'});
  }
 });
 server.once('close',()=>{auth.close();ownedQueue?.close();closeReplica?.();});
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const config=configuration();
  const service=await openLocalObjectReplicaFromEnv();
  const server=createLocalProjectPageServer({...config,objectReplica:service?.replica,closeReplica:service?.close});
  server.on('error',()=>{console.error('LOCAL_PROJECT_PAGE_LISTEN_FAILED');process.exitCode=1;});
  server.listen(config.port,'127.0.0.1',()=>{
   console.log('LOCAL_PROJECT_PAGE_READY http://127.0.0.1:'+config.port);
  });
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>server.close());
 }catch{
  console.error('LOCAL_PROJECT_PAGE_START_FAILED');
  process.exitCode=1;
 }
}
