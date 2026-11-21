/** Push canonical file changes via MCP only, without exposing a Filex path. */
import {startOpsHealthReport} from './local-ops-health-report.mjs';
import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {createFolderMcpClient} from './folder-mcp-client.mjs';
import {DEFAULT_PROJECT_FOLDER_MCP_URL,loopbackJsonMCP} from './folder-mcp-loopback.mjs';
import {validFolderPath} from './local-recursive-folders.mjs';
import {createSpaceMachineMcp,spaceMachineConfiguration,fileTools} from './space-machine-mcp.mjs';

const maxChunk=1024*1024,maxEntries=32768;
const definiteChunkFailures=new Set([
 'NGS_FILE_SYNC_INVALID','NGS_FILE_SYNC_CONTENT_MISMATCH','NGS_FILE_SYNC_REPLICA_CHANGED',
 'NGS_FILE_SYNC_OFFSET_INVALID','NGS_FILE_SYNC_INCOMPLETE',
]);
const direct=run=>run();
const hash=/^[a-f0-9]{64}$/;
const id=/^ngs\.sync\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const project=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const invalid=()=>Error('PDS_NGS_FILE_SYNC_INVALID');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
const pathWithin=(scope,path)=>validFolderPath(path)&&validFolderPath(scope+'/'+path);
const digestOk=value=>typeof value==='string'&&hash.test(value);

function inventory(value,scope){
 if(!exact(value,'files,inventoryAt,scope,syncId')||!id.test(value.syncId??'')||value.scope!==scope||
  !Number.isSafeInteger(value.inventoryAt)||value.inventoryAt<0||!Array.isArray(value.files)||value.files.length>maxEntries)throw invalid();
 const found=new Map();
 for(const row of value.files){
  if(!exact(row,'path,sha256')||!pathWithin(scope,row.path)||!digestOk(row.sha256)||found.has(row.path))throw invalid();
  found.set(row.path,row.sha256);
 }
 return found;
}

function changes(value,scope,previous){
 if(!exact(value,'deleted,groups,scope')||value.scope!==scope||
  !Array.isArray(value.groups)||!Array.isArray(value.deleted))throw invalid();
 const files=[],found=new Set(),folders=new Set();
 for(const group of value.groups){
  if(!exact(group,'files,folder')||typeof group.folder!=='string'||
   group.folder!==''&&(!validFolderPath(group.folder)||group.folder.includes('/'))||folders.has(group.folder)||
   !Array.isArray(group.files)||group.files.length===0)throw invalid();
  folders.add(group.folder);
  for(const row of group.files){
   if(!exact(row,'path,sha256,size')||!pathWithin(scope,row.path)||!digestOk(row.sha256)||
    !Number.isSafeInteger(row.size)||row.size<0||found.has(row.path)||
    (row.path.includes('/')?row.path.split('/')[0]:'')!==group.folder||
    previous.get(row.path)===row.sha256||files.length>=maxEntries)throw invalid();
   found.add(row.path);files.push(row);
  }
 }
 const deleted=[];
 for(const row of value.deleted){
  if(!exact(row,'path,sha256')||!pathWithin(scope,row.path)||!digestOk(row.sha256)||found.has(row.path)||
   previous.get(row.path)!==row.sha256||files.length+deleted.length>=maxEntries)throw invalid();
  found.add(row.path);deleted.push(row);
 }
 return {files,deleted};
}

