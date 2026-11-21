/** Push changed canonical files via MCP only, without exposing a Filex path. */
import {createHash} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {createFolderMcpClient} from './folder-mcp-client.mjs';
import {DEFAULT_PROJECT_FOLDER_MCP_URL,loopbackJsonMCP} from './folder-mcp-loopback.mjs';
import {validFolderPath} from './local-recursive-folders.mjs';

const maxFile=64*1024*1024,maxChunk=1024*1024,maxEntries=32768;
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
 if((!exact(value,'groups,scope')&&!exact(value,'deleted,groups,scope'))||value.scope!==scope||
  !Array.isArray(value.groups)||value.deleted!==undefined&&(!Array.isArray(value.deleted)||value.deleted.length))throw invalid();
 const files=[],found=new Set(),folders=new Set();
 for(const group of value.groups){
  if(!exact(group,'files,folder')||typeof group.folder!=='string'||
   group.folder!==''&&(!validFolderPath(group.folder)||group.folder.includes('/'))||folders.has(group.folder)||
   !Array.isArray(group.files)||group.files.length===0)throw invalid();
  folders.add(group.folder);
  for(const row of group.files){
   if(!exact(row,'path,sha256,size')||!pathWithin(scope,row.path)||!digestOk(row.sha256)||
    !Number.isSafeInteger(row.size)||row.size<0||row.size>maxFile||found.has(row.path)||
    (row.path.includes('/')?row.path.split('/')[0]:'')!==group.folder||
    previous.get(row.path)===row.sha256||files.length>=maxEntries)throw invalid();
   found.add(row.path);files.push(row);
  }
 }
 return files;
}

export async function pushProjectFiles({scope,pds,ngs}){
 if(typeof scope!=='string'||!project.test(scope))throw invalid();
 let syncId;
 try{
  const start=await ngs('ngs_file_sync_begin',{scope},{limit:48*1024*1024});
  if(id.test(start?.syncId??''))syncId=start.syncId;
  const previous=inventory(start,scope);
  const files=changes(await pds.compare(scope,start.files),scope,previous);
  for(const row of files){
   const reader=pds.file(scope,row.path,row.sha256,row.size).body.getReader();
   const hash=createHash('sha256');let offset=0;
   const send=async bytes=>{
    const reply=await ngs('ngs_file_sync_file_chunk',{syncId,...row,offset,dataBase64:Buffer.from(bytes).toString('base64')});
    offset+=bytes.byteLength;
    if(!exact(reply,'nextOffset')||reply.nextOffset!==(offset===row.size?null:offset))throw invalid();
   };
   try{
    for(;;){
     const {done,value}=await reader.read();
     if(done)break;
     if(!(value instanceof Uint8Array)||!value.byteLength||value.byteLength>maxChunk||offset+value.byteLength>row.size)throw invalid();
     hash.update(value);
     // The receiver independently verifies the same whole-file hash before publication.
     if(offset+value.byteLength===row.size&&hash.copy().digest('hex')!==row.sha256)throw invalid();
     await send(value);
    }
    if(offset!==row.size||hash.digest('hex')!==row.sha256)throw invalid();
    if(row.size===0)await send(new Uint8Array());
   }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }
  const result=await ngs('ngs_file_sync_finish',{syncId});
  if(!exact(result,'ok,written')||result.ok!==true||!Number.isSafeInteger(result.written)||result.written<0||result.written>files.length)
   throw invalid();
  return result;
 }catch(error){
  if(syncId)try{await ngs('ngs_file_sync_abort',{syncId});}catch{}
  throw error;
 }
}

/** Repeat, using discovery only within the configured canonical project allowlist. */
export async function watchPdsMcpFileSync({
 projects,pdsUrl=DEFAULT_PROJECT_FOLDER_MCP_URL,ngsUrl,
 now=()=>performance.now(),sleep=pause,signal,onResult=()=>{},onError=()=>{},
 pds=createFolderMcpClient({call:loopbackJsonMCP(pdsUrl,{clientName:'pds-canonical-reader',signal})}),
 ngs=loopbackJsonMCP(ngsUrl,{clientName:'pds-ngs-file-sender',signal}),
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
    try{onResult(scope,await pushProjectFiles({scope,pds,ngs}));}
    catch(error){if(!signal?.aborted)onError(scope,error);}
   }
  }catch(error){if(!signal?.aborted)onError(null,error);}
 }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(process.argv.length!==3||process.argv[2]!=='--watch')throw Error('Usage: pds-mcp-file-sync.mjs --watch');
 const {PDS_MCP_URL,NGS_FILE_SYNC_MCP_URL,NGS_FILE_SYNC_PROJECTS}=process.env;
 const controller=new AbortController();
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>controller.abort());
 await watchPdsMcpFileSync({
  pdsUrl:PDS_MCP_URL,ngsUrl:NGS_FILE_SYNC_MCP_URL,projects:NGS_FILE_SYNC_PROJECTS?.split(','),
  signal:controller.signal,
  onResult:(scope,{written})=>console.log(JSON.stringify({event:'pds_ngs_file_sync_complete',scope,written})),
  onError:(scope,error)=>console.error(JSON.stringify({
   event:'pds_ngs_file_sync_failed',scope,
   error:/^[A-Z][A-Z0-9_]{1,80}$/.test(error?.message??'')?error.message:'PDS_NGS_FILE_SYNC_UNAVAILABLE',
  })),
 });
}
