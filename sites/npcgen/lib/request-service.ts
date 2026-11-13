import { createSchema, commandSchema, digest, ApiError } from './contracts';
export type Row={key:string;request_id:string;input_revision:number;project_id:string;run_id:string;input_hash:string;input_json:string;actor_id:string;status:string;revision:number;worker_id:string|null;lease_until:number|null;fence:number;result_json:string|null;manifest_json:string|null;review:string;feedback:string|null;receipts_json:string;publish_state:string;publish_receipt:string|null;last_error:string|null;created_at:number;updated_at:number};
export function view(r:Row){return {key:r.key,requestId:r.request_id,inputRevision:r.input_revision,projectId:r.project_id,runId:r.run_id,inputHash:r.input_hash,input:JSON.parse(r.input_json),status:r.status,revision:r.revision,workerId:r.worker_id,leaseUntil:r.lease_until,fence:r.fence,result:r.result_json?JSON.parse(r.result_json):null,manifest:r.manifest_json?JSON.parse(r.manifest_json):null,review:r.review,feedback:r.feedback,publishState:r.publish_state,publishReceipt:r.publish_receipt?JSON.parse(r.publish_receipt):null,lastError:r.last_error,createdAt:r.created_at,updatedAt:r.updated_at};}
export class RequestService{
 constructor(private db:D1Database,private now=()=>Date.now()){}
 async list(){return (await this.db.prepare('SELECT * FROM npc_requests ORDER BY updated_at DESC LIMIT 100').all<Row>()).results.map(view);}
 async row(key:string){const r=await this.db.prepare('SELECT * FROM npc_requests WHERE key=?').bind(key).first<Row>();if(!r)throw new ApiError('NOT_FOUND',404);return r;}
 async get(key:string){return view(await this.row(key));}
 async create(raw:unknown,actorId:string){const p=createSchema.parse(raw),key=p.requestId+':'+p.requestRevision,h=await digest(p.input),runId='run.'+(await digest({key,projectId:p.input.projectId})).slice(0,32),now=this.now();await this.db.prepare('INSERT INTO npc_requests (key,request_id,input_revision,project_id,run_id,input_hash,input_json,actor_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(key) DO NOTHING').bind(key,p.requestId,p.requestRevision,p.input.projectId,runId,h,JSON.stringify(p.input),actorId,now,now).run();const r=await this.row(key);if(r.input_hash!==h)throw new ApiError('REQUEST_INPUT_CONFLICT');return view(r);}
 async command(raw:unknown,actorId:string){const p=commandSchema.parse(raw),r=await this.row(p.key),h=await digest(p),receipts=JSON.parse(r.receipts_json),prior=receipts[p.commandId];if(prior){if(prior.hash!==h||prior.actorId!==actorId)throw new ApiError('COMMAND_CONFLICT');return prior.response;}
 if(r.revision!==p.expectedRevision)throw new ApiError('REVISION_CONFLICT');if(Object.keys(receipts).length>=64)throw new ApiError('COMMAND_LIMIT',422);
 const now=this.now(),n={...r,revision:r.revision+1,updated_at:now};
 if(p.action==='claim'){
  if(r.status==='claimed'&&(r.lease_until||0)<=now)throw new ApiError('RECOVERY_REVIEW_REQUIRED',422);
  if(r.status!=='queued')throw new ApiError('NOT_CLAIMABLE');n.status='claimed';n.worker_id=p.workerId;n.lease_until=now+300000;n.fence=r.fence+1;
 }else if(p.action==='recover'){
  if(r.status!=='claimed'||(r.lease_until||0)>now)throw new ApiError('RECOVERY_NOT_REQUIRED');n.worker_id=p.workerId;n.lease_until=now+300000;n.fence=r.fence+1;n.last_error='Manual same-run recovery: '+p.evidence;
 }else if(p.action==='heartbeat'||p.action==='complete'){
  if(r.status!=='claimed'||r.worker_id!==p.workerId||r.fence!==p.fence||(r.lease_until||0)<=now)throw new ApiError('STALE_CLAIM');
  if(p.action==='heartbeat')n.lease_until=now+300000;
  else {const input=JSON.parse(r.input_json);if(p.result.npcId!==input.npcId||p.result.name!==input.npcName)throw new ApiError('RESULT_ID_MISMATCH',422);n.status='completed';n.lease_until=null;n.result_json=JSON.stringify({prompt:p.prompt,promptHash:await digest(p.prompt),npc:p.result,submittedBy:actorId,generationMode:p.generationMode,validationNote:p.validationNote});n.manifest_json=JSON.stringify({schemaVersion:'npc-site-result.v1',generationMode:p.generationMode,validationNote:p.validationNote,projectId:r.project_id,requestId:r.request_id,requestRevision:r.input_revision,runId:r.run_id,inputHash:r.input_hash,contentHash:await digest(p.result),promptHash:await digest(p.prompt),validation:{schemaPassed:true,semanticReview:'pending'},npc:p.result,assets:[],scope:'draft-only',unity:{importContract:'proposal',applied:false}});n.publish_state='pending';}
 }else if(p.action==='review'){
  if(r.status!=='completed')throw new ApiError('RESULT_NOT_READY');if(p.decision==='changes_requested'&&p.feedback.trim().length<5)throw new ApiError('FEEDBACK_REQUIRED',422);n.review=p.decision;n.feedback=p.feedback;
 }else if(p.action==='cancel'){
  if(r.status!=='queued')throw new ApiError('CANNOT_CANCEL_ACTIVE_RUN');n.status='cancelled';
 }else if(p.action==='publish_receipt'){
  if(r.status!=='completed'||!r.manifest_json)throw new ApiError('RESULT_NOT_READY');if(await digest(JSON.parse(r.manifest_json))!==p.manifestHash)throw new ApiError('MANIFEST_CONFLICT');if(p.status==='published'&&!p.reference.trim())throw new ApiError('REFERENCE_REQUIRED',422);n.publish_state=p.status;n.publish_receipt=JSON.stringify({manifestHash:p.manifestHash,status:p.status,reference:p.reference,error:p.error,recordedBy:actorId,recordedAt:now});
 }
 const response=view(n);receipts[p.commandId]={hash:h,actorId,response};n.receipts_json=JSON.stringify(receipts);
 const updated=await this.db.prepare('UPDATE npc_requests SET status=?, revision=?, worker_id=?, lease_until=?, fence=?, result_json=?, manifest_json=?, review=?, feedback=?, receipts_json=?, publish_state=?, publish_receipt=?, last_error=?, updated_at=? WHERE key=? AND revision=? RETURNING *').bind(n.status,n.revision,n.worker_id,n.lease_until,n.fence,n.result_json,n.manifest_json,n.review,n.feedback,n.receipts_json,n.publish_state,n.publish_receipt,n.last_error,n.updated_at,n.key,r.revision).first<Row>();if(!updated){const current=await this.row(p.key),saved=JSON.parse(current.receipts_json)[p.commandId];if(saved&&saved.hash===h&&saved.actorId===actorId)return saved.response;throw new ApiError('REVISION_CONFLICT');}return response;
 }
}
