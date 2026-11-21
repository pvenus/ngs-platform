/** Shared object replica: temporary data becomes visible only through the version CAS. */
import {createHash} from 'node:crypto';
const project='binari',defaultNamespace='ngs-replica/v1/binari/';
const passes='ngs_replica_pass_v2',receives='ngs_replica_receive_v2',entries='ngs_replica_version_v2',resets='ngs_replica_reset_v2';
const inactivity=60*60_000,maxPaths=32768,maxInventoryBytes=16*1024*1024;
export const objectReplicaChunkSize=1024*1024;
export const objectReplicaBatchTool='ngs_file_sync_file_batch';
export const objectReplicaBatchFiles=32;
export const objectReplicaBatchRawBytes=2*objectReplicaChunkSize;
export const objectReplicaBatchRpcBytes=4*Math.ceil(objectReplicaBatchRawBytes/3)+96*1024;
const chunkSize=objectReplicaChunkSize,minPart=5*chunkSize,maxParts=10000;
// Shared wire tolerates the full supported R2 object range, not a product size cap.
const nativeObjectMaximum=5*1024**4-5*1024**3;
const partSize=size=>Math.max(minPart,Math.ceil(size/(maxParts*chunkSize))*chunkSize);
const encoder=new TextEncoder(),hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const safeInt=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const uuidOK=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(v);
const syncOK=v=>typeof v==='string'&&v.startsWith('ngs.sync.')&&uuidOK(v.slice(9));
const exact=(v,...keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(value,status=400,code='NGS_FILE_SYNC_INVALID')=>{if(!value)throw Object.assign(Error(code),{status});};
const stale=()=>need(false,409,'NGS_FILE_SYNC_REPLICA_CHANGED');
const content=()=>need(false,409,'NGS_FILE_SYNC_CONTENT_MISMATCH');
const badOffset=()=>need(false,409,'NGS_FILE_SYNC_OFFSET_INVALID');
const unavailable=()=>need(false,503,'NGS_FILE_SYNC_UNAVAILABLE');
const string={type:'string'},integer={type:'integer',minimum:0,maximum:nativeObjectMaximum};
const tool=(name,description,properties)=>({name,description,inputSchema:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}});
const begin='ngs_file_sync_begin',chunk='ngs_file_sync_file_chunk',reset='ngs_file_sync_file_reset',
 remove='ngs_file_sync_remove',finish='ngs_file_sync_finish',abort='ngs_file_sync_abort';
export const objectReplicaSyncTools=Object.freeze([
 tool(begin,'Open a Binari replica sync pass and read the digest inventory.',{scope:{const:project}}),
 tool(chunk,'Write one bounded piece to a private, per-file replica transfer.',{syncId:string,path:string,sha256:string,size:integer,offset:integer,dataBase64:string}),
 tool(objectReplicaBatchTool,'Submit up to 32 complete small files and receive one status per file (2 MiB total).',{
  syncId:string,files:{type:'array',minItems:1,maxItems:objectReplicaBatchFiles,items:{
   type:'object',additionalProperties:false,required:['path','sha256','size','dataBase64'],
   properties:{path:string,sha256:string,size:{...integer,maximum:objectReplicaChunkSize},dataBase64:string},
  }},
 }),
 tool(reset,'Discard one incomplete file transfer. Its live replica is not altered.',{syncId:string,path:string}),
 tool(remove,'Hide one digest-matched replica file without deleting its earlier bytes.',{syncId:string,path:string,sha256:string}),
 tool(finish,'Close a replica sync pass; report files committed by it.',{syncId:string}),
 tool(abort,'Cancel unfinished replica transfers without altering live files.',{syncId:string}),
]);
const names=new Set(objectReplicaSyncTools.map(t=>t.name));
const batchErrors=new Map([
 ['NGS_FILE_SYNC_CONTENT_MISMATCH',409],['NGS_FILE_SYNC_REPLICA_CHANGED',409],
 ['NGS_FILE_SYNC_OFFSET_INVALID',409],['NGS_FILE_SYNC_INCOMPLETE',409],
 ['NGS_FILE_SYNC_UNAVAILABLE',503],
]);
const decoded=b64=>{
 need(typeof b64==='string'&&b64.length<=4*Math.ceil(chunkSize/3)&&/^[A-Za-z0-9+/]*={0,2}$/u.test(b64));
 let data;try{data=atob(b64);}catch{need(false);}
 need(btoa(data)===b64);
 return Uint8Array.from(data,c=>c.charCodeAt(0));
};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const noOverwrite=()=>new Headers({'If-None-Match':'*'});
function verifiedMeta(o){
 if(o&&!(hash(o.customMetadata?.sha256)&&typeof o.etag==='string'&&safeInt(o.size,0,nativeObjectMaximum)))unavailable();
 return o;
}
const headerBound=path=>path==='project.json'?64*1024:path==='icon.png'?2*chunkSize:nativeObjectMaximum;
function headerCheck(path,first){
 if(path==='icon.png'&&![137,80,78,71,13,10,26,10].every((v,i)=>first[i]===v))content();
 if(path==='project.json'){
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(first));}catch{content();}
  if(!value||typeof value!=='object'||Array.isArray(value))content();
 }
}

