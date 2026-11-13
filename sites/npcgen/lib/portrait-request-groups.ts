import {portraitGroups} from './portrait-order';
import {portraitDisplay} from './portrait-display';
type Portrait={assetId?:unknown;sourceRef?:unknown;label?:unknown};
export type PortraitRequestGroup<T extends Portrait=Portrait>={id:string;requestId:string;title:string;createdAt?:string;legacy:boolean;status:string;items:T[];activePortraitId?:string};
/** Never pack legacy singletons together: request identity, not page layout, owns candidates. */
export function portraitRequestGroups<T extends Portrait>(portraits:readonly T[],origins:Record<string,any>={},registrations:any[]=[],activePortraitId?:string,npcId?:string):PortraitRequestGroup<T>[] {
 const recordedAt=(value:unknown)=>{if(typeof value!=='string'&&typeof value!=='number')return undefined;const d=new Date(value);return Number.isFinite(d.getTime())?d.toISOString():undefined;};
 const groups=new Map<string,PortraitRequestGroup<T>>();
 for(const raw of portraitGroups(portraits,origins)){
  for(const p of raw.items){
   const origin=origins[String(p.assetId)],request=origin?.request,source=String(p.sourceRef||'');
   const sourceRequest=source.match(/(?:^|;)request:([^;]+)/)?.[1],run=source.match(/(?:^|;)run:(.+)\.\d+(?:;|$)/)?.[1];
   const requestId=String(request?.localRequestId||sourceRequest||request?.registrationIntentId||'');
   const id=requestId||'legacy.'+(run||String(p.assetId));
   let g=groups.get(id);if(!g){g={id,requestId:id,title:requestId?'생성 요청 · '+requestId.slice(-8):run?'기존 생성 묶음 · '+run.slice(-8):String(p.label||'기존 포트레이트'),createdAt:recordedAt(request?.createdAt),legacy:!requestId,status:'생성 완료 · 선택 대기',items:[]};groups.set(id,g);}
   g.items.push(p);if(String(p.assetId)===activePortraitId){g.activePortraitId=activePortraitId;g.status='현재 대표 적용 완료';}
   if(request){const d=portraitDisplay(request);if(d.intent)g.title=String(d.intent).slice(0,72);g.createdAt=recordedAt(request.createdAt)||g.createdAt;}
  }
 }
 for(const request of registrations){
  const d=portraitDisplay(request);if(npcId&&d.npcId&&d.npcId!==npcId)continue;
  const id=String(request.localRequestId||request.registrationIntentId||'');if(!id)continue;
  const existing=groups.get(id);if(existing){existing.createdAt=recordedAt(request.createdAt)||existing.createdAt;if(d.intent)existing.title=String(d.intent).slice(0,72);continue;}
  groups.set(id,{id,requestId:id,title:String(d.intent||'포트레이트 생성 요청').slice(0,72),createdAt:recordedAt(request.createdAt),legacy:!!request.legacy,status:request.error?'처리 확인 필요':request.portraitResult?.publication?'게시 후보 확인 필요':'후보 생성·게시 대기',items:[]});
 }
 return [...groups.values()].sort((a,b)=>{const ta=Date.parse(a.createdAt||''),tb=Date.parse(b.createdAt||'');return (Number.isFinite(tb)?tb:0)-(Number.isFinite(ta)?ta:0);});
}
export function portraitRequestChoice<T extends Portrait>(group:PortraitRequestGroup<T>,assetId:string){if(!group.items.some(p=>String(p.assetId)===assetId))throw Error('PORTRAIT_REQUEST_CANDIDATE_MISMATCH');return {requestId:group.requestId,assetId};}
