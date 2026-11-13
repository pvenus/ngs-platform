import {acceptPortraitReceipt} from './portrait-process-transport';
import {acceptConceptReceipt} from './master-concept-transport';
import {inspectMedia,TOTAL_LIMIT} from './media';
import {z} from 'zod';
import {categoryRequest} from './npc-category-contract';
import {ApiError,canonical,digest} from './contracts';
const id=z.string().regex(/^[a-zA-Z0-9._:-]{1,128}$/),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const transferInput=z.object({projectId:id,title:z.string().trim().min(2).max(80),intent:z.string().trim().min(5).max(4000),kind:z.enum(['npc-text','portrait-intake','media-intake','npc-category-intake']),request:categoryRequest.optional()}).strict().superRefine((v,c)=>{if((v.kind==='npc-category-intake')!==!!v.request)c.addIssue({code:z.ZodIssueCode.custom,message:'Category request required only for category intake'});});
const meta=z.object({attachmentId:id,name:z.string().min(1).max(200),mime:z.enum(['image/png','video/mp4']),size:z.number().int().positive().max(20971520),sha256:hash}).strict();
export const receiptSchema=z.object({schemaVersion:z.literal('npc-acceptance.v1'),status:z.literal('accepted'),channel:z.enum(['sites','sites-prompt']),transferId:id,sourceRevision:z.number().int().positive(),snapshotHash:hash,inputHash:hash,attachmentHashes:z.array(z.object({attachmentId:id,sha256:hash}).strict()).max(4),challenge:id,localRequestId:z.string().regex(/^local\.req\.[0-9a-f-]{36}$/),localRunId:z.null(),localAssetId:z.null(),commitId:z.string().regex(/^commit\.[0-9a-f-]{36}$/),committedAt:z.number().int().positive(),storageVerified:z.literal(true),receiptHash:hash}).strict();
export type TransferRow={key:string;transfer_id:string;source_revision:number;snapshot_json:string;actor_id:string;state:string;receipt_json:string|null;last_error:string|null;cleanup_eligible:number;updated_at:number};
export function transferView(r:TransferRow){return {key:r.key,transferId:r.transfer_id,sourceRevision:r.source_revision,snapshot:JSON.parse(r.snapshot_json),status:r.state,receipt:r.receipt_json?JSON.parse(r.receipt_json):null,lastError:r.last_error,cleanupEligible:!!r.cleanup_eligible,updatedAt:r.updated_at};}
export async function bytesHash(bytes:Uint8Array){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as BufferSource)),x=>x.toString(16).padStart(2,'0')).join('');}
export class TransferService{
 constructor(private db:D1Database,private bucket?:R2Bucket){}
 async row(transferId:string,sourceRevision:number){const key=id.parse(transferId)+':'+z.number().int().positive().parse(sourceRevision);const r=await this.db.prepare('SELECT * FROM npc_transfers WHERE key=?').bind(key).first<TransferRow>();if(!r)throw new ApiError('TRANSFER_NOT_FOUND',404);return r;}
 async get(transferId:string,sourceRevision:number,readerActorId?:string,masterPublisher=false){const row=await this.row(transferId,sourceRevision);if(['ngs-master-command-transfer.v1','ngs-portrait-command-transfer.v1'].includes(JSON.parse(row.snapshot_json).schemaVersion)&&!masterPublisher&&row.actor_id!==readerActorId)throw new ApiError('MASTER_TRANSFER_OWNER_REQUIRED',403);return transferView(row);}
 async list(readerActorId?:string,masterPublisher=false){return (await this.db.prepare('SELECT * FROM npc_transfers ORDER BY updated_at DESC LIMIT 100').all<TransferRow>()).results.filter(r=>!['ngs-master-command-transfer.v1','ngs-portrait-command-transfer.v1'].includes(JSON.parse(r.snapshot_json).schemaVersion)||masterPublisher||r.actor_id===readerActorId).map(transferView);}
 async create(raw:unknown,files:{name:string;bytes:Uint8Array}[],actorId:string){
  if(!this.bucket)throw new ApiError('ATTACHMENT_STORAGE_UNAVAILABLE',503);
  const p=z.object({transferId:id,sourceRevision:z.number().int().positive(),input:transferInput}).strict().parse(raw);
  if(p.input.kind==='npc-category-intake'&&(p.sourceRevision!==1||files.length||p.input.request?.requester!==actorId))throw new ApiError('CATEGORY_INTAKE_INVALID',400);
  if(files.length>4)throw new ApiError('TOO_MANY_ATTACHMENTS',400);
  if(p.input.kind==='portrait-intake')throw new ApiError('PORTRAIT_DIRECT_UPLOAD_DISABLED',403);
  const attachments=[];
  if(files.reduce((sum,f)=>sum+f.bytes.length,0)>TOTAL_LIMIT)throw new ApiError('TOTAL_SIZE_INVALID',413);
  for(const f of files){const b=f.bytes,mime=inspectMedia(b),h=await bytesHash(b);attachments.push(meta.parse({attachmentId:'att.'+h.slice(0,32),name:f.name,mime,size:b.length,sha256:h}));}
  if(p.input.kind==='media-intake'&&!files.length)throw new ApiError('MEDIA_ATTACHMENT_REQUIRED',400);
  if(new Set(attachments.map(a=>a.attachmentId)).size!==attachments.length)throw new ApiError('DUPLICATE_ATTACHMENT',400);
  const input=p.input.kind==='npc-category-intake'?{projectId:p.input.projectId,request:p.input.request}:p.input;
  const key=p.transferId+':'+p.sourceRevision,inputHash=await digest(input),candidate={inputHash,attachments};
  const existing=await this.db.prepare('SELECT * FROM npc_transfers WHERE key=?').bind(key).first<TransferRow>();
  if(existing){const s=JSON.parse(existing.snapshot_json);if(existing.actor_id!==actorId||canonical({inputHash:s.inputHash,attachments:s.attachments})!==canonical(candidate))throw new ApiError('TRANSFER_CONFLICT');return transferView(existing);}
  // Blob keys are content-addressed; concurrent retries cannot overwrite different bytes.
  for(let i=0;i<files.length;i++)await this.bucket.put('staging/'+attachments[i].sha256,files[i].bytes,{httpMetadata:{contentType:attachments[i].mime}});
  const core={schemaVersion:p.input.kind==='npc-category-intake'?'npc-category-request-transfer.v1':'npc-transfer.v1',channel:p.input.kind==='npc-category-intake'?'sites-prompt':'sites',transferId:p.transferId,sourceRevision:p.sourceRevision,input,inputHash,attachments,challenge:crypto.randomUUID()},snapshot={...core,snapshotHash:await digest(core)};
  await this.db.prepare('INSERT INTO npc_transfers (key,transfer_id,source_revision,snapshot_json,actor_id,state,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING').bind(key,p.transferId,p.sourceRevision,JSON.stringify(snapshot),actorId,'delivery_pending',Date.now()).run();
  const r=await this.row(p.transferId,p.sourceRevision),s=JSON.parse(r.snapshot_json);if(r.actor_id!==actorId||canonical({inputHash:s.inputHash,attachments:s.attachments})!==canonical(candidate))throw new ApiError('TRANSFER_CONFLICT');return transferView(r);
 }
 async attachment(transferId:string,sourceRevision:number,attachmentId:string,offset:number){
  if(!this.bucket)throw new ApiError('ATTACHMENT_STORAGE_UNAVAILABLE',503);
  const r=await this.row(transferId,sourceRevision),s=JSON.parse(r.snapshot_json),a=s.attachments.find((x:{attachmentId:string})=>x.attachmentId===attachmentId);if(!a)throw new ApiError('ATTACHMENT_NOT_FOUND',404);
  z.number().int().min(0).max(a.size-1).parse(offset);const o=await this.bucket.get('staging/'+a.sha256,{range:{offset,length:Math.min(32768,a.size-offset)}});if(!o)throw new ApiError('ATTACHMENT_UNAVAILABLE',503);const bytes=new Uint8Array(await o.arrayBuffer());let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return {attachmentId,offset,base64:btoa(binary),totalSize:a.size,sha256:a.sha256};
 }
 async accept(transferId:string,sourceRevision:number,raw:unknown,actorId:string,masterPublisher=false){
  const r=await this.row(transferId,sourceRevision),s=JSON.parse(r.snapshot_json);
  if(s.schemaVersion==='ngs-portrait-command-transfer.v1'){if(!masterPublisher)throw new ApiError('PORTRAIT_RECEIPT_PUBLISHER_DENIED',403);return acceptPortraitReceipt(this.db,r,s,raw,actorId);}
  if(s.schemaVersion==='ngs-master-command-transfer.v1'){if(!masterPublisher)throw new ApiError('MASTER_RECEIPT_PUBLISHER_DENIED',403);return acceptConceptReceipt(this.db,r,s,raw,actorId);}
  const p=receiptSchema.parse(raw),{receiptHash,...evidence}=p;
  if(p.channel!==s.channel||p.transferId!==transferId||p.sourceRevision!==sourceRevision||p.snapshotHash!==s.snapshotHash||p.inputHash!==s.inputHash||p.challenge!==s.challenge||canonical(p.attachmentHashes)!==canonical(s.attachments.map((a:{attachmentId:string;sha256:string})=>({attachmentId:a.attachmentId,sha256:a.sha256})))||await digest(evidence)!==receiptHash)throw new ApiError('ACCEPTANCE_EVIDENCE_MISMATCH');
  if(r.receipt_json){if(JSON.parse(r.receipt_json).receiptHash!==receiptHash)throw new ApiError('ACCEPTANCE_CONFLICT');return transferView(r);}
  // Evidence is an authenticated Codex attestation, not an independent remote disk probe.
  const stored=JSON.stringify(p);await this.db.prepare("UPDATE npc_transfers SET state='accepted',receipt_json=?,accepted_by=?,last_error=NULL,cleanup_eligible=1,updated_at=? WHERE key=? AND receipt_json IS NULL").bind(stored,actorId,Date.now(),r.key).run();const final=await this.row(transferId,sourceRevision);if(JSON.parse(final.receipt_json!).receiptHash!==receiptHash)throw new ApiError('ACCEPTANCE_CONFLICT');return transferView(final);
 }
 async failure(transferId:string,sourceRevision:number,snapshotHash:string,error:string){const r=await this.row(transferId,sourceRevision);if(JSON.parse(r.snapshot_json).snapshotHash!==hash.parse(snapshotHash))throw new ApiError('TRANSFER_CONFLICT');z.string().min(1).max(1000).parse(error);await this.db.prepare("UPDATE npc_transfers SET state='delivery_failed',last_error=?,updated_at=? WHERE key=? AND receipt_json IS NULL").bind(error,Date.now(),r.key).run();return this.get(transferId,sourceRevision);}
}