/**
 * One private, Binari-scoped replica. db is the D1/SQLite statement port;
 * bucket is the R2/S3 object port. Adapters supply a known-length stream
 * for native multipart, never a whole-file buffering step.
 */
export function createObjectReplica({db,bucket,now=Date.now,uuid=()=>crypto.randomUUID(),
 fixedLengthStream=()=>new TransformStream(),
 writePart=(upload,part,body)=>upload.uploadPart(part,body),namespace=defaultNamespace}={}){
 if(typeof namespace!=='string'||!/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/){1,8}$/u.test(namespace))unavailable();
 const legacy=namespace+'files/',stage=namespace+'v2/stage/',versions=namespace+'v2/objects/';
 const pathOK=p=>typeof p==='string'&&p.isWellFormed()&&encoder.encode(legacy+p).length<=1024&&p.split('/').length<=64&&
  p.split('/').every(c=>c.length&&encoder.encode(c).length<=255&&!c.startsWith('.')&&!/[\\\x00-\x1f\x7f]/u.test(c));
 const stageKey=(attempt,offset)=>stage+attempt+'/'+offset;
 const objectKey=attempt=>versions+attempt;
 const validObjectKey=key=>typeof key==='string'&&key.startsWith(versions)&&uuidOK(key.slice(versions.length));
 const ready=()=>need(db&&bucket,503,'NGS_FILE_SYNC_UNAVAILABLE');
 const stmt=(sql,...args)=>db.prepare(sql).bind(...args);
 const first=(sql,...args)=>stmt(sql,...args).first();
 const all=async(sql,...args)=>(await stmt(sql,...args).all()).results;
 const run=async(sql,...args)=>(await stmt(sql,...args).run()).meta.changes;
 const current=async path=>{
  const row=await first(`SELECT * FROM ${entries} WHERE path=? ORDER BY version DESC LIMIT 1`,path);
  if(row?.object_key&&!validObjectKey(row.object_key))unavailable();
  return row;
 };
 const generation=(id,path)=>first(`SELECT generation FROM ${resets} WHERE sync_id=? AND path=?`,id,path);
 const transfer=(id,path)=>first(`SELECT * FROM ${receives} WHERE sync_id=? AND path=?`,id,path);
 const makeId=()=>{const id=uuid();if(!uuidOK(id))unavailable();return id;};
 const loadSession=async id=>{
  const row=await first(`SELECT * FROM ${passes} WHERE sync_id=? AND expiry>?`,id,now());
  need(row,409,'NGS_FILE_SYNC_INVALID_SESSION');return row;
 };
 function expectedObject(o,v){
  if(!o||v&&(o.customMetadata?.sha256!==v.sha256||o.size!==v.size)){
   if(v)unavailable();
   return null;
  }
  return verifiedMeta(o);
 }
 async function resolve(path){
  ready();need(pathOK(path));
  const version=await current(path);
  if(version)return {version,ref:version.object_key};
  return {version:null,ref:legacy+path};
 }
 async function head(path){
  const {version,ref}=await resolve(path);if(!ref)return null;
  const item=expectedObject(await bucket.head(ref),version);
  return item?.customMetadata?.removed==='1'?null:item;
 }
 async function get(path,options){
  const {version,ref}=await resolve(path);if(!ref)return null;
  const item=expectedObject(await bucket.get(ref,options),version);
  if(item?.customMetadata?.removed==='1'){void item.body?.cancel().catch(()=>{});return null;}
  if(item&&!item.body)stale();
  return item;
 }
 async function list(scope=''){
  ready();
  if(scope!==''&&!pathOK(scope))need(false);
  // Browser adapters may request one folder prefix. The machine begin
  // contract still calls list() with no filter and sees the full inventory.
  const subtree=scope?scope+'/':'',high=scope?scope+'0':'';
  let cursor;
  const files=new Map();
  do{
   const page=await bucket.list({prefix:legacy+subtree,limit:1000,include:['customMetadata'],cursor});
   for(const item of page.objects){
    const path=item.key.slice(legacy.length);
    if(!item.key.startsWith(legacy+subtree)||!pathOK(path))unavailable();
    verifiedMeta(item);
    if(item.customMetadata.removed!=='1')files.set(path,item.customMetadata.sha256);
   }
   if(!page.truncated)break;
   if(!page.cursor||cursor===page.cursor)unavailable();cursor=page.cursor;
  }while(true);
  const published=await all(`SELECT v.path,v.sha256,v.object_key FROM ${entries} v
   JOIN (SELECT path,MAX(version) AS newest FROM ${entries} ${scope?'WHERE path>=? AND path<?':''} GROUP BY path) x
    ON v.path=x.path AND v.version=x.newest
   LIMIT ${maxPaths+1}`,...(scope?[subtree,high]:[]));
  if(published.length>maxPaths)unavailable();
  for(const row of published){
   if(!pathOK(row.path)||!row.path.startsWith(subtree)||!hash(row.sha256))unavailable();
   if(row.object_key)files.set(row.path,row.sha256);else files.delete(row.path);
  }
  let bytes=2;
  if(files.size>maxPaths)unavailable();
  return [...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,sha256])=>{
   const item={path,sha256};bytes+=encoder.encode(JSON.stringify(item)).length+1;
   if(bytes>maxInventoryBytes)unavailable();return item;
  });
 }
 async function activePrior(path,session){
  const version=await current(path),prior=version?.version??0;
  if(prior>session.baseline)stale();
  if(version)return {prior,sha256:version.object_key?version.sha256:null,size:version.size,version};
  const item=verifiedMeta(await bucket.head(legacy+path));
  return {prior,sha256:item?.customMetadata.removed==='1'?null:item?.customMetadata.sha256,size:item?.size,version};
 }
 async function collectExpired(){
  const expired=await all(`SELECT sync_id FROM ${passes} WHERE expiry<=? ORDER BY expiry LIMIT 2`,now());
  for(const {sync_id} of expired){
   const fenced=await run(`DELETE FROM ${passes} WHERE sync_id=? AND expiry<=?`,sync_id,now());
   if(fenced)await clearPassTransfers(sync_id);
  }
 }
 async function start(args){
  need(exact(args,'scope')&&args.scope===project,403,'NGS_FILE_SYNC_SCOPE_DENIED');
  const syncId='ngs.sync.'+makeId(),inventoryAt=now();
  await run(`INSERT INTO ${passes}(sync_id,baseline,expiry) VALUES(?,(SELECT COALESCE(MAX(version),0) FROM ${entries}),?)`,syncId,inventoryAt+inactivity);
  try{await collectExpired();return {syncId,scope:project,inventoryAt,files:await list()};}
  catch(e){await run(`DELETE FROM ${passes} WHERE sync_id=?`,syncId);throw e;}
 }
 async function createTransfer(session,path,sha256,size,epoch){
  const {prior,sha256:previous,size:previousSize}=await activePrior(path,session);
  const same=previous===sha256&&size===previousSize,attempt=makeId();
  const multipart=!same&&size>chunkSize?await bucket.createMultipartUpload(objectKey(attempt),{customMetadata:{sha256}}):null;
  let changed;
  try{
   changed=await run(`INSERT INTO ${receives}(sync_id,path,attempt,sha256,size,prior,generation,upload_id,received,parts,last_sha,same)
    SELECT ?,?,?,?,?,?,?,?,0,'[]',NULL,? WHERE EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?)
    AND COALESCE((SELECT generation FROM ${resets} WHERE sync_id=? AND path=?),0)=?
    ON CONFLICT(sync_id,path) DO NOTHING`,session.sync_id,path,attempt,sha256,size,prior,epoch,multipart?.uploadId??null,same?1:0,
    session.sync_id,now(),session.sync_id,path,epoch);
  }finally{if(!changed&&multipart)await multipart.abort().catch(()=>{});}
  const row=await transfer(session.sync_id,path);if(!row)stale();return row;
 }
 async function putStage(f,offset,data,sha256){
  const key=stageKey(f.attempt,offset);
  const o=await bucket.put(key,data,{sha256,onlyIf:noOverwrite(),customMetadata:{sha256}});
  if(!o){
   const old=await bucket.head(key);
   if(old?.customMetadata?.sha256!==sha256||old.size!==data.byteLength)content();
  }
 }
 async function uploadPart(f,start,end,partNumber){
  const fixed=fixedLengthStream(end-start);
  let offset=start;
  const source=new ReadableStream({async pull(controller){
   try{
    if(offset===end){controller.close();return;}
    const item=await bucket.get(stageKey(f.attempt,offset));
    const length=Math.min(chunkSize,end-offset);
    if(!item?.body||item.size!==length)throw Error('NGS_FILE_SYNC_INCOMPLETE');
    const data=new Uint8Array(await item.arrayBuffer());
    if(data.byteLength!==length)throw Error('NGS_FILE_SYNC_INCOMPLETE');
    controller.enqueue(data);offset+=length;
   }catch(e){controller.error(e);}
  }});
  const multipart=bucket.resumeMultipartUpload(objectKey(f.attempt),f.upload_id);
  const [part]=await Promise.all([writePart(multipart,partNumber,fixed.readable,end-start),source.pipeTo(fixed.writable)]);
  return part;
 }
 async function stageCleanup(f){
  if(!f?.upload_id)return;
  let cursor;
  do{
   const batch=await bucket.list({prefix:stage+f.attempt+'/',limit:1000,cursor});
   if(batch.objects.length)await bucket.delete(batch.objects.map(o=>o.key));
   if(!batch.truncated)return;
   if(!batch.cursor||batch.cursor===cursor)unavailable();cursor=batch.cursor;
  }while(true);
 }
 async function releaseTemp(f){
  if(!f||f.same)return;
  if(f.upload_id)await bucket.resumeMultipartUpload(objectKey(f.attempt),f.upload_id).abort().catch(()=>{});
  await stageCleanup(f).catch(()=>{});
  // Never delete a candidate selected by the durable pointer, even after an uncertain response.
  const published=await first(`SELECT 1 AS visible FROM ${entries} WHERE object_key=? LIMIT 1`,objectKey(f.attempt));
  if(!published)await bucket.delete(objectKey(f.attempt));
 }
 async function verifyLarge(f,parts){
  const key=objectKey(f.attempt),multipart=bucket.resumeMultipartUpload(key,f.upload_id);
  let item=await bucket.head(key);
  if(!item){
   try{item=await multipart.complete(parts);}catch(e){item=await bucket.head(key);if(!item)throw e;}
  }
  if(item.size!==f.size||item.customMetadata?.sha256!==f.sha256)content();
  const body=await bucket.get(key,{onlyIf:{etagMatches:item.etag}});
  if(!body?.body)content();
  const hasher=createHash('sha256');let length=0,initial;
  for await(const bytes of body.body){
   if(!initial)initial=bytes.subarray(0,Math.min(16,bytes.length));
   length+=bytes.length;if(length>f.size)content();hasher.update(bytes);
  }
  if(length!==f.size||hasher.digest('hex')!==f.sha256)content();
  if(f.path==='icon.png')headerCheck(f.path,initial??new Uint8Array());
 }
 async function publish(f,session){
  if(!f.same){
   const changed=await run(`INSERT INTO ${entries}(path,sha256,object_key,size,sync_id,last_sha)
    SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?)
    AND EXISTS(SELECT 1 FROM ${receives} WHERE sync_id=? AND path=? AND attempt=? AND received=size)
    AND COALESCE((SELECT MAX(version) FROM ${entries} WHERE path=?),0)=?`,f.path,f.sha256,objectKey(f.attempt),f.size,session.sync_id,f.last_sha,
    session.sync_id,now(),session.sync_id,f.path,f.attempt,f.path,f.prior);
   if(!changed){
    const live=await current(f.path);
    if(live?.object_key!==objectKey(f.attempt))stale();
   }
   await run(`DELETE FROM ${receives} WHERE sync_id=? AND path=? AND attempt=?`,session.sync_id,f.path,f.attempt);
  }else{
   const live=await current(f.path);
   if((live?.version??0)!==f.prior)stale();
  }
  return {nextOffset:null};
 }
 async function send(args,session,verifiedBytes){
  need(exact(args,'syncId','path','sha256','size','offset','dataBase64')&&pathOK(args.path)&&hash(args.sha256)&&
   safeInt(args.size,0,headerBound(args.path))&&safeInt(args.offset,0,args.size)&&args.offset%chunkSize===0);
  const {path,sha256,size,offset}=args,data=verifiedBytes??decoded(args.dataBase64),chunkHash=verifiedBytes?sha256:digest(data);
  need(data.byteLength===Math.min(chunkSize,size-offset)&&(size===0||offset<size));
  const next=offset+data.byteLength,final=next===size;
  const epoch=(await generation(session.sync_id,path))?.generation??0;
  let f=await transfer(session.sync_id,path);
  if(!f){
   if(final){
    const live=await current(path);
    if(live?.object_key&&live.sync_id===session.sync_id&&live.sha256===sha256&&live.size===size&&live.last_sha===chunkHash)
     return {nextOffset:null};
   }
   if(offset!==0)badOffset();f=await createTransfer(session,path,sha256,size,epoch);
  }
  if(f.generation!==epoch||f.sha256!==sha256||f.size!==size)badOffset();
  if(f.received!==offset){
   if(f.received!==next||f.last_sha!==chunkHash)badOffset();
   if(!final)return {nextOffset:next};
   const live=await current(path);
   if(!f.same&&live?.object_key===objectKey(f.attempt))return {nextOffset:null};
  }else{
   let parts=JSON.parse(f.parts);
   if(!f.same){
    if(!f.upload_id){
     if(chunkHash!==sha256)content();
     headerCheck(path,data);
     const key=objectKey(f.attempt),item=await bucket.put(key,data,{sha256,onlyIf:noOverwrite(),customMetadata:{sha256}});
     if(!item&&(await bucket.head(key))?.customMetadata?.sha256!==sha256)content();
    }else{
     await putStage(f,offset,data,chunkHash);
     const width=partSize(size);
     if(final||next%width===0){
      const first=Math.floor(offset/width)*width;
      const part=await uploadPart(f,first,next,Math.floor(offset/width)+1);
      parts=[...parts,part];
     }
    }
   }
   const changed=await run(`UPDATE ${receives} SET received=?,parts=?,last_sha=?
    WHERE sync_id=? AND path=? AND attempt=? AND received=?`,
    next,JSON.stringify(parts),chunkHash,session.sync_id,path,f.attempt,offset);
   const nextRow=await transfer(session.sync_id,path);
   if(!nextRow||nextRow.attempt!==f.attempt||nextRow.received!==next||nextRow.last_sha!==chunkHash){
    const live=final&&!f.same&&await current(path);
    if(live?.object_key===objectKey(f.attempt))return {nextOffset:null};
    stale();
   }
   f=nextRow;
   if(changed&&f.upload_id&&(final||next%partSize(size)===0)){
    const width=partSize(size),first=Math.floor(offset/width)*width;
    const keys=Array.from({length:Math.ceil((next-first)/chunkSize)},(_,i)=>stageKey(f.attempt,first+i*chunkSize));
    // R2 delete accepts at most 1000 keys. These are private uploaded chunks only.
    for(let i=0;i<keys.length;i+=1000)await bucket.delete(keys.slice(i,i+1000)).catch(()=>{});
   }
  }
  if(!final)return {nextOffset:next};
  if(f.upload_id)await verifyLarge(f,JSON.parse(f.parts));
  return await publish(f,session);
 }
 function batchPreflight(args){
  need(exact(args,'syncId','files')&&Array.isArray(args.files)&&
   args.files.length>=1&&args.files.length<=objectReplicaBatchFiles);
  const paths=new Set();
  let rawBytes=0;
  return args.files.map(row=>{
   need(exact(row,'path','sha256','size','dataBase64')&&pathOK(row.path)&&hash(row.sha256)&&
    safeInt(row.size,0,Math.min(chunkSize,headerBound(row.path)))&&!paths.has(row.path));
   paths.add(row.path);
   const bytes=decoded(row.dataBase64);
   rawBytes+=bytes.length;
   need(bytes.length===row.size&&rawBytes<=objectReplicaBatchRawBytes);
   return {row,bytes};
  });
 }
 async function sendBatch(files,session){
  const results=[];
  // The envelope is already structurally checked in full. The existing
  // per-file commit and progress rules still apply, in input order.
  for(const {row,bytes} of files){
   const {path,sha256}=row;
   try{
    // Also validate when the replica already held these bytes, where send()
    // can otherwise accept an idempotent same-object acknowledgement.
    if(digest(bytes)!==sha256)content();
    const result=await send({syncId:session.sync_id,...row,offset:0},session,bytes);
    if(result.nextOffset!==null)unavailable();
    results.push({path,sha256,status:'accepted'});
   }catch(e){
    const code=batchErrors.get(e?.message)===e?.status&&typeof e?.status==='number'?e.message:'NGS_FILE_SYNC_UNAVAILABLE';
    results.push({path,sha256,status:'failed',code});
   }
  }
  return {results};
 }
 async function resetFile(args,session){
  need(exact(args,'syncId','path')&&pathOK(args.path));
  const id=session.sync_id,path=args.path;
  // This short SQL transaction also fences requests that observed the old
  // generation but have not yet installed their temporary transfer row.
  const [old]=await db.batch([
   stmt(`SELECT * FROM ${receives} WHERE sync_id=? AND path=?`,id,path),
   stmt(`INSERT INTO ${resets}(sync_id,path,generation) VALUES(?,?,1) ON CONFLICT(sync_id,path)
    DO UPDATE SET generation=generation+1`,id,path),
   stmt(`DELETE FROM ${receives} WHERE sync_id=? AND path=?`,id,path),
  ]);
  await releaseTemp(old.results[0]).catch(()=>{});
  return {ok:true};
 }
 async function removeFile(args,session){
  need(exact(args,'syncId','path','sha256')&&pathOK(args.path)&&hash(args.sha256));
  const existing=await current(args.path);
  if(existing?.sync_id===session.sync_id&&!existing.object_key&&existing.sha256===args.sha256)return {removed:false};
  const {prior,sha256,size}=await activePrior(args.path,session);
  if(sha256!==args.sha256)stale();
  const changed=await run(`INSERT INTO ${entries}(path,sha256,object_key,size,sync_id)
   SELECT ?,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?)
   AND COALESCE((SELECT MAX(version) FROM ${entries} WHERE path=?),0)=?`,
   args.path,sha256,size,session.sync_id,session.sync_id,now(),args.path,prior);
  if(!changed)stale();
  return {removed:true};
 }
 async function clearPassTransfers(id){
  const pending=await all(`SELECT * FROM ${receives} WHERE sync_id=?`,id);
  await run(`DELETE FROM ${receives} WHERE sync_id=?`,id);
  await run(`DELETE FROM ${resets} WHERE sync_id=?`,id);
  for(const f of pending)await releaseTemp(f).catch(()=>{});
 }
 async function close(name,id){
  // End the pass before cleanup; other passes and readers remain available.
  await run(`DELETE FROM ${passes} WHERE sync_id=?`,id);
  await clearPassTransfers(id);
  if(name===abort)return {ok:true};
  const answer=await first(`SELECT COUNT(*) AS written FROM ${entries} WHERE sync_id=? AND object_key IS NOT NULL`,id);
  return {ok:true,written:answer.written};
 }
 async function call(name,args){
  ready();need(names.has(name),404,'NGS_FILE_SYNC_TOOL_UNKNOWN');
  if(name===begin)return await start(args);
  need(syncOK(args?.syncId));
  const batch=name===objectReplicaBatchTool?batchPreflight(args):null;
  const session=await loadSession(args.syncId);
  await run(`UPDATE ${passes} SET expiry=? WHERE sync_id=? AND expiry>?`,now()+inactivity,args.syncId,now());
  if(name===chunk)return await send(args,session);
  if(batch)return await sendBatch(batch,session);
  if(name===reset)return await resetFile(args,session);
  if(name===remove)return await removeFile(args,session);
  need(exact(args,'syncId'));
  return await close(name,args.syncId);
 }
 return {call,list,head,get};
}
