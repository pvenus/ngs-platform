/** Shared folder-sync protocol. Transport and transfer direction are adapters. */
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdtemp,open,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {validFolderPath} from './local-recursive-folders.mjs';

const maxChunk=1024*1024,maxEntries=32768,maxActiveFiles=20;
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

// The canonical PDS port is chunked only internally. Spool one file privately
// and verify its whole digest before opening any destination upload request.
async function withVerifiedFile({pds,scope,row,signal},use){
 const directory=await mkdtemp(join(tmpdir(),'ngs-file-sync-'));
 const path=join(directory,'verified-file');
 try{
  const file=await open(path,'wx',0o600);
  try{
   const reader=pds.file(scope,row.path,row.sha256,row.size).body.getReader();
   const hash=createHash('sha256');let seen=0;
   try{
    for(;;){
     signal?.throwIfAborted();
     const {done,value}=await reader.read();if(done)break;
     if(!(value instanceof Uint8Array)||!value.byteLength||value.byteLength>maxChunk||value.byteLength>row.size-seen)throw invalid();
     hash.update(value);seen+=value.byteLength;
     let written=0;
     while(written<value.byteLength){
      const count=(await file.write(value,written,value.byteLength-written,null)).bytesWritten;
      if(count<1)throw invalid();
      written+=count;
     }
    }
    if(seen!==row.size||hash.digest('hex')!==row.sha256)throw invalid();
   }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  }finally{await file.close();}
  return await use(()=>Readable.toWeb(createReadStream(path)));
 }finally{await rm(directory,{recursive:true,force:true});}
}

async function control(ngs,name,args){
 const reply=await ngs('ngs_file_sync_'+name,args);
 if(!exact(reply,'ok')||reply.ok!==true)throw invalid();
}

async function pushDestination({scope,pds,ngs,upload,signal,fileSlot=direct,destination='local',parallelism=1,onFileError=()=>{}}){
 if(typeof scope!=='string'||!project.test(scope)||typeof fileSlot!=='function'||typeof upload!=='function'||
    !['local','space'].includes(destination)||!Number.isInteger(parallelism)||parallelism<1||parallelism>maxActiveFiles)throw invalid();
 let syncId;
 try{
  const start=await ngs('ngs_file_sync_begin',{scope},{limit:48*1024*1024});
  if(id.test(start?.syncId??''))syncId=start.syncId;
  const previous=inventory(start,scope);
  const {files,deleted}=changes(await pds.compare(scope,start.files,{includeDeleted:true}),scope,previous);
  await control(ngs,'plan',{syncId,totalFiles:files.length});
  let failed=0;
  await runFiles(files,parallelism,fileSlot,destination,signal,async row=>{
    let uncertain=false,reason,attempts=1;
    const send=async bodyFactory=>{
     try{
      const reply=await upload({syncId,...row},bodyFactory);
      if(!exact(reply,'ok')||reply.ok!==true)throw invalid();
      return true;
     }catch(error){
      signal?.throwIfAborted();
      if(error?.definite!==true)uncertain=true;
      reason=error;
      return false;
     }
    };
    let prepared=false;
    const prepare=()=>withVerifiedFile({pds,scope,row,signal},async bodyFactory=>{
     prepared=true;
     if(await send(bodyFactory))return true;
     try{await control(ngs,'file_reset',{syncId,path:row.path});}
     catch{
      signal?.throwIfAborted();
      if(uncertain)throw Error('NGS_FILE_SYNC_FILE_ACK_UNRESOLVED');
      return false;
     }
     attempts++;
     return await send(bodyFactory);
    });
    let sent;
    try{sent=await prepare();}
    catch(error){
     signal?.throwIfAborted();
     if(prepared)throw error;
     reason=error;attempts++;
     try{sent=await prepare();}
     catch(second){signal?.throwIfAborted();if(prepared)throw second;reason=second;}
    }
    if(sent)return;
    // A reply-lost atomic write may already be visible. Don't fabricate a
    // failure or touch tombstones while that exact replay is unresolved.
    if(uncertain)throw Error('NGS_FILE_SYNC_FILE_ACK_UNRESOLVED');
    await control(ngs,'file_failed',{syncId,path:row.path});
    failed++;
    onFileError(scope,row,reason,attempts);
  });
  signal?.throwIfAborted();
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
  return {...result,failed};
 }catch(error){
  if(syncId)try{await ngs('ngs_file_sync_abort',{syncId});}catch{}
  throw error;
 }
}

export const pushProjectFiles=pushDestination;
export const pushObjectProjectFiles=pushDestination;
export const pushSpaceProjectFiles=options=>pushDestination({...options,destination:'space'});

// A file holds an active slot from the first source read through receipt or
// recovery. Waiters hold only metadata, not temporary files or request bodies.
export function shareFileTransferSlot(limit=1){
 if(!Number.isInteger(limit)||limit<1||limit>maxActiveFiles)throw invalid();
 const pending=new Map();
 let active=0,last;
 function drain(){
  while(active<limit&&pending.size){
   // Rotate between ready destinations, preserving FIFO within each one.
   const keys=[...pending.keys()],key=keys.find(x=>x!==last)??keys[0];
   const queue=pending.get(key),job=queue.shift();if(!queue.length)pending.delete(key);
   last=key;active++;
   Promise.resolve().then(job.run).then(
    value=>{active--;job.resolve(value);queueMicrotask(drain);},
    error=>{active--;job.reject(error);queueMicrotask(drain);});
  }
 }
 return (run,destination='local')=>new Promise((resolve,reject)=>{
  const queue=pending.get(destination)??[];queue.push({run,resolve,reject});pending.set(destination,queue);drain();
 });
}
async function runFiles(rows,parallelism,slot,destination,signal,send){
 let cursor=0,stopped=false,firstError;
 const remember=e=>{if(!stopped){stopped=true;firstError=e;}};
 async function worker(){
  try{
   while(!stopped&&cursor<rows.length){
    signal?.throwIfAborted();const row=rows[cursor++];
    await slot(async()=>{
     if(stopped)return;
     try{signal?.throwIfAborted();await send(row);}
     catch(e){remember(e);throw e;}
    },destination);
   }
  }catch(e){remember(e);}
 }
 // No finish, delete or abort until every in-flight path in this pass
 // settles. A stopped pass never opens a new file when queued slots rotate.
 await Promise.all(Array.from({length:Math.min(parallelism,rows.length)},worker));
 if(stopped)throw firstError;
}
