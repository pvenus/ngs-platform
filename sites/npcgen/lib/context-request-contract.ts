/** Browser-safe contract, shared unchanged by server submission validation. */
import {z} from 'zod';
import {portraitBatch} from './portrait-batch-contract';
const id=z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const query=z.record(z.union([z.string().max(500),z.number().finite(),z.boolean(),z.null()])).default({});
const base={projectId:id,ownerRouteId:id,contractVersion:z.literal('npc-context.v1')};
export const features=z.enum(['npc-settings-draft','portrait.register','portrait.replace','portrait.generate']);
export const portraitId=z.string().regex(/^[a-f0-9]{64}\.(png|jpg|webp)$/);
const npcInputs=z.object({intent:z.string().min(5).max(4000),npcId:id}).strict();
const portraitBase={intent:z.string().min(5).max(4000),npcId:z.string().regex(/^(character|npc|entity|enemy)\.[a-z0-9._-]{2,80}$/),label:z.string().min(1).max(100).refine(v=>!!v.trim()),expectedRevision:z.number().int().positive(),expectedActivePortraitId:portraitId.nullable(),setActive:z.boolean()};
const portraitRegister=z.object({...portraitBase,sourceSha256:hash}).strict();
const portraitReplace=z.object({...portraitBase,sourceSha256:hash,targetPortraitId:portraitId}).strict();
const portraitGenerate=z.object({...portraitBase,batch:portraitBatch.optional()}).strict();
const featureInput=(feature:string)=>feature==='npc-settings-draft'?npcInputs:feature==='portrait.register'?portraitRegister:feature==='portrait.replace'?portraitReplace:portraitGenerate;
export const featureCheck=(value:any,ctx:z.RefinementCtx,inputKey:string)=>{
 const portrait=value.featureId.startsWith('portrait.');
 if(!featureInput(value.featureId).safeParse(value[inputKey]).success)ctx.addIssue({code:z.ZodIssueCode.custom,message:'FEATURE_INPUTS_MISMATCH'});
 if(portrait&&value.skillVersion!==undefined&&value.skillVersion!==(value[inputKey]?.batch?'0.4.0':'0.3.0'))ctx.addIssue({code:z.ZodIssueCode.custom,message:'PORTRAIT_SKILL_VERSION_REQUIRED'});
};
export const contextRequest=z.discriminatedUnion('operation',[
 z.object({...base,operation:z.literal('prepare'),featureId:features,inputs:z.record(z.unknown())}).strict(),
 z.object({...base,operation:z.literal('read'),planHash:hash,logicalResourceId:id,query,resourceVersion:id.optional()}).strict(),
]).superRefine((value,ctx)=>{if(value.operation==='prepare')featureCheck(value,ctx,'inputs');});
