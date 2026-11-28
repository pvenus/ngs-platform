/** Reverse the existing NGS MCP transfer roles: Space reads; P2 receives. */
import {randomUUID} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createFolderMcpClient} from '../../ngs-local/sites/npcgen/build/folder-mcp-client.mjs';
import {pushProjectFiles,shareFileTransferSlot} from '../../ngs-local/sites/npcgen/build/mcp-file-sync-engine.mjs';
import {replicaPathResource,validateMirrorManifest,mirrorChunkBytes} from './mirror.mjs';

const scope='binari', oneMiB=mirrorChunkBytes;
const invalid=()=>Error('VIEWER_MCP_SYNC_INVALID');
const require=value=>{if(!value)throw invalid();};
const match=(item,meta)=>item.path===meta.path&&item.sha256===meta.sha256&&item.size===meta.size;

export async function pullSpaceToP2({mirror,remote,signal,parallelism=20,onFileError=()=>{}}){
 const rows=new Map(),failed=new Set(),removed=new Set(),plannedFiles=new Map();
 const chunkSlot=shareFileTransferSlot(2), transferSlot=shareFileTransferSlot(parallelism);
 const syncId='ngs.sync.'+randomUUID();
 let manifest,active,comparisonCount=0,last;
 const pds=createFolderMcpClient({call:async(name,args)=>{
  if(name==='npc_project_folders_list')return {projects:[scope]};
  require(args.scope===scope);
  if(name==='npc_folders_compare'){
   const r=await remote('/api/viewer/manifest');require(r.status===200);
   const source=validateMirrorManifest(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.bytes)));
   require(Array.isArray(source.resources)&&source.resources.includes('project'));
   const allowed=new Set(source.resources), inventory=new Map(source.files.map(item=>[item.path,item]));
   if(comparisonCount++===0){
    manifest=source;
    for(const item of source.files)rows.set(item.path,item);
   }
   const supplied=new Map(args.files.map(row=>[row.path,row.sha256]));
   const groups=new Map();
   for(const item of source.files){
    if(supplied.get(item.path)===item.sha256)continue;
    const dir=item.path.includes('/')?item.path.split('/')[0]:'';
    if(!groups.has(dir))groups.set(dir,[]);
    groups.get(dir).push(item);
   }
   const deleted=args.includeDeleted===true?args.files.filter(row=>
    !inventory.has(row.path)&&allowed.has(replicaPathResource(row.path))):[];
   return {scope,groups:[...groups].map(([folder,files])=>({folder,files})),deleted};
  }
  require(name==='npc_folder_file_chunk');
  const row=rows.get(args.path),offset=args.offset;
  require(row?.sha256===args.sha256&&Number.isSafeInteger(offset)&&offset>=0&&offset<=row.size);
  return chunkSlot(async()=>{
   const r=await remote('/api/viewer/file?'+new URLSearchParams({path:row.path,sha256:row.sha256,offset}));
   const len=Math.min(oneMiB,row.size-offset);
   require(r.status===200&&r.fileSize===String(row.size)&&r.fileSha256===row.sha256&&r.fileOffset===String(offset)&&r.bytes.length===len);
   return {scope,path:row.path,sha256:row.sha256,offset,size:row.size,base64:Buffer.from(r.bytes).toString('base64'),
    nextOffset:offset+len===row.size?null:offset+len};
  });
 }});
 const ngs=async(name,args)=>{
  if(name==='ngs_file_sync_begin'){
   require(args.scope===scope);
   return {scope,syncId,inventoryAt:Date.now(),files:mirror.inventory()};
  }
  require(args.syncId===syncId);
  if(name==='ngs_file_sync_abort'){
   if(active){mirror.abort(active);active=null;}
   return {ok:true};
  }
  if(name==='ngs_file_sync_plan'){
   require(!active&&manifest);
   const minted=mirror.begin(manifest);active=minted.syncId;
   require(minted.files.length===args.totalFiles);
   for(const item of minted.files)plannedFiles.set(item.path,item);
   return {ok:true};
  }
  require(active);
  if(name==='ngs_file_sync_file_reset'){
   require(plannedFiles.has(args.path));mirror.reset(active,args.path);return {ok:true};
  }
  if(name==='ngs_file_sync_file_failed'){
   require(plannedFiles.has(args.path));failed.add(args.path);return {ok:true};
  }
  if(name==='ngs_file_sync_remove'){
   require(!rows.has(args.path));removed.add(args.path);return {removed:true};
  }
  if(name==='ngs_file_sync_finish'){
   last=mirror.finish(active,{failed,confirmed:removed});active=null;return {ok:true,written:last.changed};
  }
  throw invalid();
 };
 const upload=async(args,bodyFactory)=>{
  require(active&&args.syncId===syncId&&plannedFiles.has(args.path)&&match(args,plannedFiles.get(args.path)));
  let offset=0;
  const stream=bodyFactory(),reader=stream.getReader();
  try{
   for(;;){
    signal?.throwIfAborted();
    const {value,done}=await reader.read();
    if(done)break;
    for(let i=0;i<value.byteLength;i+=oneMiB){
     const part=value.subarray(i,i+oneMiB), reply=mirror.append(active,args.path,offset,part);
     require(reply.offset===offset+part.byteLength);
     offset=reply.offset;
    }
   }
   require(offset===args.size);
   return {ok:true};
  }catch(error){
   // This local call has no reply-lost boundary. No P2 file publishes until
   // finish; file_reset can always discard exact uncommitted scratch.
   throw Object.assign(error,{definite:true});
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 };
 const result=await pushProjectFiles({scope,pds,ngs,upload,signal,fileSlot:transferSlot,parallelism,onFileError});
 return {...last,failed:result.failed};
}