async function pushFile({pds,ngs,scope,syncId,row,signal,unknownFinal=()=>{}}){
 const reader=pds.file(scope,row.path,row.sha256,row.size).body.getReader();
 const hash=createHash('sha256');let offset=0;
 const send=async bytes=>{
  signal?.throwIfAborted();
  const end=offset+bytes.byteLength;
  try{
   const reply=await ngs('ngs_file_sync_file_chunk',{syncId,...row,offset,dataBase64:Buffer.from(bytes).toString('base64')});
   if(!exact(reply,'nextOffset')||reply.nextOffset!==(end===row.size?null:end))throw invalid();
  }catch(error){
   if(end===row.size&&!definiteChunkFailures.has(error?.message))unknownFinal();
   throw error;
  }
  offset=end;
 };
 try{
  for(;;){
   signal?.throwIfAborted();
   const {done,value}=await reader.read();
   if(done)break;
   if(!(value instanceof Uint8Array)||!value.byteLength||value.byteLength>maxChunk||value.byteLength>row.size-offset)throw invalid();
   hash.update(value);
   // The receiver independently verifies the same whole-file hash before publication.
   if(offset+value.byteLength===row.size&&hash.copy().digest('hex')!==row.sha256)throw invalid();
   await send(value);
  }
  if(offset!==row.size||hash.digest('hex')!==row.sha256)throw invalid();
  if(row.size===0)await send(new Uint8Array());
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

async function control(ngs,name,args){
 const reply=await ngs('ngs_file_sync_'+name,args);
 if(!exact(reply,'ok')||reply.ok!==true)throw invalid();
}

async function pushDestination({scope,pds,ngs,signal,object=false,fileSlot=direct,onFileError=()=>{}}){
 if(typeof scope!=='string'||!project.test(scope)||typeof fileSlot!=='function')throw invalid();
 let syncId;
 try{
  const start=await ngs('ngs_file_sync_begin',{scope},{limit:48*1024*1024});
  if(id.test(start?.syncId??''))syncId=start.syncId;
  const previous=inventory(start,scope);
  const {files,deleted}=changes(await pds.compare(scope,start.files,{includeDeleted:true}),scope,previous);
  if(object)await control(ngs,'plan',{syncId,totalFiles:files.length});
  let failed=0;
  for(const row of files){
   await fileSlot(async()=>{
    signal?.throwIfAborted();
    let uncertain=false,reason,attempts=1;
    const fileArgs={pds,ngs,scope,syncId,row,signal,unknownFinal:()=>{uncertain=true;}};
    try{await pushFile(fileArgs);return;}
    catch(error){if(!object||signal?.aborted)throw error;reason=error;}
    try{await control(ngs,'file_reset',{syncId,path:row.path});attempts++;}
    catch{
     signal?.throwIfAborted();
     if(uncertain)throw Error('NGS_FILE_SYNC_FILE_ACK_UNRESOLVED');
    }
    if(attempts===2){
     try{await pushFile(fileArgs);return;}
     catch(error){signal?.throwIfAborted();reason=error;}
    }
    // An ambiguous final chunk might already be published. A full retry with
    // the exact same bytes resolves it; otherwise don't invent failure or finish.
    if(uncertain)throw Error('NGS_FILE_SYNC_FILE_ACK_UNRESOLVED');
    // file_failed settles the path (and fences any private partial upload) only
    // after a definite failure, so subsequent paths can proceed independently.
    await control(ngs,'file_failed',{syncId,path:row.path});
    failed++;
    onFileError(scope,row,reason,attempts);
   });
  }
  if(deleted.length){
   // Canonical source may have restored a file while changed files were being sent.
   const candidates=new Map(deleted.map(row=>[row.path,row.sha256]));
   const confirmed=changes(await pds.compare(scope,deleted,{includeDeleted:true}),scope,candidates).deleted;
   if(confirmed.length!==deleted.length)throw Error('PDS_NGS_FILE_SYNC_TOMBSTONE_CHANGED');
   for(const row of deleted){
    const reply=await ngs('ngs_file_sync_remove',{syncId,...row});
    if(!exact(reply,'removed')||typeof reply.removed!=='boolean')throw invalid();
   }
  }
  const result=await ngs('ngs_file_sync_finish',{syncId});
  if(!exact(result,'ok,written')||result.ok!==true||!Number.isSafeInteger(result.written)||result.written<0||result.written>files.length)
   throw invalid();
  return object?{...result,failed}:result;
 }catch(error){
  if(syncId)try{await ngs('ngs_file_sync_abort',{syncId});}catch{}
  throw error;
 }
}

export const pushProjectFiles=options=>pushDestination(options);
export const pushObjectProjectFiles=options=>pushDestination({...options,object:true});
export const pushSpaceProjectFiles=pushObjectProjectFiles;

// A file, including its recovery, holds the shared slot until it settles.
// Local and Space keep independent passes and can alternate at file boundaries.
export function shareFileTransferSlot(){
 let tail=Promise.resolve();
 return run=>{
  const next=tail.then(run);
  tail=next.then(()=>{},()=>{});
  return next;
 };
}

// One canonical compare slot is shared by the two destinations. Only compare is queued:
// a slow/disconnected destination must not hold the PDS slot during its uploads.
export function sharePdsCompareSlot(pds){
 let tail=Promise.resolve();
 return {...pds,compare(...args){
  const next=tail.then(()=>pds.compare(...args));
  tail=next.then(()=>{},()=>{});
  return next;
 }};
}

function senderPds(pdsUrl,signal){
 return createFolderMcpClient({call:loopbackJsonMCP(pdsUrl,{
  clientName:'pds-canonical-reader',signal,decodeToolError(name,result){
   if(name!=='npc_folders_compare'||result?.content?.length!==1||result.content[0]?.type!=='text')return null;
   const text=result.content[0]?.text;
   if(typeof text!=='string'||text.length>100)return null;
   try{
    const value=JSON.parse(text);
    return exact(value,'error,status')&&value.error==='FOLDER_BUSY'&&value.status===503?Error('FOLDER_BUSY'):null;
   }catch{return null;}
  },
 })});
}

/** Repeat, using discovery only within the configured canonical project allowlist. */
export async function watchPdsMcpFileSync({
 projects,pdsUrl=DEFAULT_PROJECT_FOLDER_MCP_URL,ngsUrl,
 now=()=>performance.now(),sleep=pause,signal,fileSlot,onResult=()=>{},onError=()=>{},onFileError,push=pushProjectFiles,
 pds=senderPds(pdsUrl,signal),
 ngs=loopbackJsonMCP(ngsUrl,{clientName:'pds-ngs-file-sender',signal,decodeToolError(name,result){
  if(name!=='ngs_file_sync_file_chunk')return null;
  const failure=result?.structuredContent;
  const status=failure?.error==='NGS_FILE_SYNC_INVALID'?400:409;
  return exact(failure,'error,status')&&failure.status===status&&definiteChunkFailures.has(failure.error)
   ?Error(failure.error):null;
 }}),
}={}){
 if(!Array.isArray(projects)||!projects.length||projects.length>maxEntries||
  projects.some(item=>typeof item!=='string'||!project.test(item))||new Set(projects).size!==projects.length)throw invalid();
 let lastStarted=-Infinity;
 while(!signal?.aborted){
  for(let remaining;!signal?.aborted&&(remaining=60_000-(now()-lastStarted))>0;){
   try{await sleep(Math.ceil(remaining),undefined,{signal});}
   catch(error){if(signal?.aborted)return;throw error;}
  }
  if(signal?.aborted)return;
  lastStarted=now();
  try{
   const result=await pds.discover();
   if(!exact(result,'projects')||!Array.isArray(result.projects)||result.projects.length>maxEntries||
    result.projects.some(item=>typeof item!=='string'||!project.test(item))||
    new Set(result.projects).size!==result.projects.length)throw invalid();
   const discovered=new Set(result.projects);
   for(const scope of projects){
    if(signal?.aborted)return;
    if(!discovered.has(scope))continue;
    try{onResult(scope,await push({scope,pds,ngs,signal,fileSlot,onFileError}));}
    catch(error){if(!signal?.aborted)onError(scope,error);}
   }
  }catch(error){if(!signal?.aborted)onError(null,error);}
 }
}

export function createSpaceFileSyncDestination(options){
 const call=createSpaceMachineMcp(options);
 return (name,args,settings)=>{
  if(!fileTools.includes(name))throw invalid();
  return call(name,args,settings);
 };
}
function publicError(error){
 return /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message??'')?error.message:'PDS_NGS_FILE_SYNC_UNAVAILABLE';
}
function reportFileLoop(destination){
 const hosted=destination==='space'?{destination}:{};
 return {
  onResult:(scope,{written,failed=0})=>console.log(JSON.stringify({event:failed?'pds_ngs_file_sync_partial':'pds_ngs_file_sync_complete',
   ...hosted,scope,written,...(failed?{failed}:{})})),
  onError:(scope,error)=>console.error(JSON.stringify({event:'pds_ngs_file_sync_failed',...hosted,scope,error:publicError(error)})),
  onFileError:(scope,row,error,attempts)=>console.error(JSON.stringify({event:'pds_ngs_file_item_failed',...hosted,scope,
   fileKey:createHash('sha256').update(row.path).digest('hex'),attempts,error:publicError(error)})),
 };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--watch')throw Error('Usage: pds-mcp-file-sync.mjs --watch');
 const {PDS_MCP_URL,NGS_FILE_SYNC_MCP_URL,NGS_FILE_SYNC_PROJECTS}=process.env;
 const controller=new AbortController(),health=startOpsHealthReport({serverName:'pds-mcp'});
 const signal=controller.signal;
 const localObject=process.env.NGS_LOCAL_FILE_SYNC_OBJECT_MODE==='1';
 const fileSlot=shareFileTransferSlot();
 const pds=sharePdsCompareSlot(senderPds(PDS_MCP_URL??DEFAULT_PROJECT_FOLDER_MCP_URL,signal));
 for(const action of ['SIGTERM','SIGINT'])process.once(action,()=>controller.abort());
 let space;
 if(process.env.NGS_SPACE_FILE_SYNC_ENABLED==='1'){
  try{
   const ngs=createSpaceFileSyncDestination({...spaceMachineConfiguration(),signal});
   space=watchPdsMcpFileSync({pdsUrl:PDS_MCP_URL,projects:['binari'],pds,ngs,signal,fileSlot,push:pushSpaceProjectFiles,
    ...reportFileLoop('space')}).catch(()=>reportFileLoop('space').onError(null));
  }catch{reportFileLoop('space').onError(null,Error('NGS_SPACE_MACHINE_CONFIGURATION_REQUIRED'));}
 }
 try{
  await watchPdsMcpFileSync({pdsUrl:PDS_MCP_URL,ngsUrl:NGS_FILE_SYNC_MCP_URL,projects:NGS_FILE_SYNC_PROJECTS?.split(','),
   pds,signal,fileSlot,push:localObject?pushObjectProjectFiles:pushProjectFiles,...reportFileLoop('local')});
 }finally{controller.abort();await space;health.stop();}
}
