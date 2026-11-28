/** Shared object replica: temporary data becomes visible only through the version CAS. */
import {createHash} from 'node:crypto';
import {audioIndexPath,audioSummaryLimit,createAudioResultIndex,readAudioIndexBytes} from './audio-result-index.mjs';
import {wholeFileObjectMaximum} from './replica-whole-file-wire.mjs';
const project='binari',defaultNamespace='ngs-replica/v1/binari/';
const passes='ngs_replica_pass_v2',receives='ngs_replica_receive_v2',entries='ngs_replica_version_v2',resets='ngs_replica_reset_v2';
const progressRows='ngs_replica_progress_v1',progressResults='ngs_replica_progress_item_v1';
const inactivity=60*60_000,maxPaths=32768,maxInventoryBytes=16*1024*1024;
export const objectReplicaChunkSize=1024*1024;
const chunkSize=objectReplicaChunkSize,minPart=5*chunkSize,maxParts=10000,wholeTransfer='whole';
// Shared wire tolerates the full supported R2 object range, not a product size cap.
const nativeObjectMaximum=5*1024**4-5*1024**3;
const npcPngCacheLimit=4*1024*1024,npcPngCacheAge=600;
const pngMagic=[137,80,78,71,13,10,26,10];
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
 tool('ngs_file_sync_plan','Set the changed-file count once for the active serial pass.',{syncId:string,totalFiles:{type:'integer',minimum:0,maximum:maxPaths}}),
 tool('ngs_file_sync_file_failed','Record one exhausted and unpublished file once.',{syncId:string,path:string}),
 tool(reset,'Discard one incomplete file transfer. Its live replica is not altered.',{syncId:string,path:string}),
 tool(remove,'Hide one digest-matched replica file without deleting its earlier bytes.',{syncId:string,path:string,sha256:string}),
 tool(finish,'Close a replica sync pass; report files committed by it.',{syncId:string}),
 tool(abort,'Cancel unfinished replica transfers without altering live files.',{syncId:string}),
]);
const names=new Set(objectReplicaSyncTools.map(t=>t.name));
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
 writePart=(upload,part,body)=>upload.uploadPart(part,body),
 writeWhole=(bucket,key,body,size,options)=>bucket.put(key,body,options),namespace=defaultNamespace,cacheOrigin}={}){
 if(typeof namespace!=='string'||!/^(?:[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/){1,8}$/u.test(namespace))unavailable();
 const audioIndex=createAudioResultIndex(db);
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

 // Private cache: only a route-authorized, published and hash-pinned PNG.
 // Cache API eviction or failure is a miss; it never replaces origin proof.
 async function readVerifiedPng(path,sha256,max){
  if(typeof cacheOrigin!=='string'||!globalThis.caches?.open)return undefined;
  ready();need(pathOK(path)&&/^npcs\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\/assets\/.+\.png$/u.test(path)&&
   hash(sha256)&&safeInt(max,1,8*1024*1024));
  const committed=await current(path);
  if(!committed)return undefined; // Unversioned legacy files follow the usual read.
  if(!committed.object_key)return null;
  if(committed.sha256!==sha256)throw Object.assign(Error('NPC_WORKSPACE_MEDIA_CHANGED'),{status:409});
  const pinned=expectedObject(await bucket.head(committed.object_key),committed);
  const valid=body=>body.byteLength===pinned.size&&pngMagic.every((v,i)=>body[i]===v)&&digest(body)===sha256;
  const unchanged=async()=>{
   const latest=await current(path);
   if(latest?.version!==committed.version||latest?.object_key!==committed.object_key||latest?.sha256!==sha256)
    throw Object.assign(Error('NPC_WORKSPACE_MEDIA_CHANGED'),{status:409});
  };
  if(!pinned||pinned.size>max)unavailable();
  let cache,key,bytes;
  if(pinned.size<=npcPngCacheLimit){
   try{
    // No auth or browser request headers enter this cache key or value.
    const identity=digest(encoder.encode(JSON.stringify([namespace,sha256,pinned.etag])));
    key=new Request(new URL('/.ngs-private-cache/v1/png/'+identity,cacheOrigin));
    cache=await globalThis.caches.open('ngs-private-npc-png-v1');
    const hit=await cache.match(key);
    if(hit){
     if(hit.status===200&&hit.headers.get('Content-Length')===String(pinned.size)&&
        hit.headers.get('Content-Type')==='image/png'){
      const value=new Uint8Array(await hit.arrayBuffer());
      if(valid(value))bytes=value;
     }else void hit.body?.cancel().catch(()=>{});
    }
   }catch{/* Optional cache; read current origin below. */}
  }
  if(bytes){await unchanged();return bytes;}
  const object=expectedObject(await bucket.get(committed.object_key,{onlyIf:{etagMatches:pinned.etag}}),committed);
  if(object?.etag!==pinned.etag||typeof object?.arrayBuffer!=='function')unavailable();
  bytes=new Uint8Array(await object.arrayBuffer());
  if(!valid(bytes))unavailable();
  await unchanged();
  if(cache&&key){
   try{await cache.put(key,new Response(bytes,{headers:{'Content-Type':'image/png',
    'Content-Length':String(bytes.byteLength),'Cache-Control':'public, max-age='+npcPngCacheAge}}));}
   catch{/* Browser authorized bytes do not depend on cache storage. */}
  }
  return bytes;
 }
 async function list(scope='',includeSize=false){
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
    if(item.customMetadata.removed!=='1')files.set(path,{sha256:item.customMetadata.sha256,size:item.size});
   }
   if(!page.truncated)break;
   if(!page.cursor||cursor===page.cursor)unavailable();cursor=page.cursor;
  }while(true);
  const published=await all(`SELECT v.path,v.sha256,v.object_key,v.size FROM ${entries} v
   JOIN (SELECT path,MAX(version) AS newest FROM ${entries} ${scope?'WHERE path>=? AND path<?':''} GROUP BY path) x
    ON v.path=x.path AND v.version=x.newest
   LIMIT ${maxPaths+1}`,...(scope?[subtree,high]:[]));
  if(published.length>maxPaths)unavailable();
  for(const row of published){
   if(!pathOK(row.path)||!row.path.startsWith(subtree)||!hash(row.sha256))unavailable();
   if(row.object_key){
    if(includeSize&&!safeInt(row.size,0,nativeObjectMaximum))unavailable();
    files.set(row.path,{sha256:row.sha256,size:row.size});
   }else files.delete(row.path);
  }
  let bytes=2;
  if(files.size>maxPaths)unavailable();
  return [...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,{sha256,size}])=>{
   const item=includeSize?{path,sha256,size}:{path,sha256};bytes+=encoder.encode(JSON.stringify(item)).length+1;
   if(bytes>maxInventoryBytes)unavailable();return item;
  });
 }

 // Shared response cache, never used by file-sync writes or its inventories.
 // Keys are fixed slots and not replica files; stored generation must match.
 const npcCacheRoot=namespace+'v2/npc-read-cache-v1/';
 const npcCacheLimit=8*1024*1024;
 // Some S3-compatible stores drop empty user metadata headers. A stable
 // non-empty roster scope works for both object providers.
 const npcCacheRosterScope='roster';
 const npcCacheKey=npcId=>{
  if(npcId===null)return npcCacheRoot+'roster';
  need(typeof npcId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(npcId));
  return npcCacheRoot+'detail/'+digest(encoder.encode(npcId)).slice(0,2);
 };
 const npcCache=Object.freeze({
  async version(){
   ready();
   // The path/version index bounds this to committed NPC records, including
   // deletions, never other projects, audio, staged uploads or pending writes.
   const row=await first(`SELECT MAX(version) AS version FROM ${entries} WHERE path>=? AND path<?`,'npcs/','npcs0');
   return safeInt(row?.version,1,Number.MAX_SAFE_INTEGER)?row.version:null;
  },
  async read(npcId,version){
   ready();
   const row=await bucket.get(npcCacheKey(npcId));
   if(!row)return null;
   const meta=row.customMetadata;
   if(meta?.generation!==String(version)||meta?.scope!==(npcId??npcCacheRosterScope)||!hash(meta?.sha256)||
      !safeInt(row.size,2,npcCacheLimit)||typeof row.arrayBuffer!=='function'){
    void row.body?.cancel().catch(()=>{});
    return null;
   }
   const bytes=new Uint8Array(await row.arrayBuffer());
   if(bytes.length!==row.size||digest(bytes)!==meta.sha256)return null;
   return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  },
  async store(npcId,version,value){
   ready();
   const bytes=encoder.encode(JSON.stringify(value));
   if(!safeInt(bytes.byteLength,2,npcCacheLimit))return;
   const sha256=digest(bytes);
   // Published state can change while JSON was projected. Old cache objects
   // are never eligible, even if an older writer finishes its put after this.
   if(await npcCache.version()!==version)return;
   await bucket.put(npcCacheKey(npcId),bytes,{sha256,customMetadata:{sha256,generation:String(version),scope:npcId??npcCacheRosterScope}});
  },
 });
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
   if(fenced){await settleProgress(sync_id,false);await clearPassTransfers(sync_id);}
  }
 }
 async function start(args){
  need(exact(args,'scope')&&args.scope===project,403,'NGS_FILE_SYNC_SCOPE_DENIED');
  const syncId='ngs.sync.'+makeId(),inventoryAt=now();
  await run(`INSERT INTO ${passes}(sync_id,baseline,expiry) VALUES(?,(SELECT COALESCE(MAX(version),0) FROM ${entries}),?)`,syncId,inventoryAt+inactivity);
  try{
   await collectExpired();
   const files=await list();
   await audioIndex.backfill(files,head,get);
   return {syncId,scope:project,inventoryAt,files};
  }
  catch(e){await run(`DELETE FROM ${passes} WHERE sync_id=?`,syncId);throw e;}
 }
 async function createTransfer(session,path,sha256,size,epoch,whole=false){
  const {prior,sha256:previous,size:previousSize}=await activePrior(path,session);
  const same=previous===sha256&&size===previousSize,attempt=makeId();
  const multipart=!whole&&!same&&size>chunkSize?await bucket.createMultipartUpload(objectKey(attempt),{customMetadata:{sha256}}):null;
  let changed;
  try{
   changed=await run(`INSERT INTO ${receives}(sync_id,path,attempt,sha256,size,prior,generation,upload_id,received,parts,last_sha,same)
    SELECT ?,?,?,?,?,?,?,?,0,?,NULL,? WHERE EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?)
    AND COALESCE((SELECT generation FROM ${resets} WHERE sync_id=? AND path=?),0)=?
    ON CONFLICT(sync_id,path) DO NOTHING`,session.sync_id,path,attempt,sha256,size,prior,epoch,multipart?.uploadId??null,whole?wholeTransfer:'[]',same?1:0,
    session.sync_id,now(),session.sync_id,path,epoch);
  }finally{if(!changed&&multipart)await multipart.abort().catch(()=>{});}
  if(whole&&!changed)stale();
  const row=await transfer(session.sync_id,path);if(!row||whole&&row.attempt!==attempt)stale();return row;
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
 const progressCapacity=`(NOT EXISTS(SELECT 1 FROM ${progressRows} WHERE sync_id=?)
   OR EXISTS(SELECT 1 FROM ${progressRows} WHERE sync_id=? AND state='syncing' AND completed+failed<total)
   OR EXISTS(SELECT 1 FROM ${progressResults} WHERE sync_id=? AND path=? AND state='completed'))`;
 const persistDone=(f,id,guard,...bindings)=>stmt(`INSERT INTO ${progressResults}(sync_id,path,state)
  SELECT ?,?,'completed' WHERE EXISTS(SELECT 1 FROM ${progressRows} WHERE sync_id=? AND state='syncing')
  AND (${guard}) ON CONFLICT(sync_id,path) DO NOTHING`,id,f.path,id,...bindings);
 async function publish(f,session,metadataBytes){
  const id=session.sync_id,capacity=[id,id,id,f.path];
  if(!f.same){
   const key=objectKey(f.attempt);
   const audioPath=audioIndexPath(f.path);
   const audioSummary=audioPath?.[2]==='metadata.json'?readAudioIndexBytes(metadataBytes,audioPath[1],f.sha256):null;
   const [appended]=await db.batch([
    stmt(`INSERT INTO ${entries}(path,sha256,object_key,size,sync_id,last_sha)
     SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?)
     AND EXISTS(SELECT 1 FROM ${receives} WHERE sync_id=? AND path=? AND attempt=? AND received=size)
     AND COALESCE((SELECT MAX(version) FROM ${entries} WHERE path=?),0)=?
     AND ${progressCapacity} AND NOT EXISTS(SELECT 1 FROM ${progressResults} WHERE sync_id=? AND path=? AND state='failed')`,
     f.path,f.sha256,key,f.size,id,f.last_sha,id,now(),id,f.path,f.attempt,f.path,f.prior,...capacity,id,f.path),
    persistDone(f,id,`EXISTS(SELECT 1 FROM ${entries} WHERE object_key=?)`,key),
    ...audioIndex.publish(f.path,audioSummary,key),
   ]);
   if(!appended.meta.changes){
    const live=await current(f.path);
    if(live?.object_key!==key)stale();
   }
   await run(`DELETE FROM ${receives} WHERE sync_id=? AND path=? AND attempt=?`,id,f.path,f.attempt);
  }else{
   const live=await current(f.path);
   if((live?.version??0)!==f.prior)stale();
   await db.batch([persistDone(f,id,`EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?)
    AND EXISTS(SELECT 1 FROM ${receives} WHERE sync_id=? AND path=? AND attempt=? AND received=size)
    AND COALESCE((SELECT MAX(version) FROM ${entries} WHERE path=?),0)=? AND ${progressCapacity}`,
    id,now(),id,f.path,f.attempt,f.path,f.prior,...capacity)]);
   const tracked=await first(`SELECT state FROM ${progressRows} WHERE sync_id=?`,id);
   if(tracked&&(await first(`SELECT state FROM ${progressResults} WHERE sync_id=? AND path=?`,id,f.path))?.state!=='completed')stale();
  }
  return {nextOffset:null};
 }
 async function send(args,session){
  need(exact(args,'syncId','path','sha256','size','offset','dataBase64')&&pathOK(args.path)&&hash(args.sha256)&&
   safeInt(args.size,0,headerBound(args.path))&&safeInt(args.offset,0,args.size)&&args.offset%chunkSize===0);
  const {path,sha256,size,offset}=args,data=decoded(args.dataBase64),chunkHash=digest(data);
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
  if(f.parts===wholeTransfer||f.generation!==epoch||f.sha256!==sha256||f.size!==size)badOffset();
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
  return await publish(f,session,offset===0?data:null);
 }
 async function receiveWholeFile(args,body){
  ready();
  need(exact(args,'syncId','path','sha256','size')&&syncOK(args.syncId)&&pathOK(args.path)&&hash(args.sha256)&&
    safeInt(args.size,0,Number.MAX_SAFE_INTEGER));
  const {syncId:id,path,sha256,size}=args;
  need(size<=wholeFileObjectMaximum&&size<=headerBound(path),413,'NGS_FILE_SYNC_BODY_TOO_LARGE');
  need(body instanceof ReadableStream);
  const session=await loadSession(id);
  const selected=await first(`SELECT total,state FROM ${progressRows} WHERE sync_id=?`,id);
  if(!selected||selected.state!=='syncing'||selected.total<1)stale();
  await run(`UPDATE ${passes} SET expiry=? WHERE sync_id=? AND expiry>?`,now()+inactivity,id,now());
  const existing=await current(path);
  const replay=existing?.object_key&&existing.sync_id===id&&existing.sha256===sha256&&existing.size===size;
  let transferRow;
  if(!replay){
   const epoch=(await generation(id,path))?.generation??0;
   if(await transfer(id,path))badOffset();
   transferRow=await createTransfer(session,path,sha256,size,epoch,true);
  }
  // Stream verified input into at most one private provider PUT. The live
  // pointer and completed counter stay untouched until the whole body checks.
  const needsPut=!!transferRow&&!transferRow.same;
  const fixed=needsPut&&size>0?fixedLengthStream(size):null;
  const reader=body.getReader();
  const digest=createHash('sha256');
  const audioMetadata=audioIndexPath(path)?.[2]==='metadata.json';
  const header=new Uint8Array(path==='project.json'||audioMetadata&&size<=audioSummaryLimit?size:path==='icon.png'?Math.min(8,size):0);
  let seen=0,checked=now(),checkpoint=0,validationError;
  async function progressBytes(){
   if(!transferRow||seen>=size||seen-checkpoint<chunkSize||now()-checked<1000)return;
   const updated=await run(`UPDATE ${receives} SET received=? WHERE sync_id=? AND path=? AND attempt=?`,
    seen,id,path,transferRow.attempt);
   if(!updated)stale();
   checked=now();checkpoint=seen;
  }
  const observed=new ReadableStream({async pull(controller){
   try{
    const {done,value}=await reader.read();
    if(done){
     if(seen!==size||digest.digest('hex')!==sha256)content();
     headerCheck(path,header);controller.close();return;
    }
    if(!(value instanceof Uint8Array)||value.byteLength>size-seen)content();
    if(seen<header.length)header.set(value.subarray(0,header.length-seen),seen);
    seen+=value.byteLength;digest.update(value);
    await progressBytes();
    controller.enqueue(value);
   }catch(e){validationError=e;controller.error(e);}
  },cancel:reason=>reader.cancel(reason)});
  const aborter=new AbortController();
  try{
   const flow=observed.pipeTo(fixed?.writable??new WritableStream(),{signal:aborter.signal});
   let saved;
   if(needsPut&&size>0){
    [saved]=await Promise.all([Promise.resolve().then(()=>writeWhole(bucket,objectKey(transferRow.attempt),fixed.readable,size,
     {sha256,onlyIf:noOverwrite(),customMetadata:{sha256}})),flow]);
   }else{
    await flow;
    if(needsPut)saved=await bucket.put(objectKey(transferRow.attempt),new Uint8Array(),
     {sha256,onlyIf:noOverwrite(),customMetadata:{sha256}});
   }
   if(replay)return {ok:true};
   if(needsPut){
    if(!saved)stale();
    if(saved.size!==size||saved.customMetadata?.sha256!==sha256)content();
   }
   if(!await run(`UPDATE ${receives} SET received=?,last_sha=? WHERE sync_id=? AND path=? AND attempt=? AND parts=?`,
      size,sha256,id,path,transferRow.attempt,wholeTransfer))stale();
   await publish({...transferRow,last_sha:sha256},session,audioMetadata&&size<=audioSummaryLimit?header:null);
   return {ok:true};
  }catch(e){
   aborter.abort();
   // A reset/failed/abort or pass expiry fences the temporary attempt; on
   // an uncertain transport outcome never delete a possibly published object.
   throw validationError??e;
  }finally{
   void reader.cancel().catch(()=>{});
   // Release only after the asynchronous producer has surrendered pending reads.
   try{reader.releaseLock();}catch{}
  }
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
  const [changed]=await db.batch([stmt(`INSERT INTO ${entries}(path,sha256,object_key,size,sync_id)
   SELECT ?,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?)
   AND COALESCE((SELECT MAX(version) FROM ${entries} WHERE path=?),0)=?`,
   args.path,sha256,size,session.sync_id,session.sync_id,now(),args.path,prior),
   ...audioIndex.remove(args.path,sha256,session.sync_id)]);
  if(!changed.meta.changes)stale();
  return {removed:true};
 }
 async function planProgress(args,session){
  need(exact(args,'syncId','totalFiles')&&safeInt(args.totalFiles,0,maxPaths));
  const id=session.sync_id;
  const discard=`SELECT sync_id FROM ${progressRows} WHERE state<>'syncing' AND sync_id NOT IN
   (SELECT sync_id FROM ${progressRows} WHERE total>0 ORDER BY rowid DESC LIMIT 4)`;
  const [,,inserted]=await db.batch([
   stmt(`DELETE FROM ${progressResults} WHERE sync_id IN (${discard})`),
   stmt(`DELETE FROM ${progressRows} WHERE sync_id IN (${discard})`),
   stmt(`INSERT INTO ${progressRows}(sync_id,total) SELECT ?,? WHERE
    EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?) ON CONFLICT(sync_id) DO NOTHING`,id,args.totalFiles,id,now()),
  ]);
  if(!inserted.meta.changes&&(await first(`SELECT total FROM ${progressRows} WHERE sync_id=?`,id))?.total!==args.totalFiles)stale();
  return {ok:true};
 }
 async function recordFailed(args,session){
  need(exact(args,'syncId','path')&&pathOK(args.path));
  const id=session.sync_id,path=args.path;
  const marked=await run(`INSERT INTO ${progressResults}(sync_id,path,state)
   SELECT ?,?,'failed' WHERE EXISTS(SELECT 1 FROM ${passes} WHERE sync_id=? AND expiry>?)
   AND EXISTS(SELECT 1 FROM ${progressRows} WHERE sync_id=? AND state='syncing' AND completed+failed<total)
   AND NOT EXISTS(SELECT 1 FROM ${entries} WHERE sync_id=? AND path=? AND object_key IS NOT NULL)
   ON CONFLICT(sync_id,path) DO NOTHING`,id,path,id,now(),id,id,path);
  if(!marked&&(await first(`SELECT state FROM ${progressResults} WHERE sync_id=? AND path=?`,id,path))?.state!=='failed')stale();
  return {ok:true};
 }
 function finalizeProgressStatement(id,finished){
  return stmt(`UPDATE ${progressRows} SET state=CASE WHEN ?=1 AND completed=total AND failed=0
   THEN 'completed' WHEN completed>0 THEN 'partial' ELSE 'failed' END WHERE sync_id=? AND state='syncing'`,finished?1:0,id);
 }
 const settleProgress=(id,finished)=>finalizeProgressStatement(id,finished).run();
 async function progress(){
  ready();
  const row=await first(`SELECT p.sync_id,p.state,p.total,p.completed,p.failed,s.expiry FROM ${progressRows} p
   LEFT JOIN ${passes} s ON p.sync_id=s.sync_id WHERE p.total>0 ORDER BY p.rowid DESC LIMIT 1`);
  if(!row)return {state:'idle',fileName:null,percent:null,completed:0,total:0,failed:0};
  let {state,total,completed,failed}=row,fileName=null,percent=null;
  if(state==='syncing'&&!(row.expiry>now()))state=completed>0?'partial':'failed';
  if(state==='syncing'){
   const pending=await first(`SELECT r.path,r.size,r.received FROM ${receives} r WHERE r.sync_id=?
    AND NOT EXISTS(SELECT 1 FROM ${progressResults} x WHERE x.sync_id=r.sync_id AND x.path=r.path)
    ORDER BY r.rowid DESC LIMIT 1`,row.sync_id);
   if(pending){
    fileName=pending.path.split('/').at(-1).replace(/[\p{Cc}\p{Cf}]/gu,'')||null;
    percent=pending.size>0?Math.min(99,Math.floor(100*pending.received/pending.size)):0;
   }
  }else if(state==='completed')percent=100;
  else failed=Math.max(failed,total-completed);
  return {state,fileName,percent,completed,total,failed};
 }
 async function clearPassTransfers(id){
  const pending=await all(`SELECT * FROM ${receives} WHERE sync_id=?`,id);
  await run(`DELETE FROM ${receives} WHERE sync_id=?`,id);
  await run(`DELETE FROM ${resets} WHERE sync_id=?`,id);
  for(const f of pending)await releaseTemp(f).catch(()=>{});
 }
 async function close(name,id){
  // End the pass before cleanup; other passes and readers remain available.
  await db.batch([finalizeProgressStatement(id,name===finish),stmt(`DELETE FROM ${passes} WHERE sync_id=?`,id)]);
  await clearPassTransfers(id);
  if(name===abort)return {ok:true};
  const answer=await first(`SELECT COUNT(*) AS written FROM ${entries} WHERE sync_id=? AND object_key IS NOT NULL`,id);
  return {ok:true,written:answer.written};
 }
 async function call(name,args){
  ready();need(names.has(name),404,'NGS_FILE_SYNC_TOOL_UNKNOWN');
  if(name===begin)return await start(args);
  need(syncOK(args?.syncId));
  const session=await loadSession(args.syncId);
  await run(`UPDATE ${passes} SET expiry=? WHERE sync_id=? AND expiry>?`,now()+inactivity,args.syncId,now());
  if(name===chunk)return await send(args,session);
  if(name==='ngs_file_sync_plan')return await planProgress(args,session);
  if(name==='ngs_file_sync_file_failed')return await recordFailed(args,session);
  if(name===reset)return await resetFile(args,session);
  if(name===remove)return await removeFile(args,session);
  need(exact(args,'syncId'));
  return await close(name,args.syncId);
 }
 return {call,list:scope=>list(scope),listWithSizes:scope=>list(scope,true),head,get,progress,receiveWholeFile,npcCache,readVerifiedPng,audioIndex:audioIndex.read};
}
