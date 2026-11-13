import {hierarchyChanges,type ConceptHierarchy} from '../../lib/concept-hierarchy';
import {object,rows,type Json,type ChangeRequest} from './adapter';
import {categoryBody,changedValues} from './catalog-history-model';
import type {CategoryTarget} from './category-revision-model';
export type HistoryRecord={revision:number;lineage?:string;body?:Json;time?:Json;note?:Json;author?:Json;bodyResource:string};
export type ReadableChange={id:string;label:string;category:string;categoryLabel:string;field:string;kind:'keywords'|'sentence'|'summary-added'|'summary-format'|'added'|'removed'|'value';before?:Json;after?:Json;added?:string[];removed?:string[]};
export type RequestHistoryItem={id:string;title:string;kind:'request'|'quality'|'record';requestText:string;request?:ChangeRequest;record?:HistoryRecord;previous?:HistoryRecord;changes:ReadableChange[]|null;changedCount:number;categories:{id:string;label:string;count:number}[];beforeRevision?:number;afterRevision?:number;requestedAt?:string;appliedAt?:string;status:string;scope:string};
const labels:Record<string,string>={summary:'핵심 요약',description:'영역 설명',value:'본문',title:'제목',label:'이름',status:'상태',priority:'우선순위'};
function keywordList(value:Json|undefined){const v=object(value);return v.schemaVersion==='npc-concept-summary.v1'&&Array.isArray(v.keywords)&&v.keywords.every(k=>typeof k==='string')?v.keywords as string[]:null;}
export function readableChanges(before:Json|undefined,after:Json|undefined,target:CategoryTarget):ReadableChange[]|null{
 if(before===undefined||after===undefined)return null;
 const a=object(object(before).document??before),b=object(object(after).document??after),result:ReadableChange[]=[];
 function add(id:string,label:string,category:string,categoryLabel:string,key:string,old:Json|undefined,next:Json|undefined){
  if(JSON.stringify(old)===JSON.stringify(next))return;
  const common={id,label,category,categoryLabel,field:labels[key]||key,before:old,after:next};const oldKeys=keywordList(old),newKeys=keywordList(next);
  if(key==='summary'&&oldKeys&&newKeys){
   if(JSON.stringify(oldKeys)!==JSON.stringify(newKeys))result.push({...common,field:'키워드',kind:'keywords',before:oldKeys,after:newKeys,added:newKeys.filter(v=>!oldKeys.includes(v)),removed:oldKeys.filter(v=>!newKeys.includes(v))});
   if(object(old).sentence!==object(next).sentence)result.push({...common,field:'요약 문장',kind:'sentence',before:object(old).sentence,after:object(next).sentence});
  }else result.push({...common,kind:old===undefined?(key==='summary'?'summary-added':'added'):next===undefined?'removed':key==='summary'&&newKeys?'summary-format':'value'});
 }
 if(target.resource==='concept'&&Array.isArray(a.sections)&&Array.isArray(b.sections)){
  if(JSON.stringify(a.hierarchy)!==JSON.stringify(b.hierarchy)&&b.hierarchy){const categoryLabels=Object.fromEntries(rows(b.sections).map(s=>[String(s.id),String(s.title||s.id)]));const next=b.hierarchy as unknown as ConceptHierarchy;const lines=hierarchyChanges(a.hierarchy as unknown as ConceptHierarchy|undefined,next,categoryLabels);result.push({id:'concept.hierarchy',label:'상위 그룹 구조',category:target.targetId,categoryLabel:'마스터 컨셉 그룹 구조',field:'그룹과 세부 카테고리 배치',kind:'value',before:a.hierarchy?hierarchyChanges(undefined,a.hierarchy as unknown as ConceptHierarchy,categoryLabels).join('\n'):`상위 그룹 없음 · 기존 ${rows(a.sections).length}개 세부 카테고리`,after:`${next.groups.length}개 상위 그룹 · ${rows(b.sections).length}개 세부 카테고리\n`+lines.join('\n')});}
  const entities=(doc:ReturnType<typeof object>)=>rows(doc.sections).flatMap(s=>{const category=String(s.id),categoryLabel=String(s.title||s.label||s.id);return [{entity:s,category,categoryLabel},...rows(s.fields).map(entity=>({entity,category,categoryLabel}))];});
  const left=new Map(entities(a).map(v=>[String(v.entity.id),v])),right=new Map(entities(b).map(v=>[String(v.entity.id),v]));
  for(const id of new Set([...left.keys(),...right.keys()])){const l=left.get(id),r=right.get(id),v=r||l!;const old=l?.entity||{},next=r?.entity||{};for(const key of new Set([...Object.keys(old),...Object.keys(next)]))if(!['id','fields','sources','sourceRefs','sourcePath','legacyReferences','provenance'].includes(key))add(id,String(next.title||next.label||old.title||old.label||id),v.category,v.categoryLabel,key,old[key],next[key]);}
 }else {const left=categoryBody(before,target),right=categoryBody(after,target);if(left===undefined||right===undefined)return null;for(const d of changedValues(left,right)||[])add(target.targetId,target.targetLabel,target.category,target.label,d.key,d.before,d.after);}
 return result;
}
export function requestStatusLabel(item:RequestHistoryItem){return ({requested:'접수됨 · 처리 대기',accepted:'검토 승인',processing:'처리 중',applied:'반영 완료',conflict:'기준 문서 충돌',failed:'처리 실패',record:'문서 기록'} as Record<string,string>)[item.status]||item.status;}
export function historyTime(value?:string){if(!value)return '';const date=new Date(value);return Number.isNaN(date.getTime())?value:new Intl.DateTimeFormat('ko-KR',{dateStyle:'medium',timeStyle:'short',timeZone:'UTC'}).format(date)+' UTC';}
function concise(text:string){return text.replace(/\s+/g,' ').trim().slice(0,90)||'요청 상세 조회 중';}
export function requestHistoryItems(requests:ChangeRequest[],records:HistoryRecord[],target:CategoryTarget):RequestHistoryItem[]{
 const used=new Set<number>();const items:RequestHistoryItem[]=requests.map(request=>{
  const receipt=object(request.commitReceipt),afterRevision=Number.isInteger(receipt.afterRevision)?Number(receipt.afterRevision):undefined,beforeRevision=Number.isInteger(receipt.beforeRevision)?Number(receipt.beforeRevision):undefined;
  const record=records.find(r=>r.revision===afterRevision),previous=records.find(r=>r.revision===beforeRevision);if(record)used.add(record.revision);
  const text=String(object(request.payload).requirements||object(request.payload).note||(request.payloadDeferred?'':record?.note)||'');
  const quality=String(receipt.approvedJobId||'').includes('grammar')||text.includes('품질 교정');
  const changes=readableChanges(previous?.body,record?.body,target),kinds=new Set(changes?.map(d=>d.kind)),changedCount=new Set(changes?.map(d=>d.id)).size;
  const categories=Array.from(new Set(changes?.map(d=>d.category))).map(id=>{const list=changes!.filter(d=>d.category===id);return {id,label:list[0].categoryLabel,count:new Set(list.map(d=>d.id)).size};});
  const title=receipt.hierarchyChange?'마스터 컨셉 상위 그룹 구조 개편':quality?'요약 문법 교정':kinds.size===1&&kinds.has('keywords')?'키워드 기준 정리':kinds.size===1&&kinds.has('summary-added')?'핵심 요약 추가':kinds.has('summary-format')?'키워드와 한 문장 요약으로 변경':concise(text);
  const local=request.publicationState==='local_applied'&&receipt.scope==='permanent-local-copy';
  return {id:request.requestId,title,kind:quality?'quality':'request',requestText:text,request,record,previous,changes,changedCount,categories,beforeRevision,afterRevision,requestedAt:request.createdAt,appliedAt:typeof record?.time==='string'?record.time:undefined,status:request.status,scope:local?'보존된 개발 사본 계보 · 원본 정합화는 별도 개정 33 · Space 미배포':request.status!=='applied'?'아직 반영되지 않음':request.publicationConfirmed?'스냅샷 반영 확인 · 원본 반영 범위는 receipt 참조':'원본·사본 반영 범위 정보 미제공'};
 });
 for(const record of records)if(!used.has(record.revision)){if(target.area==='npcs'&&record.body&&categoryBody(record.body,target)===undefined)continue;const previous=records.filter(r=>r.revision<record.revision&&r.lineage===record.lineage).sort((a,b)=>b.revision-a.revision)[0],changes=readableChanges(previous?.body,record.body,target);if(changes&&changes.length===0)continue;const categories=Array.from(new Set(changes?.map(d=>d.category))).map(id=>({id,label:changes!.find(d=>d.category===id)!.categoryLabel,count:new Set(changes!.filter(d=>d.category===id).map(d=>d.id)).size}));items.push({id:'record.'+record.revision,title:concise(String(record.note||'기준 문서 기록')),kind:'record',requestText:String(record.note||''),record,previous,changes,changedCount:new Set(changes?.map(d=>d.id)).size,categories,beforeRevision:previous?.revision,afterRevision:record.revision,appliedAt:typeof record.time==='string'?record.time:undefined,status:'record',scope:'실제 저장 문서 기록 · 연결된 사용자 요청 정보 미제공'});}
 return items.sort((a,b)=>(Date.parse(b.appliedAt||b.requestedAt||'')||0)-(Date.parse(a.appliedAt||a.requestedAt||'')||0)||(b.afterRevision||0)-(a.afterRevision||0));
}
