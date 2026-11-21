// NGS transport only. Official state belongs to RS, not this queue.
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync, openSync, closeSync, lstatSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { parseRequestSubmission } from './local-request-submission.mjs';

export const REQUEST_LIMIT=32*1024;
export const MAX_QUEUE_LIST=16;
export const LOCAL_QUEUE_MCP_DEFAULT_PORT=5275;
const RECEIPT_TTL=15*60*1000;
const QUEUE_CAPACITY=128;
const cursorPattern=/^q1\.([1-9][0-9]{0,15})$/;
const secretId=/^ngs\.local\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const root=realpathSync(fileURLToPath(new URL('../../../../',import.meta.url)));
const error=(message,status)=>Object.assign(Error(message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'
 ?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const queued=queueId=>({queueId,status:'queued'});

export function openLocalRequestQueue(dbPath,{now=Date.now}={}){
 if(typeof dbPath!=='string'||!isAbsolute(dbPath)||resolve(dbPath)!==dbPath||dbPath===root||dbPath.startsWith(root+sep))
  throw error('NGS_REQUEST_QUEUE_PATH_INVALID',503);
 const parent=realpathSync(dirname(dbPath));
 if(parent===root||parent.startsWith(root+sep))throw error('NGS_REQUEST_QUEUE_PATH_INVALID',503);
 // Exclusively create mode 0600 where no file exists; pre-existing symlinks are never followed.
 try{closeSync(openSync(dbPath,'wx',0o600));}catch(e){if(e.code!=='EEXIST')throw e;}
 const stat=lstatSync(dbPath);
 if(!stat.isFile()||(stat.mode&0o077)!==0||realpathSync(dbPath)!==resolve(parent,basename(dbPath)))
  throw error('NGS_REQUEST_QUEUE_PATH_INVALID',503);
 const db=new DatabaseSync(dbPath);
 try{
  db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; BEGIN IMMEDIATE');
  db.exec(`CREATE TABLE IF NOT EXISTS local_request_queue_v1(
    queue_id TEXT PRIMARY KEY NOT NULL, client_key TEXT UNIQUE NOT NULL, digest TEXT NOT NULL,
    project_id TEXT NOT NULL, request_type TEXT NOT NULL, payload TEXT,
    created_ms INTEGER NOT NULL, official_id TEXT, receipt_expires_ms INTEGER
   );
   CREATE TABLE IF NOT EXISTS local_request_queue_order_v1(seq INTEGER PRIMARY KEY AUTOINCREMENT);`);
  const hasSequence=db.prepare("SELECT 1 AS yes FROM pragma_table_info('local_request_queue_v1') WHERE name='queue_seq'").get();
  if(!hasSequence)db.exec(`ALTER TABLE local_request_queue_v1 ADD COLUMN queue_seq INTEGER;
   UPDATE local_request_queue_v1 SET queue_seq=rowid;
   INSERT INTO local_request_queue_order_v1(seq)
    SELECT MAX(queue_seq) FROM local_request_queue_v1 HAVING COUNT(*)>0;
   DELETE FROM local_request_queue_order_v1;`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS local_request_queue_sequence_v1 ON local_request_queue_v1(queue_seq); COMMIT');
 }catch(e){db.close();throw e;}
 const purge=db.prepare('DELETE FROM local_request_queue_v1 WHERE receipt_expires_ms <= ?');
 const byClient=db.prepare('SELECT queue_id,digest FROM local_request_queue_v1 WHERE client_key=?');
 const byId=db.prepare('SELECT queue_id,project_id,official_id,receipt_expires_ms FROM local_request_queue_v1 WHERE queue_id=?');
 const count=db.prepare('SELECT COUNT(*) AS c FROM local_request_queue_v1');
 const next=db.prepare('INSERT INTO local_request_queue_order_v1 DEFAULT VALUES');
 const freeNext=db.prepare('DELETE FROM local_request_queue_order_v1 WHERE seq=?');
 const insert=db.prepare('INSERT INTO local_request_queue_v1(queue_id,client_key,digest,project_id,request_type,payload,created_ms,queue_seq) VALUES(?,?,?,?,?,?,?,?)');
 const list=db.prepare('SELECT queue_id,request_type,payload,queue_seq FROM local_request_queue_v1 WHERE official_id IS NULL AND queue_seq>? ORDER BY queue_seq LIMIT ?');
 const pendingSummary=db.prepare('SELECT project_id,request_type,created_ms FROM local_request_queue_v1 WHERE official_id IS NULL ORDER BY queue_seq');
 const ack=db.prepare('UPDATE local_request_queue_v1 SET official_id=?,receipt_expires_ms=?,payload=NULL WHERE queue_id=? AND official_id IS NULL');
 const transact=fn=>{
  db.exec('BEGIN IMMEDIATE');
  try{const result=fn();db.exec('COMMIT');return result;}
  catch(e){db.exec('ROLLBACK');throw e;}
 };
 return {
  close:()=>db.close(),
  enqueue(command){
   const data=Buffer.from(JSON.stringify(command)??'');
   if(data.length>REQUEST_LIMIT)throw error('NGS_REQUEST_QUEUE_INPUT_TOO_LARGE',413);
   const value=parseRequestSubmission(data);
   const digest=hash(canonical(value));
   return transact(()=>{
    const time=now();purge.run(time);
    const existing=byClient.get(value.idempotencyKey);
    if(existing){
     if(existing.digest!==digest)throw error('NGS_REQUEST_QUEUE_IDEMPOTENCY_CONFLICT',409);
     return queued(existing.queue_id);
    }
    if(count.get().c>=QUEUE_CAPACITY)throw error('NGS_REQUEST_QUEUE_FULL',503);
    const queueId='ngs.local.'+randomUUID();
    const {lastInsertRowid}=next.run();
    freeNext.run(lastInsertRowid);
    insert.run(queueId,value.idempotencyKey,digest,value.payload.projectId,value.requestType,JSON.stringify(value.payload),time,lastInsertRowid);
    return queued(queueId);
   });
  },
  read(queueId){
   if(!secretId.test(queueId??''))return undefined;
   const row=byId.get(queueId);
   if(!row)return undefined;
   if(row.official_id){
    if(row.receipt_expires_ms<=now())return undefined;
    return {queueId,status:'registered',receipt:{officialRequestId:row.official_id,status:'registered'}};
   }
   return queued(queueId);
  },
  pendingSummary(){
   return pendingSummary.all().map(({project_id,request_type,created_ms})=>({projectId:project_id,requestType:request_type,queuedAt:created_ms}));
  },
  list(limit=MAX_QUEUE_LIST,cursor){
   if(!Number.isInteger(limit)||limit<1||limit>MAX_QUEUE_LIST)throw error('NGS_REQUEST_QUEUE_LIMIT_INVALID',400);
   const match=typeof cursor==='string'&&cursor.match(cursorPattern);
   const after=cursor===undefined?0:Number(match?.[1]);
   if(!Number.isSafeInteger(after))throw error('NGS_REQUEST_QUEUE_CURSOR_INVALID',400);
   const rows=list.all(after,limit);
   return {requests:rows.map(row=>({queueId:row.queue_id,requestType:row.request_type,idempotencyKey:row.queue_id,payload:JSON.parse(row.payload)})),
    ...(rows.length===limit?{nextCursor:'q1.'+rows.at(-1).queue_seq}:{})};
  },
  ack(queueId,receipt){
   if(!secretId.test(queueId??'')||!receipt||Object.keys(receipt).sort().join(',')!=='officialRequestId,status'||receipt.status!=='registered')
    throw error('NGS_REQUEST_QUEUE_ACK_INVALID',400);
   return transact(()=>{
    const time=now();purge.run(time);
    const row=byId.get(queueId);
    if(!row)throw error('NGS_REQUEST_QUEUE_NOT_FOUND',404);
    const expected='request.official.'+hash(canonical(['request.official.v1','local',row.project_id,queueId]));
    if(receipt.officialRequestId!==expected)throw error('NGS_REQUEST_QUEUE_RECEIPT_MISMATCH',409);
    if(!row.official_id)ack.run(expected,time+RECEIPT_TTL,queueId);
    return {queueId,status:'acknowledged'};
   });
  },
 };
}
