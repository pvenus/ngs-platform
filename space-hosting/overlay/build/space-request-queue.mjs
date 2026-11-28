/** Site-owned transit only. The Mac Request Service owns durable official state. */
import {validSpaceMapAssemblyCommand} from './space-map-assembly.mjs';
import {validConceptCategoryRequest} from '../ngs-local/sites/npcgen/build/local-concept-category-contract.mjs';
import {validNpcPlanningAdd,validNpcPlanningUpdate} from '../ngs-local/sites/npcgen/build/local-npc-planning-ui.mjs';
import {audioSeparationType,validAudioSeparationPayload,validLocalAudioPayload} from '../ngs-local/sites/npcgen/build/local-audio-workspace.mjs';
import {motionPresetConvertType,validMotionPresetConvert} from '../ngs-local/sites/npcgen/build/motion-preset-convert-2d.mjs';
import {npcBasicSchema,validNpcBasicRequest,isSelectionSchema,validNpcMotionSelectionRequest,validNpcWorkflowIdentity,animationRegenerateType,validNpcAnimationRegenerate} from '../ngs-local/sites/npcgen/build/npc-motion-selection.mjs';
import {propAction,validPropPayload,propAnimationRemoveType,validPropAnimationRemove} from '../ngs-local/sites/npcgen/build/prop-workspace-contract.mjs';
import {cinematicSequenceType,cinematicPlaybackUpdateType,validCinematicSequencePayload,validCinematicPlaybackUpdate,cinematicSourceGenerateType,validCinematicSourceGenerate,backgroundSourceType,validBackgroundRequest,backgroundPixelType,validBackgroundPixelRequest,backgroundAnimationType,validBackgroundAnimation,cinematicSequencesRemoveType,validCinematicSequencesRemove} from '../ngs-local/sites/npcgen/build/cinematic-sequence-contract.mjs';
import {cinematicType,validCinematicPayload} from '../ngs-local/sites/npcgen/build/cinematic-contract.mjs';
const table='ngs_space_request_queue_v1';
const cap=128,maxList=16,receiptTTL=24*60*60*1000;
const queuePattern=/^ngs\.space\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const officialPattern=/^request\.official\.[a-f0-9]{64}$/u;
const clientPattern=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const rsStates=['registered','planned','completed','failed','cancelled'];
const cursorPattern=/^q1\.[1-9][0-9]{0,15}$/u;
const e=(status,code)=>Object.assign(Error(code),{status});
const need=(ok,status=400,code='SPACE_REQUEST_INVALID')=>{if(!ok)throw e(status,code);};
export const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export const record=v=>v&&typeof v==='object'&&!Array.isArray(v);
export const queueIdPattern=queuePattern.source;
export const receiptIdPattern=officialPattern.source;
export const cursorIdPattern=cursorPattern.source;
export {validMachineToken} from './space-browser-auth.mjs';
const validQueueId=v=>typeof v==='string'&&v.length===46&&queuePattern.test(v);
const hex=x=>Array.from(new Uint8Array(x),v=>v.toString(16).padStart(2,'0')).join('');
const utf8=new TextEncoder();
const hash=async raw=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(raw)));
const json=v=>JSON.stringify(v);
function canonical(value,depth=0){
 need(depth<=20);
 if(value===null||typeof value!=='object')return json(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
 return '{'+Object.keys(value).sort().map(k=>json(k)+':'+canonical(value[k],depth+1)).join(',')+'}';
}
function validOneStop(v){
 if(v.schemaVersion===npcBasicSchema)return validNpcBasicRequest(v);
 if(isSelectionSchema(v.schemaVersion))return validNpcMotionSelectionRequest(v);
 const fields=['schemaVersion','projectId','character','intent','sourceRefs','includeCombat'];
 if(v.includeCombat===true)fields.push('combatMotionPresets');
 const c=v.character,text=(x,n)=>typeof x==='string'&&x.trim()===x&&x.length>0&&x.length<=n,
  ids=(x,n)=>typeof x==='string'&&x.length<=n&&clientPattern.test(x);
 return ['ngs.npc-one-stop.v1','ngs.npc-one-stop.replace.v1'].includes(v.schemaVersion)&&exact(v,fields)&&
   exact(c,['npcId','name','slug','role','actId','chapterId'])&&ids(c.npcId,128)&&ids(c.slug,128)&&validNpcWorkflowIdentity(c,v.schemaVersion)&&
   text(c.name,120)&&text(c.role,600)&&ids(c.actId,128)&&ids(c.chapterId,128)&&text(v.intent,7000)&&
   Array.isArray(v.sourceRefs)&&v.sourceRefs.length>=1&&v.sourceRefs.length<=64&&v.sourceRefs.every(x=>text(x,600))&&
   (v.includeCombat===false||v.includeCombat===true&&Array.isArray(v.combatMotionPresets)&&
    v.combatMotionPresets.length>=1&&v.combatMotionPresets.length<=16&&v.combatMotionPresets.every(x=>ids(x,128)));
}
function commandOK(cmd){
 if(!exact(cmd,['idempotencyKey','payload','requestType'])||typeof cmd.idempotencyKey!=='string'||
    !clientPattern.test(cmd.idempotencyKey)||!record(cmd.payload)||cmd.payload.projectId!=='binari')return false;
 const p=cmd.payload;
 switch(cmd.requestType){
 case cinematicType:return validCinematicPayload(p);
 case cinematicSequenceType:return validCinematicSequencePayload(p);
 case cinematicPlaybackUpdateType:return validCinematicPlaybackUpdate(p);
 case backgroundSourceType:return validBackgroundRequest(p);
 case backgroundPixelType:return validBackgroundPixelRequest(p);
 case backgroundAnimationType:return validBackgroundAnimation(p);
 case cinematicSourceGenerateType:return validCinematicSourceGenerate(p);
 case cinematicSequencesRemoveType:return validCinematicSequencesRemove(p);
 case propAnimationRemoveType:return validPropAnimationRemove(p);
 case 'audio.generate':return validLocalAudioPayload(p);
 case audioSeparationType:return validAudioSeparationPayload(p);
 case 'audio.delete':return exact(p,['schemaVersion','projectId','officialRequestId'])&&p.schemaVersion==='ngs.audio-delete.v1'&&
  typeof p.officialRequestId==='string'&&p.officialRequestId.length===81&&officialPattern.test(p.officialRequestId);
 case motionPresetConvertType:return validMotionPresetConvert(p);
 case 'npc.planning.add':return validNpcPlanningAdd(p);
 case 'npc.planning.update':return validNpcPlanningUpdate(p);
 case 'concept.category.workflow':return validConceptCategoryRequest(p);
 case 'npc.workflow':return validOneStop(p);
 case animationRegenerateType:return validNpcAnimationRegenerate(p);
 default:return validSpaceMapAssemblyCommand(cmd.requestType,p)||!!propAction(cmd.requestType)&&validPropPayload(cmd.requestType,p);
 }
}
export const officialIdForSpace=async key=>'request.official.'+await hash(json(['request.official.v1','space','binari',key]));
const queued=queueId=>({queueId,status:'queued'});
const summary=r=>({projectId:'binari',requestType:r.request_type,queuedAt:r.created_ms});
export const machineTools=[
 {name:'space_requests_pending',description:'List pending Binari requests from this hosted queue.',inputSchema:{type:'object',additionalProperties:false,
  properties:{limit:{type:'integer',minimum:1,maximum:maxList},cursor:{type:'string',pattern:cursorIdPattern}}}},
 {name:'space_requests_get',description:'Read one exact pending Binari queue row to prove the origin to RS.',inputSchema:{type:'object',additionalProperties:false,
  properties:{queueId:{type:'string',pattern:queueIdPattern}},required:['queueId']}},
 {name:'space_requests_ack',description:'Settle one exact queue row only after RS returned the verified official receipt.',inputSchema:{type:'object',additionalProperties:false,
  properties:{queueId:{type:'string',pattern:queueIdPattern},receipt:{type:'object',additionalProperties:false,required:['officialRequestId','status','registeredAt'],
   properties:{officialRequestId:{type:'string',pattern:receiptIdPattern},status:{enum:rsStates},registeredAt:{type:'integer',minimum:0}}}},required:['queueId','receipt']}},
];
export class SpaceRequestQueue{
 constructor(db,{now=Date.now,uuid=()=>crypto.randomUUID()}={}){this.db=db;this.now=now;this.uuid=uuid;}
 async ready(){
  need(this.db,503,'SPACE_QUEUE_UNAVAILABLE');
  const r=await this.db.prepare("SELECT 1 AS ready FROM sqlite_schema WHERE type='table' AND name=?").bind(table).first();
  need(r?.ready===1,503,'SPACE_QUEUE_UNAVAILABLE');
 }
 async enqueue(actor,cmd){
  need(commandOK(cmd));
  const payload=canonical(cmd.payload),digest=await hash(canonical([cmd.requestType,cmd.payload])),queueId='ngs.space.'+this.uuid(),now=this.now();
  need(validQueueId(queueId),503,'SPACE_QUEUE_UNAVAILABLE');
  await this.ready();
  await this.db.prepare(`DELETE FROM ${table} WHERE expires_ms<=?`).bind(now).run();
  // Capacity and admission are in the same D1 write, not a read-then-insert race.
  await this.db.prepare(`INSERT INTO ${table}(queue_id,actor_id,client_key,digest,request_type,payload,created_ms)
      SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM ${table} WHERE official_id IS NULL)<?
      AND (SELECT COUNT(*) FROM ${table} WHERE actor_id=? AND official_id IS NULL)<32
      AND (SELECT COUNT(*) FROM ${table})<4096
      ON CONFLICT(actor_id,client_key) DO NOTHING`).bind(queueId,actor,cmd.idempotencyKey,digest,cmd.requestType,payload,now,cap,actor).run();
  const row=await this.db.prepare(`SELECT queue_id,digest FROM ${table} WHERE actor_id=? AND client_key=?`).bind(actor,cmd.idempotencyKey).first();
  need(row,503,'SPACE_QUEUE_FULL');need(row.digest===digest,409,'SPACE_QUEUE_IDEMPOTENCY_CONFLICT');
  return queued(row.queue_id);
 }
 async browserSummary(actor){
  await this.ready();
  const {results}=await this.db.prepare(`SELECT request_type,created_ms FROM ${table} WHERE actor_id=? AND official_id IS NULL ORDER BY seq LIMIT 32`).bind(actor).all();
  return {requests:results.map(summary)};
 }
 async browserStatus(actor,id){
  need(validQueueId(id));await this.ready();
  const row=await this.db.prepare(`SELECT official_id,expires_ms FROM ${table} WHERE queue_id=? AND actor_id=?`).bind(id,actor).first();
  need(row&&(!row.expires_ms||row.expires_ms>this.now()),404,'SPACE_QUEUE_NOT_FOUND');
  return row.official_id?{queueId:id,status:'registered',receipt:{officialRequestId:row.official_id,status:'registered'}}:queued(id);
 }
 async decode(row){
  const result={queueId:row.queue_id,idempotencyKey:row.queue_id,requestType:row.request_type,payload:JSON.parse(row.payload)};
  need(validQueueId(row.queue_id)&&commandOK({idempotencyKey:result.idempotencyKey,requestType:result.requestType,payload:result.payload}),
   503,'SPACE_QUEUE_UNAVAILABLE');
  need(canonical(result.payload)===row.payload&&await hash(canonical([result.requestType,result.payload]))===row.digest,
   503,'SPACE_QUEUE_UNAVAILABLE');
  return result;
 }
 async pending(args){
  need(record(args)&&Object.keys(args).every(k=>['limit','cursor'].includes(k)));
  const {limit=maxList,cursor}=args;
  need(Number.isInteger(limit)&&limit>=1&&limit<=maxList&&
   (cursor===undefined||typeof cursor==='string'&&cursorPattern.test(cursor)&&Number.isSafeInteger(Number(cursor.slice(3)))));
  await this.ready();
  const {results}=await this.db.prepare(`SELECT seq,queue_id,request_type,payload,digest FROM ${table} WHERE official_id IS NULL AND seq>? ORDER BY seq LIMIT ?`)
   .bind(cursor===undefined?0:Number(cursor.slice(3)),limit).all();
  return {requests:await Promise.all(results.map(r=>this.decode(r))),...(results.length===limit?{nextCursor:'q1.'+results.at(-1).seq}:{})};
 }
 async get(args){
  need(exact(args,['queueId'])&&validQueueId(args.queueId));await this.ready();
  const row=await this.db.prepare(`SELECT queue_id,request_type,payload,digest FROM ${table} WHERE queue_id=? AND official_id IS NULL`).bind(args.queueId).first();
  need(row,404,'SPACE_QUEUE_NOT_FOUND');return this.decode(row);
 }
 async ack(args){
  need(exact(args,['queueId','receipt'])&&validQueueId(args.queueId)&&exact(args.receipt,['officialRequestId','status','registeredAt'])&&rsStates.includes(args.receipt.status)&&
   Number.isSafeInteger(args.receipt.registeredAt)&&args.receipt.registeredAt>=0);
  const {queueId,receipt}=args,expected=await officialIdForSpace(queueId);
  need(receipt.officialRequestId===expected,409,'SPACE_QUEUE_RECEIPT_MISMATCH');
  await this.ready();
  await this.db.prepare(`UPDATE ${table} SET official_id=?,expires_ms=?,payload=NULL WHERE queue_id=? AND official_id IS NULL`)
   .bind(expected,this.now()+receiptTTL,queueId).run();
  const row=await this.db.prepare(`SELECT official_id,expires_ms FROM ${table} WHERE queue_id=?`).bind(queueId).first();
  need(row&&row.expires_ms>this.now(),404,'SPACE_QUEUE_NOT_FOUND');
  need(row.official_id===expected,409,'SPACE_QUEUE_RECEIPT_MISMATCH');
  return {queueId,status:'acknowledged'};
 }
 async call(name,args){
  if(name==='space_requests_pending')return this.pending(args);
  if(name==='space_requests_get')return this.get(args);
  if(name==='space_requests_ack')return this.ack(args);
  throw e(400,'SPACE_REQUEST_INVALID');
 }
}
