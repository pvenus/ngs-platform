import {portraitDisplay} from './portrait-display';
import {portraitRequestGroups} from './portrait-request-groups';

type Data=Record<string,unknown>;
const record=(value:unknown):Data=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Data:{};
const list=(value:unknown):Data[]=>Array.isArray(value)?value.map(record):[];
export type CommonPortraitRequest={requestId:string;projectId:string;localRequestId?:string;character?:{npcId?:string};aliases?:{originalId:string}[]};
export function resolvePortraitRegistration(summary:CommonPortraitRequest,registrations:unknown){
 const ids=new Set([summary.requestId,summary.localRequestId,...(summary.aliases||[]).map(a=>a.originalId)].filter(Boolean));
 const matches=list(registrations).filter(r=>ids.has(String(r.localRequestId||''))||ids.has(String(r.registrationIntentId||'')));
 if(matches.length!==1)throw Error(matches.length?'포트레이트 요청 출처가 중복됩니다.':'정식 포트레이트 요청 결과를 확인할 수 없습니다.');
 const request=matches[0],display=portraitDisplay(request),npcId=String(display.npcId||'');
 if(request.projectId!==summary.projectId||!npcId||summary.character?.npcId&&summary.character.npcId!==npcId)throw Error('포트레이트 요청의 프로젝트·인물 연결이 일치하지 않습니다.');
 return {request,npcId};
}
/** Bind one Common request to its published portraits; never fill slots from another request. */
export function unifiedPortraitComparison(summary:CommonPortraitRequest,registrations:unknown,npcValue:unknown){
 const {request,npcId}=resolvePortraitRegistration(summary,registrations),npc=record(npcValue);
 if(npc.id!==npcId)throw Error('선택한 인물의 포트레이트 사본이 일치하지 않습니다.');
 const result=record(request.portraitResult),published=!!result.publication,outputs=list(result.results),portraits=[...new Map(list(npc.portraits).map(p=>[String(p.assetId),p])).values()],origins:Record<string,{request:Data;output:Data}>={};
 if(published){
  if(outputs.length!==3||new Set(outputs.map(v=>v.portraitId)).size!==3)throw Error('게시된 포트레이트 3후보의 연결을 확인할 수 없습니다.');
  for(const output of outputs){
   const portrait=portraits.find(p=>p.assetId===output.portraitId),asset=record(output.asset);
   if(!portrait||!asset.id||!request.localRequestId||!String(portrait.sourceRef).includes(String(asset.id))||!String(portrait.sourceRef).includes(String(request.localRequestId)))throw Error('포트레이트 후보와 정식 등록 출처가 일치하지 않습니다.');
   origins[String(output.portraitId)]={request,output};
  }
 }
 const group=portraitRequestGroups(portraits,origins,[request],String(npc.activePortraitId||''),npcId).find(g=>g.requestId===String(request.localRequestId||request.registrationIntentId));
 if(!group||published&&(group.items.length!==3||group.items.some(p=>!origins[String(p.assetId)])))throw Error('이 요청에 속한 포트레이트 후보만 비교할 수 있습니다.');
 return {npcId,npcName:String(npc.name||npcId),group,origins,published,
  generationStatus:published?'생성·게시 완료 · 후보 3개':'후보 생성·게시 대기',
  representativeStatus:group.activePortraitId?'대표 확정 · 현재 대표 적용 완료':npc.activePortraitId?'이 요청의 대표 선택 대기 · 기존 대표 유지':'대표 선택 대기 · 대표 포트레이트 없음'};
}
