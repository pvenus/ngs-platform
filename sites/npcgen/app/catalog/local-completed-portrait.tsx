'use client';
import {useEffect,useState,type ComponentProps} from 'react';
import {frontendFetch} from '@/lib/frontend-transport.mjs';
import {useLoopbackSingle} from '../frontend-session';
import {StatusConsoleSection} from '../status-console';
import {Portraits} from './portraits';
import {rows} from './adapter';
/** Display adapter only: preserve the published snapshot, canonical NPC and active portrait. */
export function LocalPortraits(props:ComponentProps<typeof Portraits>){
 const local=useLoopbackSingle(),[result,setResult]=useState<any>(null),[error,setError]=useState('');
 const eligible=local&&props.snapshot.projectId==='binari'&&props.npc.id==='character.seojin';
 useEffect(()=>{setResult(null);setError('');if(!eligible)return;const controller=new AbortController();frontendFetch('/api/local-completed-portrait',{signal:controller.signal,cache:'no-store'}).then(async r=>{const v=await r.json() as any;if(!r.ok)throw Error(v.error);if(v.state==='completed'&&v.portrait?.assetId===v.portraitId&&typeof v.image==='string'&&v.image.startsWith('data:image/png;base64,'))setResult(v);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[eligible,props.refreshVersion]);
 const complete=eligible&&result,npc=complete?{...props.npc,portraits:[...rows(props.npc.portraits).filter(p=>p.assetId!==result.portraitId),{...result.portrait,sourceRef:String(result.portrait.sourceRef||'')+';request:'+result.localRequestId}]}:props.npc;
 return <><Portraits {...props} npc={npc} imageUrls={complete?{[result.portraitId]:result.image}:{}}/>{complete&&<StatusConsoleSection id="completed-portrait" title="완료 포트레이트"><p className="meta">읽기 전용 게시 보관본 + 완료된 로컬 후보 1개 · 로컬 총 {result.candidateCount}개 · 기존 대표 유지 · 운영 동기화 없음</p></StatusConsoleSection>}{error&&<StatusConsoleSection id="completed-portrait-error" title="포트레이트 조회 오류" level="error"><p role="alert">로컬 완료 후보 조회 실패 · {error}</p></StatusConsoleSection>}</>;
}
