import {frontendFetch,frontendAssetUrl} from '@/lib/frontend-transport.mjs';
/** UI boundary only. Backend owns wire contracts; configure transport here. */
export type Json = null | boolean | number | string | Json[] | {[key:string]:Json};
export type RecordData = {[key:string]:Json};
export type Snapshot = {storyCatalogRef?:{catalogId:string;catalogVersion:number;catalogHash:string};catalogLazy?:boolean;catalogIndexPending?:boolean;projectId:string;snapshotId:string;sourceRevision:string;sourceRevisionVector?:Record<string,string|number>;resources:{logicalResourceId:string;kind:string;assetId?:string;sha256?:string;size?:number;mime?:string}[];schemaVersion:string;contentHash:string;authorizationScope?:string;clientReadAt?:string;lastSyncedAt:string;consistency?:RecordData;documents:RecordData;pendingRequests?:ChangeRequest[]};
export type ChangeRequest = {actorId?:string;createdAt?:string;operation?:string;reviewState?:string;intakeOnly?:boolean;payloadDeferred?:boolean;requestId:string;targetId:string;status:string;payload:Json;publicationState?:string;reportedPublicationState?:string;publicationConfirmed?:boolean;commitReceipt?:Json;error?:string;logicalResourceId?:string;publishedSnapshotId?:string;baseRevision?:string;refreshError?:string};
export function confirmPublication(request:ChangeRequest,snapshot:Snapshot):ChangeRequest {
 const reported=request.reportedPublicationState||request.publicationState;
 const receipt=object(request.commitReceipt),localApplied=reported==='local_applied'&&receipt.scope==='permanent-local-copy'&&request.publishedSnapshotId===snapshot.snapshotId&&receipt.sourceRevision===snapshot.sourceRevision&&snapshot.resources.some(r=>r.logicalResourceId===request.logicalResourceId&&r.sha256===receipt.documentHash);
 const confirmed=localApplied||reported==='published'&&(request.publicationConfirmed===true||request.publishedSnapshotId===snapshot.snapshotId);
 return {...request,reportedPublicationState:reported,publicationConfirmed:confirmed,publicationState:localApplied?'local_applied':reported==='published'&&!confirmed?'pending':reported};
}
export type Proposal = {projectId:string;baseRevision:string;baseHash:string;operation:string;targetId:string;logicalResourceId:string;payload:RecordData;idempotencyKey:string};
export interface CatalogTransport {read(projectId:string,signal?:AbortSignal):Promise<Snapshot>;reuse?(projectId:string,signal?:AbortSignal):Promise<Snapshot>;authorize?(snapshot:Snapshot,signal?:AbortSignal):Promise<void>;history?(snapshot:Snapshot,resource:string,targetId:string,signal?:AbortSignal):Promise<Json>;part?(snapshot:Snapshot,resource:string,selection:string,npcId?:string,signal?:AbortSignal):Promise<Json>;peek?(snapshot:Snapshot,resource:string,selection:string,npcId?:string):Json|undefined;intakeCapability?(projectId:string):Promise<{schemaVersion:string;projectId:string;resource:string;enabled:boolean;groupOperations?:{processorConnected:boolean;reason?:string;canonicalRevision?:number;projectionRevision?:number;canonicalLineage?:string;localArchiveRevision?:number}}>;groupReadiness?(projectId:string):Promise<{processorConnected:boolean;reason?:string}>;submit(proposal:Proposal):Promise<ChangeRequest>;request?(projectId:string,requestId:string):Promise<ChangeRequest>}
export class CatalogAccessError extends Error {constructor(message:string,public status:number){super(message);}}
/** One initialization read; choose canonical only when a complete snapshot exists. */
export async function readAvailableProject(transport:CatalogTransport,preferred:string,compatibility:string,signal?:AbortSignal):Promise<Snapshot>{
 try{return await (transport.reuse?transport.reuse(preferred,signal):transport.read(preferred,signal));}catch(error){
  if(signal?.aborted||error instanceof CatalogAccessError&&[401,403].includes(error.status))throw error;
  return transport.reuse?transport.reuse(compatibility,signal):transport.read(compatibility,signal);
 }
}
async function json<T>(response:Response):Promise<T>{const value=await response.json() as {error?:string};if(!response.ok)throw new CatalogAccessError(value.error||`조회 실패 (${response.status})`,response.status);return value as T;}
let cacheGeneration=0;
const partCache=new Map<string,{projectId:string;value:Json;bytes:number}>();
const documentCache=new Map<string,Snapshot>();
const portraitRequestCache=new Map<string,{etag:string;value:any}>();
const categoryRequestCache=new Map<string,{value:any[];readAt:string;bytes:number}>();
export const catalogCacheReset='npcgen-catalog-cache-reset';
export function invalidateCatalogReads(projectId?:string,npcId?:string){cacheGeneration++;for(const [key,entry] of partCache)if(!projectId||entry.projectId===projectId)partCache.delete(key);if(projectId)documentCache.delete(projectId);else documentCache.clear();for(const key of categoryRequestCache.keys())if((!projectId||key.split('|')[1]===projectId)&&(!npcId||key.split('|')[2]===npcId))categoryRequestCache.delete(key);for(const key of portraitRequestCache.keys())if(!projectId||key.split('|')[1]===projectId)portraitRequestCache.delete(key);}
export function purgeCatalogCaches(projectId?:string,denied=false){invalidateCatalogReads(projectId);if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent(catalogCacheReset,{detail:{projectId,denied}}));}
async function checkedJson<T>(response:Response,projectId:string):Promise<T>{if(response.status===401)purgeCatalogCaches(undefined,true);else if(response.status===403)purgeCatalogCaches(projectId,true);return json<T>(response);}
function assertScope(actual:string|undefined,expected:string|undefined,projectId:string){if(!actual||!expected||actual!==expected){purgeCatalogCaches(undefined,true);throw new CatalogAccessError('계정 범위가 바뀌었습니다. 승인된 자료를 다시 조회하세요.',401);}}
export function rememberCatalogSnapshot(snapshot:Snapshot){if(!snapshot.authorizationScope)return;documentCache.set(snapshot.projectId,snapshot);while(documentCache.size>2)documentCache.delete(documentCache.keys().next().value!);}
export async function readCategoryRequests(snapshot:Snapshot,npcId:string,force=false,signal?:AbortSignal){
 const key=snapshot.authorizationScope?`${snapshot.authorizationScope}|${snapshot.projectId}|${npcId}`:null,cached=key?categoryRequestCache.get(key):undefined,generation=cacheGeneration;
 if(!force&&cached){const permission=await checkedJson<{projectId:string;authorizationScope:string}>(await frontendFetch('/api/npc-category?view=access&projectId='+encodeURIComponent(snapshot.projectId),{cache:'no-store',signal}),snapshot.projectId);if(signal?.aborted)throw new DOMException('Aborted','AbortError');assertScope(permission.authorizationScope,snapshot.authorizationScope,snapshot.projectId);if(permission.projectId!==snapshot.projectId||generation!==cacheGeneration)throw Error('재사용 자료의 범위가 바뀌었습니다. 다시 조회하세요.');return {value:structuredClone(cached.value),readAt:cached.readAt};}
 const response=await frontendFetch('/api/npc-category?view=list&projectId='+encodeURIComponent(snapshot.projectId)+'&npcId='+encodeURIComponent(npcId),{cache:'no-store',signal}),value=await checkedJson<any[]>(response,snapshot.projectId),scope=response.headers.get('X-NPC-Authorization-Scope');
 if(signal?.aborted)throw new DOMException('Aborted','AbortError');if(scope)assertScope(scope,snapshot.authorizationScope,snapshot.projectId);if(!Array.isArray(value))throw Error('완전한 카테고리 목록을 확인하지 못했습니다.');
 const readAt=new Date().toISOString(),bytes=new TextEncoder().encode(JSON.stringify(value)).length;
 if(key&&scope&&generation===cacheGeneration&&bytes<=1024*1024){categoryRequestCache.delete(key);categoryRequestCache.set(key,{value:structuredClone(value),readAt,bytes});while(categoryRequestCache.size>16||[...categoryRequestCache.values()].reduce((n,c)=>n+c.bytes,0)>4*1024*1024)categoryRequestCache.delete(categoryRequestCache.keys().next().value!);}
 return {value,readAt};
}
export async function readPortraitRequests(snapshot:Snapshot,npcId:string,signal?:AbortSignal){
 const generation=cacheGeneration,key=snapshot.authorizationScope?`${snapshot.authorizationScope}|${snapshot.projectId}|${npcId}`:null,cached=key?portraitRequestCache.get(key):undefined;
 const response=await frontendFetch('/api/prompt?view=portrait&projectId='+encodeURIComponent(snapshot.projectId),{cache:'no-store',signal,headers:cached?{'If-None-Match':cached.etag}:{}});
 if(response.status===304){if(!cached)throw Error('출처 재사용 기준이 없습니다.');return cached.value;}
 const value=await checkedJson<any>(response,snapshot.projectId),etag=response.headers.get('ETag');if(key&&etag&&generation===cacheGeneration){portraitRequestCache.set(key,{etag,value});while(portraitRequestCache.size>8)portraitRequestCache.delete(portraitRequestCache.keys().next().value!);}return value;
}
export async function readCategoryDetail(snapshot:Snapshot,npcId:string,copy:{transferKey:string;requestHash:string;proposalHash:string;state:string},signal?:AbortSignal){
 const key=JSON.stringify(['proposal',snapshot.authorizationScope,snapshot.projectId,npcId,copy.transferKey,copy.requestHash,copy.proposalHash,copy.state]),cached=partCache.get(key),generation=cacheGeneration;
 if(cached){await catalogTransport.authorize!(snapshot,signal);if(signal?.aborted||generation!==cacheGeneration)throw new DOMException('Aborted','AbortError');return structuredClone(cached.value);}
 const response=await frontendFetch('/api/npc-category?'+new URLSearchParams({view:'detail',projectId:snapshot.projectId,npcId,transferKey:copy.transferKey}),{cache:'no-store',signal}),value=await checkedJson<any>(response,snapshot.projectId);assertScope(response.headers.get('X-NPC-Authorization-Scope')||undefined,snapshot.authorizationScope,snapshot.projectId);
 if(signal?.aborted||generation!==cacheGeneration)throw new DOMException('Aborted','AbortError');if(value.transferKey!==copy.transferKey||value.requestHash!==copy.requestHash||value.proposalHash!==copy.proposalHash||value.inputs?.npcId!==npcId)throw Error('기획안 조회 기준이 바뀌었습니다. 상태를 다시 조회하세요.');
 const bytes=new TextEncoder().encode(JSON.stringify(value)).length;if(bytes<=1024*1024){partCache.set(key,{projectId:snapshot.projectId,value,bytes});while(partCache.size>128||[...partCache.values()].reduce((n,e)=>n+e.bytes,0)>16*1024*1024)partCache.delete(partCache.keys().next().value!);}return value;
}
function partIdentity(snapshot:Snapshot,resource:string,selection:string,npcId=''){
 const descriptor=['docs','knowledge'].includes(resource)&&selection==='index'?{sha256:snapshot.resources.filter(r=>r.kind==='document'&&r.logicalResourceId.startsWith(resource+'.')).map(r=>r.logicalResourceId+':'+r.sha256).join('|')||'empty'}:snapshot.resources.find(r=>r.kind==='document'&&r.logicalResourceId===resource);
 if(!descriptor?.sha256||!snapshot.authorizationScope)return null;
 return {descriptor,key:JSON.stringify([snapshot.authorizationScope,snapshot.projectId,snapshot.snapshotId,snapshot.contentHash,resource,descriptor.sha256,selection,npcId])};
}
/** Synchronous completed-body lookup only. Pending/failed reads never enter this map;
 * live ACL checks continue in part() and the read boundary. */
