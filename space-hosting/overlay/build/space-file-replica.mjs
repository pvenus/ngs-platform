/** Private hosted Binari replica. Callers must authorize every action at the host boundary. */
const project='binari',prefix='ngs-replica/v1/binari/',current=prefix+'files/',stage=prefix+'stage/',recovery=prefix+'recovery/';
const table='ngs_space_file_replica_sync_v1',ttl=5*60_000,maxFiles=32768,maxInventoryBytes=16*1024*1024;
export const spaceFileChunkSize=1024*1024;
const maxFile=64*spaceFileChunkSize;
const encoder=new TextEncoder();
const hash=v=>typeof v==='string'&&/^[0-9a-f]{64}$/u.test(v);
const validPath=p=>typeof p==='string'&&p.isWellFormed()&&encoder.encode(current+p).length<=1024&&p.split('/').length<=64&&
 p.split('/').every(c=>c.length&&encoder.encode(c).length<=255&&!c.startsWith('.')&&!/[\\\x00-\x1f\x7f]/u.test(c));
const validSync=v=>typeof v==='string'&&/^ngs\.sync\.[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u.test(v);
const exact=(v,...keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const need=(value,status=400,code='NGS_FILE_SYNC_INVALID')=>{if(!value)throw Object.assign(Error(code),{status});};
const stale=()=>need(false,409,'NGS_FILE_SYNC_REPLICA_CHANGED');
const string={type:'string'},integer={type:'integer',minimum:0,maximum:maxFile};
const tool=(name,description,properties)=>({name,description,inputSchema:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}});
const begin='ngs_file_sync_begin',chunk='ngs_file_sync_file_chunk',remove='ngs_file_sync_remove',finish='ngs_file_sync_finish',abort='ngs_file_sync_abort';
export const spaceFileSyncTools=Object.freeze([
 tool(begin,'Read the private Binari replica hash inventory and open a bounded sync pass.',{scope:{const:project}}),
 tool(chunk,'Submit one ordered chunk from the canonical PDS Binari scope.',{syncId:string,path:string,sha256:string,size:integer,offset:integer,dataBase64:string}),
 tool(remove,'Hide one exact obsolete replica entry after preserving immutable recovery bytes.',{syncId:string,path:string,sha256:string}),
 tool(finish,'Close the current completed replica sync.',{syncId:string}),
 tool(abort,'Discard the current incomplete replica transfer.',{syncId:string}),
]);
const names=new Set(spaceFileSyncTools.map(t=>t.name));
const shaBytes=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const sourceKey=p=>current+p;
const absent=o=>o?.customMetadata?.removed==='1';
function decoded(b64) {
 need(typeof b64==='string'&&b64.length<=4*Math.ceil(spaceFileChunkSize/3)&&/^[A-Za-z0-9+/]*={0,2}$/u.test(b64));
 let text;try{text=atob(b64);}catch{need(false);}
 need(btoa(text)===b64);
 return Uint8Array.from(text,c=>c.charCodeAt(0));
}
const integerRange=(v,a,b)=>Number.isSafeInteger(v)&&v>=a&&v<=b;
const stagedKey=(id,f,offset)=>stage+id+'/'+f.key+'/'+offset;
function trustedObject(o){
 if(!o)return null;
 need(hash(o.customMetadata?.sha256)&&typeof o.etag==='string'&&integerRange(o.size,0,maxFile),503,'NGS_FILE_SYNC_UNAVAILABLE');
 return o;
}
const byteLength=p=>p==='project.json'?64*1024:p==='icon.png'?2*spaceFileChunkSize:maxFile;
async function verifyHeader(p,file,data){
 if(p==='icon.png'){
  const rg=await data();
  need([137,80,78,71,13,10,26,10].every((v,i)=>rg[i]===v),409,'NGS_FILE_SYNC_CONTENT_MISMATCH');
 }else if(p==='project.json'){
  const u8=await data();
  let json;try{json=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(u8));}catch{}
  need(json&&typeof json==='object'&&!Array.isArray(json)&&file.size===u8.byteLength,409,'NGS_FILE_SYNC_CONTENT_MISMATCH');
 }
}

