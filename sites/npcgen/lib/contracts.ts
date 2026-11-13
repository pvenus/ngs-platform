import { z } from 'zod';
const id=z.string().min(1).max(128).regex(/^[a-zA-Z0-9._:-]+$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
export const inputSchema=z.object({projectId:id,npcId:id,npcName:z.string().trim().min(2).max(80),intent:z.string().trim().min(12).max(4000),sources:z.object({conceptRevision:z.number().int().positive(),storyRevision:z.number().int().positive(),npcRevision:z.number().int().positive()}).strict(),constraints:z.array(z.string().max(500)).max(10),deliverables:z.tuple([z.literal('npc-text')]),executionScope:z.literal('draft-only')}).strict();
export const createSchema=z.object({requestId:id,requestRevision:z.number().int().positive(),input:inputSchema}).strict();
const base={key:id,commandId:id,expectedRevision:z.number().int().positive()};
export const commandSchema=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('claim'),workerId:id}).strict(),
 z.object({...base,action:z.literal('recover'),workerId:id,evidence:z.string().min(10).max(2000)}).strict(),
 z.object({...base,action:z.literal('heartbeat'),workerId:id,fence:z.number().int().positive()}).strict(),
 z.object({...base,action:z.literal('complete'),workerId:id,fence:z.number().int().positive(),prompt:z.string().min(10).max(12000),generationMode:z.enum(['actual','example']),validationNote:z.string().min(10).max(2000),result:z.object({npcId:id,name:z.string().min(2).max(80),role:z.string().min(5).max(2000),personality:z.string().min(5).max(2000),background:z.string().min(5).max(3000),dialogue:z.array(z.string().min(2).max(1000)).min(1).max(10)}).strict()}).strict(),
 z.object({...base,action:z.literal('review'),decision:z.enum(['approved','changes_requested']),feedback:z.string().max(2000)}).strict(),
 z.object({...base,action:z.literal('cancel')}).strict(),
 z.object({...base,action:z.literal('publish_receipt'),manifestHash:z.string().regex(/^[a-f0-9]{64}$/),status:z.enum(['published','failed']),reference:z.string().max(1000),error:z.string().max(1000)}).strict(),
]);
export type RequestInput=z.infer<typeof inputSchema>;
export function canonical(v:unknown):string {if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';}
export async function digest(v:unknown){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');}
export class ApiError extends Error{constructor(public code:string,public status=409){super(code)}}