export function peekCatalogPart(snapshot:Snapshot,resource:string,selection:string,npcId=''){const identity=partIdentity(snapshot,resource,selection,npcId);return identity?partCache.get(identity.key)?.value:undefined;}
export async function readCatalogPart(snapshot:Snapshot,resource:string,selection:string,npcId='',signal?:AbortSignal):Promise<Json>{
 const identity=partIdentity(snapshot,resource,selection,npcId);if(!identity)throw Error('본문 조회 기준이 없습니다.');
 const {key,descriptor}=identity,generation=cacheGeneration,cached=partCache.get(key);
 if(cached){await catalogTransport.authorize!(snapshot,signal);if(signal?.aborted||generation!==cacheGeneration)throw new DOMException('Aborted','AbortError');partCache.delete(key);partCache.set(key,cached);return structuredClone(cached.value);}
 const result=await checkedJson<{projectId:string;snapshotId:string;contentHash:string;authorizationScope:string;logicalResourceId:string;resourceHash:string;selection:string;npcId:string;value:Json}>(await frontendFetch('/api/mirror?'+new URLSearchParams({view:'part',projectId:snapshot.projectId,snapshotId:snapshot.snapshotId,resource,selection,npcId}),{cache:'no-store',signal}),snapshot.projectId);
 assertScope(result.authorizationScope,snapshot.authorizationScope,snapshot.projectId);
 if(signal?.aborted||generation!==cacheGeneration)throw new DOMException('Aborted','AbortError');
 if(result.projectId!==snapshot.projectId||result.snapshotId!==snapshot.snapshotId||result.contentHash!==snapshot.contentHash||result.logicalResourceId!==resource||result.resourceHash!==descriptor.sha256||result.selection!==selection||result.npcId!==npcId||!Object.hasOwn(result,'value'))throw Error('선택한 본문의 사본 기준이 일치하지 않습니다.');
 const bytes=new TextEncoder().encode(JSON.stringify(result.value)).length;
 if(bytes<=4*1024*1024){partCache.set(key,{projectId:snapshot.projectId,value:structuredClone(result.value),bytes});while(partCache.size>128||[...partCache.values()].reduce((n,e)=>n+e.bytes,0)>16*1024*1024)partCache.delete(partCache.keys().next().value!);}
 return result.value;
}
export const catalogTransport:CatalogTransport={
 part:readCatalogPart,peek:peekCatalogPart,
 async history(snapshot,resource,targetId,signal){const value=await checkedJson<any>(await frontendFetch('/api/mirror?'+new URLSearchParams({view:'history',projectId:snapshot.projectId,snapshotId:snapshot.snapshotId,resource,targetId}),{cache:'no-store',signal}),snapshot.projectId);if(value.schemaVersion!=='npc-local-retained-history.v1'||value.projectId!==snapshot.projectId||value.snapshotId!==snapshot.snapshotId||value.targetId!==targetId||value.resource!==resource)throw Error('HISTORY_SCOPE_MISMATCH');return value;},
 async authorize(snapshot,signal){const permission=await checkedJson<{projectId:string;snapshotId:string;contentHash:string;authorizationScope:string}>(await frontendFetch('/api/mirror?'+new URLSearchParams({view:'access',projectId:snapshot.projectId,snapshotId:snapshot.snapshotId}),{cache:'no-store',signal}),snapshot.projectId);if(signal?.aborted)throw new DOMException('Aborted','AbortError');assertScope(permission.authorizationScope,snapshot.authorizationScope,snapshot.projectId);if(permission.projectId!==snapshot.projectId||permission.snapshotId!==snapshot.snapshotId||permission.contentHash!==snapshot.contentHash){purgeCatalogCaches(snapshot.projectId,true);throw new CatalogAccessError('재사용 자료의 권한 범위를 확인하지 못했습니다.',403);}},
 async reuse(projectId,signal){const cached=documentCache.get(projectId),generation=cacheGeneration;if(!cached)return catalogTransport.read(projectId,signal);await catalogTransport.authorize!(cached,signal);if(generation!==cacheGeneration||signal?.aborted)throw new DOMException('Aborted','AbortError');return cached;},
 async read(projectId,signal){
  invalidateCatalogReads(projectId);
  const generation=cacheGeneration,params=new URLSearchParams({projectId,view:'catalog'});
  const response=await checkedJson<{snapshot:Snapshot|null;pendingRequests:ChangeRequest[];documentsUnchanged?:boolean}>(await frontendFetch('/api/mirror?'+params,{cache:'no-store',signal}),projectId),next=response.snapshot;
  if(signal?.aborted||generation!==cacheGeneration)throw new DOMException('Aborted','AbortError');
  if(!next){documentCache.delete(projectId);throw Error('게시된 사본이 없습니다. owner의 원본 commit과 사본 게시가 완료되면 표시됩니다.');}
  if(next.projectId!==projectId||!next.snapshotId||!next.contentHash)throw Error('완전한 게시 사본을 확인하지 못했습니다.');
  if(!next.documents)throw Error('게시 자료의 목록을 확인하지 못했습니다.');
  const snapshot={...next,pendingRequests:response.pendingRequests,clientReadAt:new Date().toISOString()};rememberCatalogSnapshot(snapshot);return snapshot;
 },
 async request(projectId,requestId){return checkedJson<ChangeRequest>(await frontendFetch(`/api/mirror?projectId=${encodeURIComponent(projectId)}&requestId=${encodeURIComponent(requestId)}`,{cache:'no-store'}),projectId);},
 async groupReadiness(projectId){return checkedJson(await frontendFetch('/api/mirror?view=group-readiness&projectId='+encodeURIComponent(projectId),{cache:'no-store'}),projectId);},
 async intakeCapability(projectId){return checkedJson(await frontendFetch('/api/mirror?view=category-intake&projectId='+encodeURIComponent(projectId),{cache:'no-store'}),projectId);},
 async submit(proposal){const result=await checkedJson<ChangeRequest>(await frontendFetch('/api/mirror',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request',...proposal})}),proposal.projectId);invalidateCatalogReads(proposal.projectId);return result;}
};
export function object(value:Json|undefined):RecordData{return value!==null&&typeof value==='object'&&!Array.isArray(value)?value:{};}
export function rows(value:Json|undefined):RecordData[]{return Array.isArray(value)?value.map(object):[];}
export function textValue(value:Json|undefined):string{return value===undefined?'미제공':value===null?'미설정':typeof value==='string'?value:JSON.stringify(value);}
export function npcMatches(npc:RecordData,search:string,status:string,chapter:string){const haystack=[npc.name,npc.role,npc.kind,npc.id,...(Array.isArray(npc.chapters)?npc.chapters:[])].join(' ').toLocaleLowerCase('ko-KR');return (!search.trim()||haystack.includes(search.trim().toLocaleLowerCase('ko-KR')))&&(status==='all'||npc.status===status)&&(chapter==='all'||Array.isArray(npc.chapters)&&npc.chapters.includes(chapter));}
export function publishedAsset(snapshot:Snapshot,assetId:string):string|undefined {if(!snapshot.resources?.some(r=>r.kind==='asset'&&r.assetId===assetId))return;return frontendAssetUrl(`/api/mirror?projectId=${encodeURIComponent(snapshot.projectId)}&snapshotId=${encodeURIComponent(snapshot.snapshotId)}&assetId=${encodeURIComponent(assetId)}`);}
export function documentOf(snapshot:Snapshot,id:string):RecordData {const envelope=object(snapshot.documents[id]);return envelope.document!==undefined?object(envelope.document):envelope;}
export const statusLabels:Record<string,string>={proposal:'설계 제안',review:'검토 필요',confirmed:'기획 확정',source:'원본 근거',requested:'접수 대기',accepted:'검토 승인',processing:'로컬 처리 중',applied:'로컬 반영 완료',conflict:'기준 개정 충돌',failed:'처리 실패'};
