import {issuePortraitAuthority} from './portrait-authority.mjs';
import participants from './portrait-space-participants.json';
import {ApiError,digest,canonical} from './contracts';
import {bytesHash,TransferService, type TransferRow} from './transfer-service';

const reads=new Set(['read']);
export async function principalForPortrait(user:{userId:string;email:string},policy:any=participants){
 const emailHash=await bytesHash(new TextEncoder().encode(user.email.trim().toLowerCase()));
 const grant=policy.participants.find((p:{emailHash:string;canonicalActor:string})=>p.emailHash===emailHash);
 if(!policy.enabled||!grant)throw new ApiError('PORTRAIT_CONCEPT_PARTICIPANT_DENIED',403);
 const authority=issuePortraitAuthority(grant.canonicalActor,policy);return {principal:authority,siteUserId:user.userId,emailHash,actorId:authority.actorId,projectId:authority.projectId,siteProjectId:authority.siteProjectId,policyRevision:authority.policyRevision,role:authority.role};
}
/** D1 is delivery/projection only. A queued transfer is never durable intake. */
export const portraitPrincipal=(user:{userId:string;email:string})=>principalForPortrait(user);
export async function deliverPortrait(db:D1Database,command:any,principal:Awaited<ReturnType<typeof principalForPortrait>>){
 const input={schemaVersion:'ngs-portrait-process-command.v1',command,authority:principal};
 const commandHash=await digest(input);
 const read=reads.has(command.operation),previous=read?await db.prepare("SELECT * FROM npc_transfers WHERE actor_id=? AND source_revision=1 AND CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json,'$.schemaVersion') END='ngs-portrait-command-transfer.v1' AND CASE WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json,'$.inputHash') END=? ORDER BY updated_at DESC LIMIT 1").bind(principal.siteUserId,commandHash).first<TransferRow>():null;
 let previousReceipt:any=null;if(previous&&previous.receipt_json!==null){try{previousReceipt=JSON.parse(previous.receipt_json)}catch{throw new ApiError('PORTRAIT_STORED_RECEIPT_INVALID',409)}if(!previousReceipt||typeof previousReceipt!=='object'||previousReceipt.schemaVersion!=='ngs-portrait-command-receipt.v1'||previousReceipt.commandHash!==commandHash)throw new ApiError('PORTRAIT_STORED_RECEIPT_INVALID',409);}
 if(previousReceipt&&Date.now()-previous!.updated_at<10000)return previousReceipt.result;
 const transferId=read&&previous&&!previousReceipt?previous.transfer_id:'portrait.command.'+await digest({commandHash,...(read?{afterReceipt:previousReceipt?.receiptHash??null}:{})});
 const key=transferId+':1',core={schemaVersion:'ngs-portrait-command-transfer.v1',channel:'sites',transferId,sourceRevision:1,input,inputHash:commandHash,attachments:[],challenge:transferId};
 const snapshot={...core,snapshotHash:await digest(core)};
 await db.prepare('INSERT INTO npc_transfers (key,transfer_id,source_revision,snapshot_json,actor_id,state,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING').bind(key,transferId,1,canonical(snapshot),principal.siteUserId,'delivery_pending',Date.now()).run();
 const service=new TransferService(db);
 // The existing owner worker polls the transfer and returns the common process
 // result. Timeouts keep the immutable transfer for exact same-command retries.
 for(let i=0;i<120;i++){
  const row=await service.row(transferId,1);
  if(row.actor_id!==principal.siteUserId||JSON.parse(row.snapshot_json).inputHash!==commandHash)throw new ApiError('PORTRAIT_COMMAND_CONFLICT',409);
  if(row.receipt_json){const receipt=JSON.parse(row.receipt_json);if(receipt.schemaVersion!=='ngs-portrait-command-receipt.v1'||receipt.commandHash!==commandHash)throw new ApiError('PORTRAIT_RECEIPT_MISMATCH',409);return receipt.result;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw new ApiError('LOCAL_PROCESSOR_DELIVERY_PENDING',503);
}
export async function acceptPortraitReceipt(db:D1Database,row:TransferRow,snapshot:any,raw:any,actorId:string){
 const keys=['schemaVersion','transferId','sourceRevision','snapshotHash','commandHash','actorId','result','resultHash','receiptHash'];
 if(!raw||Object.keys(raw).sort().join()!==keys.sort().join()||raw.schemaVersion!=='ngs-portrait-command-receipt.v1'||raw.transferId!==row.transfer_id||raw.sourceRevision!==row.source_revision||raw.snapshotHash!==snapshot.snapshotHash||raw.commandHash!==snapshot.inputHash||raw.actorId!==snapshot.input.authority.actorId||await digest(raw.result)!==raw.resultHash)throw new ApiError('PORTRAIT_RECEIPT_MISMATCH',422);
 const {receiptHash,...core}=raw;if(await digest(core)!==receiptHash)throw new ApiError('PORTRAIT_RECEIPT_MISMATCH',422);
 if(snapshot.input.command.operation==='unused-accept'&&!raw.result.error&&(raw.result.intakeReceipt?.confirmed!==true||raw.result.intakeReceipt?.requestId!==raw.result.requestId||!raw.result.intakeReceipt?.commonRequestId))throw new ApiError('DURABLE_INTAKE_CONFIRMATION_REQUIRED',422);
 if(row.receipt_json&&canonical(JSON.parse(row.receipt_json))!==canonical(raw))throw new ApiError('PORTRAIT_RECEIPT_CONFLICT',409);
 await db.prepare("UPDATE npc_transfers SET state='accepted',receipt_json=?,accepted_by=?,last_error=NULL,updated_at=? WHERE key=? AND receipt_json IS NULL").bind(canonical(raw),actorId,Date.now(),row.key).run();
 const final=await db.prepare('SELECT * FROM npc_transfers WHERE key=?').bind(row.key).first<TransferRow>();if(final?.receipt_json!==canonical(raw))throw new ApiError('PORTRAIT_RECEIPT_CONFLICT',409);
 return {receipt:raw};
}