export function createSpaceFileReplica({db,bucket,now=Date.now,uuid=()=>crypto.randomUUID(),fixedLengthStream=n=>new FixedLengthStream(n)}={}){
 const ready=()=>need(db&&bucket,503,'NGS_FILE_SYNC_UNAVAILABLE');
 const statement=(q,...values)=>db.prepare(q).bind(...values);
 const state=()=>db.prepare(`SELECT * FROM ${table} WHERE slot=1`).first();
 const edit=(sql,...values)=>statement(sql,...values).run();
 const count=result=>result?.meta?.changes??0;
 async function list(){
  ready();let cursor,bytes=2;
  const files=[];
  do{
   const page=await bucket.list({prefix:current,limit:1000,include:['customMetadata'],cursor});
   for(const row of page.objects){
    const path=row.key.slice(current.length);
    need(row.key.startsWith(current)&&validPath(path)&&files.length<maxFiles,503,'NGS_FILE_SYNC_UNAVAILABLE');
    const {customMetadata:{sha256}}=trustedObject(row);
    if(absent(row))continue;
    const item={path,sha256};bytes+=encoder.encode(JSON.stringify(item)).length+1;
    need(bytes<=maxInventoryBytes,503,'NGS_FILE_SYNC_UNAVAILABLE');
    files.push(item);
   }
   if(!page.truncated)break;
   need(page.cursor&&cursor!==page.cursor,503,'NGS_FILE_SYNC_UNAVAILABLE');cursor=page.cursor;
  }while(true);
  return files;
 }
 function objectPath(path){need(validPath(path));return sourceKey(path);}
 async function rawHead(path){ready();return trustedObject(await bucket.head(objectPath(path)));}
 async function head(path){const item=await rawHead(path);return absent(item)?null:item;}
 async function get(path,options){ready();const item=trustedObject(await bucket.get(objectPath(path),options));
  if(absent(item)){void item.body?.cancel().catch(()=>{});return null;}
  if(item)need(item.body,409,'NGS_FILE_SYNC_REPLICA_CHANGED');
  return item;
 }
 async function clearUpload(id,f){
  if(!f||f.same||f.size<=spaceFileChunkSize)return;
  const keys=Array.from({length:Math.max(1,Math.ceil(f.size/spaceFileChunkSize))},(_,i)=>stagedKey(id,f,i*spaceFileChunkSize));
  await bucket.delete(keys);
 }
 async function save(row,upload,last,written,fileCount=row.file_count){
  const r=await edit(`UPDATE ${table} SET upload=?,last=?,written=?,file_count=?,expiry=? WHERE slot=1 AND sync_id=? AND lock_id=?`,
   upload?JSON.stringify(upload):null,last?JSON.stringify(last):null,written,fileCount,now()+ttl,row.sync_id,row.lock_id);
  need(count(r)===1,409,'NGS_FILE_SYNC_INVALID_SESSION');
 }
 async function ackFile(row,f,bytes,receipt){
  let changed=0;
  const live=await rawHead(f.path);
  if(absent(live)||live?.customMetadata.sha256!==f.sha256){
   if((live?.etag??null)!==f.prior)stale();
   need(!f.newEntry||row.file_count<maxFiles,503,'NGS_FILE_SYNC_UNAVAILABLE');
   const length=Math.max(1,Math.ceil(f.size/spaceFileChunkSize));
   const onlyIf=f.prior?{etagMatches:f.prior}:new Headers({'If-None-Match':'*'});
   await verifyHeader(f.path,f,async()=>{
    if(length===1)return bytes;
    const first=await bucket.get(stagedKey(row.sync_id,f,0));
    need(first?.body,409,'NGS_FILE_SYNC_INCOMPLETE');return new Uint8Array(await first.arrayBuffer());
   });
   const options={onlyIf,sha256:f.sha256,customMetadata:{sha256:f.sha256,syncId:row.sync_id}};
   let saved;
   try{
    if(length===1)saved=await bucket.put(sourceKey(f.path),bytes,options);
    else{
     let next=0;
     const parts=new ReadableStream({async pull(controller){
      try{
       if(next>=length){controller.close();return;}
       const part=await bucket.get(stagedKey(row.sync_id,f,next*spaceFileChunkSize));
       const expected=Math.min(spaceFileChunkSize,f.size-next*spaceFileChunkSize);
       if(!part?.body||part.size!==expected)throw Error('NGS_FILE_SYNC_INCOMPLETE');
       controller.enqueue(new Uint8Array(await part.arrayBuffer()));next++;
      }catch(e){controller.error(e);}
     }});
     const fixed=fixedLengthStream(f.size);
     const [put]=await Promise.all([bucket.put(sourceKey(f.path),fixed.readable,options),parts.pipeTo(fixed.writable)]);
     saved=put;
    }
   }catch(e){
    // R2's checksum check is atomic for the live key. A transport failure is
    // ambiguous: keep the staged upload so a retry can confirm by live SHA.
    const found=await head(f.path);
    if(found?.customMetadata.sha256!==f.sha256)throw e;
    saved=found;
   }
   if(!saved)stale();
   changed=1;
  }else {
   if(live.size!==f.size)stale();
   if(!f.same&&live.customMetadata.syncId===row.sync_id)changed=1;
  }
  await save(row,null,{...receipt,nextOffset:null},row.written+changed,row.file_count+(changed&&f.newEntry?1:0));
  // Failure of cleanup must never turn an already confirmed publish into an error.
  await clearUpload(row.sync_id,f).catch(()=>{});
  return {nextOffset:null};
 }
 async function send(args,row){
  need(exact(args,'syncId','path','sha256','size','offset','dataBase64')&&validPath(args.path)&&hash(args.sha256)&&
   integerRange(args.size,0,byteLength(args.path))&&integerRange(args.offset,0,args.size)&&args.offset%spaceFileChunkSize===0);
  const bytes=decoded(args.dataBase64);
  const {path,sha256,size,offset}=args;
  need(bytes.length===Math.min(spaceFileChunkSize,size-offset)&&(size===0||offset<size));
  const receipt={path,sha256,size,offset,chunkSha:await shaBytes(bytes)};
  const last=row.last&&JSON.parse(row.last);
  if(last&&Object.keys(receipt).every(k=>receipt[k]===last[k]))return {nextOffset:last.nextOffset};
  let f=row.upload&&JSON.parse(row.upload);
  if(!f){
   need(offset===0,409,'NGS_FILE_SYNC_OFFSET_INVALID');
   const existing=await rawHead(path),visible=existing&&!absent(existing);
   f={path,sha256,size,offset:0,key:uuid(),prior:existing?.etag??null,newEntry:!visible,
    same:!!visible&&existing.customMetadata.sha256===sha256&&existing.size===size};
  }
  need(f.path===path&&f.sha256===sha256&&f.size===size&&f.offset===offset,409,'NGS_FILE_SYNC_OFFSET_INVALID');
  // Persist the descriptor before writing any parts; retries reuse its key.
  if(!row.upload)await save(row,f,last,row.written);
  if(!f.same&&size>spaceFileChunkSize)await bucket.put(stagedKey(row.sync_id,f,offset),bytes,{sha256:receipt.chunkSha});
  const nextOffset=offset+bytes.length;
  if(nextOffset===size)return await ackFile(row,f,bytes,receipt);
  f.offset=nextOffset;
  await save(row,f,{...receipt,nextOffset},row.written);
  return {nextOffset};
 }
 async function removeFile(args,row){
  need(exact(args,'syncId','path','sha256')&&validPath(args.path)&&hash(args.sha256));
  if(row.upload)stale();
  const {path,sha256}=args;
  const live=await rawHead(path);
  if(!live||live.customMetadata.sha256!==sha256)stale();
  if(absent(live)){
   if(live.customMetadata.syncId!==row.sync_id)stale();
   return {removed:false};
  }
  if(live.customMetadata.syncId===row.sync_id)stale();
  const archiveKey=recovery+sha256;
  let old=await bucket.head(archiveKey);
  if(!old){
   const source=await bucket.get(sourceKey(path),{onlyIf:{etagMatches:live.etag}});
   if(!source?.body)stale();
   // Archive exact bytes before publishing a tombstone. Never expose archives as files.
   const options={onlyIf:new Headers({'If-None-Match':'*'}),sha256,customMetadata:{sha256}};
   if(live.size===0){
    await source.body.cancel();old=await bucket.put(archiveKey,new Uint8Array(),options);
   }else{
    const fixed=fixedLengthStream(live.size);
    [old]=await Promise.all([bucket.put(archiveKey,fixed.readable,options),source.body.pipeTo(fixed.writable)]);
   }
   if(!old)old=await bucket.head(archiveKey);
  }
  if(!old||old.size!==live.size||old.customMetadata?.sha256!==sha256)stale();
  const hidden=await bucket.put(sourceKey(path),new Uint8Array(),{onlyIf:{etagMatches:live.etag},
   customMetadata:{sha256,removed:'1',syncId:row.sync_id}});
  if(!hidden)stale();
  await save(row,null,null,row.written,Math.max(0,row.file_count-1));
  return {removed:true};
 }
 async function start(args){
  need(exact(args,'scope')&&args.scope===project,403,'NGS_FILE_SYNC_SCOPE_DENIED');
  const nowMs=now(),id='ngs.sync.'+uuid(),old=await state();
  need(validSync(id)&&Number.isSafeInteger(nowMs)&&nowMs>=0,503,'NGS_FILE_SYNC_UNAVAILABLE');
  const received=await edit(`INSERT INTO ${table}(slot,sync_id,expiry,lock_id,written,file_count,upload,last)
   VALUES(1,?,?,?,0,0,NULL,NULL) ON CONFLICT(slot) DO UPDATE SET sync_id=excluded.sync_id,
   expiry=excluded.expiry,lock_id=excluded.lock_id,written=0,file_count=0,upload=NULL,last=NULL WHERE expiry<=?`,
   id,nowMs+ttl,id,nowMs);
  need(count(received)===1,409,'NGS_FILE_SYNC_BUSY');
  try{
   if(old?.upload)await clearUpload(old.sync_id,JSON.parse(old.upload));
   const files=await list();
   await edit(`UPDATE ${table} SET file_count=?,lock_id=NULL WHERE slot=1 AND sync_id=? AND lock_id=?`,files.length,id,id);
   return {syncId:id,scope:project,inventoryAt:nowMs,files};
  }catch(e){await edit(`DELETE FROM ${table} WHERE slot=1 AND sync_id=? AND lock_id=?`,id,id);throw e;}
 }
 async function call(name,args){
  ready();need(names.has(name),404,'NGS_FILE_SYNC_TOOL_UNKNOWN');
  if(name===begin)return await start(args);
  need(validSync(args?.syncId));
  const stamp=uuid(),nowMs=now();
  const lock=await edit(`UPDATE ${table} SET lock_id=?,expiry=? WHERE slot=1 AND sync_id=? AND expiry>? AND lock_id IS NULL`,
   stamp,nowMs+ttl,args.syncId,nowMs);
  need(count(lock)===1,409,'NGS_FILE_SYNC_INVALID_SESSION');
  const row=await state();
  need(row?.sync_id===args.syncId&&row.lock_id===stamp,409,'NGS_FILE_SYNC_INVALID_SESSION');
  try{
   if(name===chunk)return await send(args,row);
   if(name===remove)return await removeFile(args,row);
   need(exact(args,'syncId'));
   if(name===finish)need(!row.upload,409,'NGS_FILE_SYNC_INCOMPLETE');
   if(name===abort&&row.upload)await clearUpload(row.sync_id,JSON.parse(row.upload));
   await edit(`DELETE FROM ${table} WHERE slot=1 AND sync_id=? AND lock_id=?`,row.sync_id,stamp);
   return name===finish?{ok:true,written:row.written}:{ok:true};
  }finally{await edit(`UPDATE ${table} SET lock_id=NULL WHERE slot=1 AND sync_id=? AND lock_id=?`,row.sync_id,stamp);}
 }
 return {call,list,head,get};
}
