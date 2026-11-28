/** Push canonical file changes via MCP only, without exposing a Filex path. */
import {startOpsHealthReport} from './local-ops-health-report.mjs';
import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {createFolderMcpClient} from './folder-mcp-client.mjs';
import {DEFAULT_PROJECT_FOLDER_MCP_URL,loopbackJsonMCP} from './folder-mcp-loopback.mjs';
import {createSpaceMachineMcp,createSpaceFileSyncUpload,spaceMachineConfiguration,fileTools} from './space-machine-mcp.mjs';
import {createLoopbackFileUpload} from './file-sync-raw-client.mjs';

import {pushProjectFiles,pushSpaceProjectFiles,shareFileTransferSlot} from './mcp-file-sync-engine.mjs';
export {pushProjectFiles,pushObjectProjectFiles,pushSpaceProjectFiles,shareFileTransferSlot} from './mcp-file-sync-engine.mjs';
const maxEntries=32768,maxActiveFiles=20;
const project=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const invalid=()=>Error('PDS_NGS_FILE_SYNC_INVALID');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;

export function sharePdsChunkSlots(call){
 const slot=shareFileTransferSlot(2);
 return (name,...args)=>name==='npc_folder_file_chunk'?slot(()=>call(name,...args)):call(name,...args);
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
 return createFolderMcpClient({call:sharePdsChunkSlots(loopbackJsonMCP(pdsUrl,{
  clientName:'pds-canonical-reader',signal,decodeToolError(name,result){
   if(name!=='npc_folders_compare'||result?.content?.length!==1||result.content[0]?.type!=='text')return null;
   const text=result.content[0]?.text;
   if(typeof text!=='string'||text.length>100)return null;
   try{
    const value=JSON.parse(text);
    return exact(value,'error,status')&&value.error==='FOLDER_BUSY'&&value.status===503?Error('FOLDER_BUSY'):null;
   }catch{return null;}
  },
 }))});
}

/** Repeat, using discovery only within the configured canonical project allowlist. */
export async function watchPdsMcpFileSync({
 projects,pdsUrl=DEFAULT_PROJECT_FOLDER_MCP_URL,ngsUrl,
 now=()=>performance.now(),sleep=pause,signal,fileSlot,parallelism=1,onResult=()=>{},onError=()=>{},onFileError,push=pushProjectFiles,
 pds=senderPds(pdsUrl,signal),
 ngs=loopbackJsonMCP(ngsUrl,{clientName:'pds-ngs-file-sender',signal}),
 upload=ngsUrl?createLoopbackFileUpload(ngsUrl,{signal}):undefined,
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
    try{onResult(scope,await push({scope,pds,ngs,upload,signal,fileSlot,parallelism,onFileError}));}
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
 const fileSlot=shareFileTransferSlot(maxActiveFiles);
 const pds=sharePdsCompareSlot(senderPds(PDS_MCP_URL??DEFAULT_PROJECT_FOLDER_MCP_URL,signal));
 for(const action of ['SIGTERM','SIGINT'])process.once(action,()=>controller.abort());
 let space;
 if(process.env.NGS_SPACE_FILE_SYNC_ENABLED==='1'){
  try{
   const config={...spaceMachineConfiguration(),signal};
   const ngs=createSpaceFileSyncDestination(config),upload=createSpaceFileSyncUpload(config);
   space=watchPdsMcpFileSync({pdsUrl:PDS_MCP_URL,projects:['binari'],pds,ngs,upload,signal,fileSlot,parallelism:maxActiveFiles,push:pushSpaceProjectFiles,
    ...reportFileLoop('space')}).catch(()=>reportFileLoop('space').onError(null));
  }catch{reportFileLoop('space').onError(null,Error('NGS_SPACE_MACHINE_CONFIGURATION_REQUIRED'));}
 }
 try{
  await watchPdsMcpFileSync({pdsUrl:PDS_MCP_URL,ngsUrl:NGS_FILE_SYNC_MCP_URL,projects:NGS_FILE_SYNC_PROJECTS?.split(','),
   pds,signal,fileSlot,parallelism:maxActiveFiles,push:pushProjectFiles,...reportFileLoop('local')});
 }finally{controller.abort();await space;health.stop();}
}
