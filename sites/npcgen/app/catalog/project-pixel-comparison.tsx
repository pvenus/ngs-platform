'use client';
import {useCallback,useEffect,useState} from 'react';
import {PixelBatchView,PixelImage,pixelRpc} from '../prompt/pixel-sd-workspace';
import {verifiedPixelBatch} from '../../lib/pixel-batch-reference.mjs';
type Row=Record<string,unknown>;
export function ProjectPixelComparison({summary,projectId,refresh,onBusyChange}:{summary:Row;projectId:string;refresh:()=>void;onBusyChange:(busy:boolean)=>void}){
 const [batch,setBatch]=useState<Row|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[original,setOriginal]=useState('');const id=String(summary.requestId);
 const read=useCallback(async()=>{const v=await pixelRpc({operation:'pixel-batch-detail',requestId:id});return verifiedPixelBatch({requestId:id,projectId:summary.projectId,requestType:summary.requestType},v,projectId);},[id,projectId,summary.projectId,summary.requestType]);
 useEffect(()=>{let live=true;void read().then(v=>{if(live){setBatch(v);setError('');}}).catch(e=>{if(live)setError(e instanceof Error?e.message:'픽셀 비교 조회 실패');});return()=>{live=false;};},[read,summary.state,summary.stage]);
 async function reload(){setBusy(true);try{setBatch(await read());setError('');}catch(e){setError(e instanceof Error?e.message:'조회 실패');}finally{setBusy(false);}}
 async function decision(command:Row){setBusy(true);onBusyChange(true);try{const result=await pixelRpc(command);setBatch(await read());setError('');refresh();return result;}catch(e){setError(e instanceof Error?e.message:'결정 실패');throw e;}finally{setBusy(false);onBusyChange(false);}}

 return <section aria-label="통합 요청 픽셀 비교"><h3>픽셀 포트레이트 · 정식 3안 비교</h3><p>일반 포트레이트와 독립된 픽셀 후보입니다. 최종 보정·등록·로컬 게시가 확인된 안만 표시합니다.</p><button disabled={busy} onClick={()=>void reload()}>픽셀 비교 다시 조회</button>{error&&<p role="alert">{error} · 조회 실패를 비교군 없음으로 표시하지 않습니다.</p>}{batch?<PixelBatchView batch={batch} busy={busy} readOnly={!!error} onDecision={decision} onOriginal={setOriginal}/>:!error&&<p role="status">해당 정식 픽셀 요청의 3안을 조회 중입니다.</p>}{original&&<PixelImage key={original} operation="pixel-sd-image" id={original} label="픽셀 생성 원본 · 최종 보정과 구분"/>}</section>;
}