const queueError=()=>Object.assign(Error('VIEWER_SYNC_SESSION_INVALID'),{status:409});
export function createViewerSyncQueue(mirror,{onFinish=()=>{},onAccessLost=()=>{}}={}){
 let pass;
 function lookup(id){
  if(!pass||pass.id!==id)throw queueError();
  return pass;
 }
 function start(){
  if(pass?.state==='running')throw Object.assign(Error('VIEWER_SYNC_BUSY'),{status:409});
  const run={id:randomUUID(),state:'running',jobs:new Map(),control:new AbortController()};
  pass=run;
  const stop=()=>run.control.abort(Error('VIEWER_SYNC_TIMED_OUT'));
  const cap=setTimeout(stop,60*60_000);cap.unref();
  const remote=path=>new Promise((resolve,reject)=>{
   if(run.control.signal.aborted){reject(run.control.signal.reason);return;}
   const id=randomUUID();
   const drop=error=>{
    run.jobs.delete(id);clearTimeout(deadline);run.control.signal.removeEventListener('abort',aborted);
    if(error)reject(error);
   };
   const aborted=()=>drop(run.control.signal.reason);
   const deadline=setTimeout(()=>drop(Error('VIEWER_SPACE_READ_TIMEOUT')),32_000);deadline.unref();
   run.control.signal.addEventListener('abort',aborted,{once:true});
   run.jobs.set(id,{id,path,taken:false,reply(dto){
    drop();
    if(dto.status===401||dto.status===403){
     onAccessLost();run.control.abort(Error('VIEWER_SPACE_ACCESS_LOST'));reject(run.control.signal.reason);return;
    }
    resolve(dto);
   }});
  });
  void pullSpaceToP2({mirror,remote,signal:run.control.signal}).then(value=>{
   run.result=value;run.state='completed';onFinish(value);
  },e=>{
   run.error=/^[A-Z0-9_]+$/u.test(e?.message??'')?e.message:'VIEWER_SPACE_SYNC_FAILED';run.state='failed';
  }).finally(()=>clearTimeout(cap));
  return {id:run.id};
 }
 function poll(id){
  const run=lookup(id),jobs=[];
  for(const item of run.jobs.values())if(!item.taken){
   item.taken=true;jobs.push({id:item.id,path:item.path});
  }
  return {state:run.state,jobs,...(run.result?{result:run.result}:{}),...(run.error?{error:run.error}:{})};
 }
 function respond(id,job,dto){
  const run=lookup(id),current=run.jobs.get(job);
  if(!current?.taken)throw queueError();
  current.reply(dto);return {ok:true};
 }
 function close(){
  pass?.control.abort(Error('VIEWER_SYNC_CLOSED'));
 }
 return {start,poll,respond,close};
}
