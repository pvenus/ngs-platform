/** NGS browser app: serve the local replica and enqueue validated requests. */
import {readFileSync,lstatSync,mkdirSync,realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {projectPermission} from './auth-core.mjs';
import {assertLoopbackRequest,createLoopbackAuth} from './loopback-auth.mjs';
import {createLocalProjectFolders,validProjectId} from './local-project-folders.mjs';
import {localProjectFolderRoute,projectFolderRoutes} from './local-project-folder-route.mjs';
import {validFolderPath} from './local-recursive-folders.mjs';
import {localProjectWorkspace,openLocalWorkspaceProject} from './local-project-workspace.mjs';
import {localNpcWorkspace} from './local-npc-workspace.mjs';
import {dispatchWorkspaceRead,workspaceReadRoute} from './workspace-read-registry.mjs';
import {parseRequestSubmission} from './local-request-submission.mjs';
import {openLocalRequestQueue} from './local-request-queue.mjs';
import {conceptCategoryRequestType,validConceptCategoryRequest} from './local-concept-category-contract.mjs';
import {npcPlanningAddType,npcPlanningRequestType,validNpcPlanningAdd,validNpcPlanningUpdate} from './local-npc-planning-ui.mjs';
import {audioResponseRange,localAudioResults} from './local-audio-results.mjs';
import {validLocalAudioPayload} from './local-audio-workspace.mjs';

const canonicalPolicy=new URL('../../../dev/catalog-read-policy.json',import.meta.url);
const assets=new Map([
 ['/', ['text/html; charset=utf-8', new URL('./local-project-page.html',import.meta.url)]],
 ['/local-project-page.css', ['text/css; charset=utf-8', new URL('./local-project-page.css',import.meta.url)]],
 ['/local-project-page.js', ['text/javascript; charset=utf-8', new URL('./local-project-page.js',import.meta.url)]],
 ['/local-npc-workspace-ui.mjs', ['text/javascript; charset=utf-8', new URL('./local-npc-workspace-ui.mjs',import.meta.url)]],
 ['/local-npc-one-stop-ui.mjs', ['text/javascript; charset=utf-8', new URL('./local-npc-one-stop-ui.mjs',import.meta.url)]],
 ['/local-concept-category-ui.mjs', ['text/javascript; charset=utf-8', new URL('./local-concept-category-ui.mjs',import.meta.url)]],
 ['/local-concept-category-contract.mjs', ['text/javascript; charset=utf-8', new URL('./local-concept-category-contract.mjs',import.meta.url)]],
 ['/local-npc-planning-ui.mjs', ['text/javascript; charset=utf-8', new URL('./local-npc-planning-ui.mjs',import.meta.url)]],
 ['/local-audio-workspace.mjs', ['text/javascript; charset=utf-8', new URL('./local-audio-workspace.mjs',import.meta.url)]],
 ['/local-request-queue-browser.mjs', ['text/javascript; charset=utf-8', new URL('./local-request-queue-browser.mjs',import.meta.url)]],
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

export function configuration(env=process.env){
 const port=Number(env.NGS_PROJECT_LISTEN_PORT??'5274');
 if(!Number.isInteger(port)||port<1||port>65535)throw failure('LOCAL_PROJECT_PORT_INVALID',503);
 const root=env.NGS_PROJECT_CATALOG_ROOT??join(homedir(),'Workspaces','NGS','data','project-catalog');
 if(!isAbsolute(root)||resolve(root)!==root)throw failure('LOCAL_PROJECT_ROOT_INVALID',503);
 return {port,root,requestQueueDb:env.NGS_REQUEST_QUEUE_DB,
  audioWorkspaceEnabled:env.NGS_AUDIO_WORKSPACE_ENABLED==='1',brandMarkPath:env.NGS_BRAND_MARK_PATH};
}

export function createLocalProjectPageServer({root,requestQueueDb,requestQueue,audioWorkspaceEnabled=false,brandMarkPath}){
 const projects=approvedProjectReads();
 prepareFreshParent(root);
 const projectCatalog=createLocalProjectFolders({root});
 // Preserve the established browser paths, but only the separate receiver
 // may mutate content. Discovery, list, icon and workspace use local files.
 const catalog={...projectCatalog,
  discover:async()=>projectCatalog.list(()=>true).map(project=>project.projectId),
  compare:async()=>({groups:[],unavailable:[]}),
  refresh:async()=>{throw failure('NGS_FILE_SYNC_PUSH_OWNED',409);},
 };
 const auth=createLoopbackAuth({loadReadProjects:()=>projects});
 const ownedQueue=requestQueueDb&&!requestQueue?openLocalRequestQueue(requestQueueDb):null;
 const queue=requestQueue??ownedQueue;
 async function allowedCombat(preset){
  if(preset==='walk'||preset==='run')return false;
  const query=new URLSearchParams({projectId:'binari',tab:'motion-presets',item:preset});
  const {json:items}=await localProjectWorkspace({root,query,authorize:()=>{}});
  const motion=items?.motionPreset;
  return motion?.posePreset==='combat'&&motion.directions.filter(row=>row.path).length===8&&
   new Set(motion.directions.map(row=>row.direction)).size===8;
 }
 const sourceAssets=new Map([...assets].map(([url,[type,path]])=>[url,{type,body:readFileSync(path)}]));
 sourceAssets.set('/assets/vinus-mark.png',{type:'image/png',body:brandMark(brandMarkPath)});
 if(audioWorkspaceEnabled===true){
  const page=sourceAssets.get('/');
  sourceAssets.set('/',{...page,body:Buffer.from(page.body.toString('utf8').replace('<html lang="ko">','<html lang="ko" data-audio-workspace="enabled">'))});
 }
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
    if(command.requestType==='audio.generate'){
     if(audioWorkspaceEnabled!==true)throw failure('AUDIO_WORKSPACE_UNAVAILABLE',404);
     if(!validLocalAudioPayload(command.payload))throw failure('NGS_AUDIO_GENERATE_PAYLOAD_INVALID',400);
    }
    if(command.requestType==='audio.delete'){
     if(audioWorkspaceEnabled!==true)throw failure('AUDIO_WORKSPACE_UNAVAILABLE',404);
     const target=command.payload;
     if(Object.keys(target).sort().join(',')!=='officialRequestId,projectId,schemaVersion'||
        target.schemaVersion!=='ngs.audio-delete.v1'||target.projectId!=='binari'||
        typeof target.officialRequestId!=='string'||!/^request\.official\.[a-f0-9]{64}$/u.test(target.officialRequestId))
      throw failure('NGS_AUDIO_DELETE_PAYLOAD_INVALID',400);
    }
    if(command.requestType===conceptCategoryRequestType&&!validConceptCategoryRequest(command.payload))
     throw failure('CONCEPT_CATEGORY_REQUEST_INVALID',400);
    if(command.requestType===npcPlanningAddType&&!validNpcPlanningAdd(command.payload))
     throw failure('NGS_NPC_PLANNING_ADD_PAYLOAD_INVALID',400);
    if(command.requestType===npcPlanningRequestType&&!validNpcPlanningUpdate(command.payload))
     throw failure('NGS_NPC_PLANNING_UPDATE_PAYLOAD_INVALID',400);
    if(command.requestType==='npc.workflow'){
     const {character,includeCombat,combatMotionPresets}=command.payload;
     if(includeCombat===true&&(!Array.isArray(combatMotionPresets)||combatMotionPresets.length<1||combatMotionPresets.length>16||
       !((await Promise.all(combatMotionPresets.map(preset=>allowedCombat(preset).catch(()=>false)))).every(Boolean)))){
      throw failure('ONE_STOP_COMBAT_PRESETS_REQUIRED',400);
     }
     const replace=command.payload.schemaVersion==='ngs.npc-one-stop.replace.v1';
     if(replace||typeof character?.npcId==='string'){
      const roster=(await localNpcWorkspace({root,query:new URLSearchParams({projectId:command.payload.projectId}),authorize:()=>{}})).json.npcs;
      if(replace){
       const target=roster.find(npc=>npc.id===character?.npcId);
       if(!target)throw failure('ONE_STOP_REPLACE_TARGET_NOT_FOUND',404);
       const targetSlug=target.id.replace(/^(?:npc|character)\./,'').toLowerCase();
       if(character.slug!==targetSlug)throw failure('ONE_STOP_REPLACE_IDENTITY_INVALID',400);
      }else if(roster.some(npc=>npc.id===character.npcId||npc.id==='character.'+character.slug)){
       throw failure('ONE_STOP_TARGET_ALREADY_ACTIVE',409);
      }
     }
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
    return json(200,{state:'authenticated',contextId:session.contextId,csrfToken:session.csrfToken});
   }
   if(url.pathname==='/api/audio-workspace'){
    if(audioWorkspaceEnabled!==true)throw failure('AUDIO_WORKSPACE_UNAVAILABLE',404);
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED',405);
    const result=localAudioResults({root,query:url.searchParams,
     authorize:projectId=>projectPermission(session.principal,projectId,undefined,false)});
    res.setHeader('X-NPCGen-Frontend-Context',session.contextId);
    if(result.json)return json(200,result.json);
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
   if(workspaceReadRoute(url.pathname)){
    const session=auth.read(req);
    if(!session)throw failure('LOCAL_SIGN_IN_REQUIRED',401);
    if(req.method!=='GET')throw failure('METHOD_NOT_ALLOWED',405);
    const result=await dispatchWorkspaceRead({pathname:url.pathname,query:url.searchParams,
     openProject:id=>openLocalWorkspaceProject(root,id),
     authorize:projectId=>projectPermission(session.principal,projectId,undefined,false)});
    res.setHeader('X-NPCGen-Frontend-Context',session.contextId);
    if(result.json)return json(200,result.json);
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
   if(!res.writableEnded)json(error.status??(error.message==='FOLDER_SYNC_COMPARE_REQUIRED'?409:503),{error:/^[A-Z0-9_]+$/.test(error.message)?error.message:'LOCAL_PROJECT_PAGE_UNAVAILABLE'});
  }
 });
 server.once('close',()=>{auth.close();ownedQueue?.close();});
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const config=configuration(),server=createLocalProjectPageServer(config);
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
