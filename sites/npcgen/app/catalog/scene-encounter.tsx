'use client';
/* eslint-disable @next/next/no-img-element -- Exact registered portrait bytes, no optimizer transform. */
import {useEffect,useMemo,useRef,useState} from 'react';
import {encounterActors} from './scene-encounter.mjs';
import {publishedAsset,type Snapshot} from './adapter';
import {frontendFetch} from '@/lib/frontend-transport.mjs';
import './scene-encounter.css';
type Row=Record<string,unknown>;
type Actor={npcId:string;name:string;side:'left'|'right';question:string;reply:string;portrait:Row};
export function SceneEncounter({encounter,background,snapshot,body}:{encounter:Row;background:string;snapshot:Snapshot;body:string}){
 const text=JSON.stringify(encounter),actors=useMemo(()=>encounterActors(JSON.parse(text)) as Actor[],[text]);
 const [images,setImages]=useState<Record<string,{url?:string;error?:string}>>({}),[selected,setSelected]=useState<string|null>(null);
 const [imageReads,setImageReads]=useState(0);
 const trigger=useRef<HTMLElement|null>(null),bubble=useRef<HTMLDivElement>(null);
 useEffect(()=>{let live=true;const controller=new AbortController(),urls:string[]=[];
  async function readPortrait(a:Actor){const assetId=String(a.portrait.sha256)+'.png',descriptor=snapshot.resources?.find(r=>r.kind==='asset'&&r.assetId===assetId),url=publishedAsset(snapshot,assetId);if(snapshot.projectId!=='binari'||!descriptor||!url||descriptor.sha256!==a.portrait.sha256||descriptor.mime!=='image/png'||typeof descriptor.size!=='number'||descriptor.size<8||descriptor.size>16*1024*1024)throw Error('이 사본에 게시된 인물 이미지가 아닙니다.');const response=await frontendFetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok||response.headers.get('Content-Type')?.split(';')[0]!=='image/png')throw Error('인물 이미지 조회 권한·MIME 확인 실패');const bytes=new Uint8Array(await response.arrayBuffer()),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');if(bytes.length!==descriptor.size||hash!==a.portrait.sha256||bytes[0]!==137||bytes[1]!==80)throw Error('인물 이미지의 실제 PNG·크기·해시가 다릅니다.');const result=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));urls.push(result);return result;}
  for(const a of actors){void readPortrait(a).then(url=>{if(live){setImageReads(n=>n+1);setImages(x=>({...x,[a.npcId]:{url}}));}else URL.revokeObjectURL(url);}).catch(e=>{if(live){setImageReads(n=>n+1);setImages(x=>({...x,[a.npcId]:{error:e instanceof Error?e.message:String(e)}}));}});}return()=>{live=false;controller.abort();for(const url of urls)URL.revokeObjectURL(url);};},[actors,snapshot]);
 useEffect(()=>{if(selected)bubble.current?.focus();},[selected]);
 const current=actors.find(a=>a.npcId===selected),close=()=>{setSelected(null);trigger.current?.focus();};
 return <section data-scene-image-reads={imageReads} className="scene-encounter" aria-label="현재 상황과 선택 대화"><div className="scene-encounter-layout"><div className="scene-encounter-stage"><img className="scene-encounter-background" src={background} alt="현재 장면"/>{actors.map(a=><button type="button" key={a.npcId} data-npc-id={a.npcId} className={'scene-encounter-person scene-person-'+a.side} aria-label={a.name+' · 선택 대화'} aria-expanded={selected===a.npcId} onClick={e=>{trigger.current=e.currentTarget;setSelected(a.npcId)}}>{images[a.npcId]?.url?<img src={images[a.npcId].url} alt={a.name}/>:<span>{images[a.npcId]?.error?'포트레이트 조회 실패':'포트레이트 확인 중'}</span>}<strong>{a.name}<span aria-hidden="true"> · 말 걸기</span></strong></button>)}</div><div className="scene-encounter-narrative"><p className="scene-encounter-required">{body}</p>{current&&<div ref={bubble} tabIndex={-1} className="scene-encounter-bubble" role="dialog" aria-label={current.name+'의 선택 대화'} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();e.preventDefault();close();}}}><header><strong>{current.name}</strong><button type="button" onClick={close}>대화 닫기</button></header><p className="scene-encounter-question">{current.question}</p><p>{current.reply}</p></div>}</div></div>{actors.some(a=>images[a.npcId]?.error)&&<p role="alert">일부 인물 이미지를 확인하지 못했습니다. 선택 대화와 기존 진행은 유지됩니다.</p>}</section>;
}
