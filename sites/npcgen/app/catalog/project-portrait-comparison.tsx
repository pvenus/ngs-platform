'use client';
import {PortraitStagedReview} from './portrait-staged-review';
import {useLoopbackSingle}from '../frontend-session';
import {contentOperationsRpc}from './content-operations-api';
import {useCallback,useEffect,useState} from 'react';
import {resolvePortraitRegistration,unifiedPortraitComparison,type CommonPortraitRequest} from '@/lib/unified-portrait-request';
import {readPortraitRequests,readCatalogPart,type Snapshot,type RecordData} from './adapter';
import {PortraitRequestComparison} from './portraits';
import type {PortraitRequestGroup} from '@/lib/portrait-request-groups';
type Model=ReturnType<typeof unifiedPortraitComparison>;
export function ProjectPortraitComparison({snapshot,summary,onPublished,refresh,onBusyChange}:{snapshot:Snapshot;summary:CommonPortraitRequest&{revision?:number};onPublished?:()=>void;refresh:()=>void;onBusyChange:(busy:boolean)=>void}){
 const local=useLoopbackSingle(),[admitted,setAdmitted]=useState<boolean|null>(null);
 const [result,setResult]=useState<{key:string;model:Model|null;error:string}>({key:'',model:null,error:''}),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
 const key=[snapshot.projectId,snapshot.authorizationScope,snapshot.snapshotId,summary.requestId,summary.revision,version].join('|'),loading=result.key!==key,model=result.model,error=loading?'':result.error;
 useEffect(()=>{let alive=true;queueMicrotask(()=>{if(alive)setAdmitted(null);});if(local&&snapshot.projectId==='binari')void contentOperationsRpc({operation:'npc-catalog-request-targets'}).then(v=>{if(alive)setAdmitted(v.available===true&&Array.isArray(v.npcIds)&&v.npcIds.includes(model?.npcId||summary.character?.npcId));}).catch(()=>{if(alive)setAdmitted(false);});return()=>{alive=false;};},[local,snapshot.projectId,summary.character?.npcId,model?.npcId,version]);
 useEffect(()=>{const controller=new AbortController();
  async function read(){try{const data=await readPortraitRequests(snapshot,summary.character?.npcId||'',controller.signal),{npcId}=resolvePortraitRegistration(summary,data.registrations),npc=await readCatalogPart(snapshot,'npcs','portraits',npcId,controller.signal);if(!controller.signal.aborted)setResult({key,model:unifiedPortraitComparison(summary,data.registrations,npc),error:''});}catch(e){if(!controller.signal.aborted)setResult({key,model:null,error:e instanceof Error?e.message:'포트레이트 후보를 읽지 못했습니다.'});}}
  void read();return()=>controller.abort();
 },[snapshot,summary,key]);
 const onBusy=useCallback((value:boolean)=>{setBusy(value);onBusyChange(value);},[onBusyChange]);
 return <section aria-label="정식 포트레이트 요청 비교"><button type="button" disabled={loading||busy} onClick={()=>setVersion(v=>v+1)}>포트레이트 후보·상태 다시 조회</button><p role="status">{loading?'정식 포트레이트 후보와 게시 상태 조회 중…':model?.generationStatus||'포트레이트 결과 조회 필요'}</p>{model&&<><p role="status">{model.npcName} · {model.representativeStatus}</p>{local&&snapshot.projectId==='binari'&&admitted===false&&<p>레거시·보존 대상 또는 현재 대상 검증 대기 · 후보와 이력 조회 전용</p>}<p className="meta">요청 완료는 후보 생성·등록·게시 완료입니다. 대표 선택과 확정은 별도이며 선택만으로 원본은 변경되지 않습니다.</p><PortraitRequestComparison key={summary.requestId+'|'+model.group.id} group={model.group as PortraitRequestGroup<RecordData>} npcId={model.npcId} npcName={model.npcName} origins={model.origins} snapshot={snapshot} readOnly={loading||!!error||local&&snapshot.projectId==='binari'&&admitted!==true} onBusyChange={onBusy} onConfirmed={()=>{refresh();onPublished?.();setVersion(v=>v+1);}}/></>}{!loading&&<PortraitStagedReview projectId={snapshot.projectId} requestId={summary.localRequestId||summary.requestId} historicalOnly={model?.published===true}/>} {error&&<p role="alert">{error} 기존 후보와 원본은 유지됩니다.</p>}</section>;
}
