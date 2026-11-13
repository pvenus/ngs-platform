"use client";
import {createContext,useContext,useEffect,useLayoutEffect,useId,useRef,useState,type ReactNode} from 'react';
import PromptWorkspace from './prompt/workspace';
import IntakeWorkspace from './intake-workspace';

type Kind='npc-lifecycle'|'portrait'|'transfer'|'knowledge'|'npc-edit'|'npc-category'|'knowledge-edit'|'story-design'|'story-play'|'story-info';
const ModalContext=createContext<{busy:(value:boolean)=>void;saved:()=>void;changed:()=>void;footer:HTMLElement|null;dismiss:()=>void}|null>(null);
export function useNewRequestStatus(){return useContext(ModalContext);}
export function requestKind(){if(typeof location==='undefined')return null;const value=new URLSearchParams(location.search).get('request');return ['npc-lifecycle','portrait','transfer','knowledge','npc-edit','npc-category','knowledge-edit','story-design','story-play','story-info'].includes(value||'')?value as Kind:null;}
/** One shell for new requests. Existing routes and editing surfaces remain available. */
export function NewRequestModal({kind,title,onClose,children,target,projectId,open=true,immersive=false}:{immersive?:boolean;open?:boolean;projectId?:string;target?:string;kind:Kind;title:string;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),dirty=useRef(false),busy=useRef(false),ownsEntry=useRef(false),close=useRef(onClose),[notice,setNotice]=useState('');const titleId=useId();useLayoutEffect(()=>{close.current=onClose;},[onClose]);
 const [footer,setFooter]=useState<HTMLDivElement|null>(null);
 const [context]=useState(()=>({busy:(value:boolean)=>{busy.current=value;if(!value)setNotice('');},saved:()=>{dirty.current=false;},changed:()=>{dirty.current=true;}}));
 function allowClose(){if(busy.current){setNotice('요청 처리 또는 첨부 준비 중입니다. 완료된 뒤 닫아 주세요.');return false;}return !dirty.current||window.confirm('작성 중인 내용과 첨부를 버리고 닫을까요? 이미 전송된 요청은 취소되지 않습니다.');}
 function dismiss(){if(!allowClose())return;if(immersive){const current=new URL(location.href);if(current.searchParams.get('request')===kind&&(!target||current.searchParams.get('requestTarget')===target)){current.searchParams.delete('request');current.searchParams.delete('requestTarget');history.replaceState(history.state,'',current);}close.current();return;}const url=new URL(location.href);url.searchParams.delete('request');url.searchParams.delete('requestTarget');if(ownsEntry.current){dirty.current=false;history.back();}else{history.replaceState(history.state,'',url);close.current();}}
 useEffect(()=>{
  if(!open)return;
  const element=dialog.current!;const trigger=document.activeElement as HTMLElement|null;const scroll={x:window.scrollX,y:window.scrollY};const previous={position:document.body.style.position,top:document.body.style.top,width:document.body.style.width,overflow:document.body.style.overflow};
  const url=new URL(location.href);if(!immersive&&url.searchParams.get('request')!==kind){url.searchParams.set('request',kind);if(target)url.searchParams.set('requestTarget',target);if(projectId)url.searchParams.set('projectId',projectId);history.pushState({...history.state,npcgenRequest:kind},'',url);ownsEntry.current=true;}
  const modalUrl=location.href;
  element.showModal();document.body.style.position='fixed';document.body.style.top=`-${scroll.y}px`;document.body.style.width='100%';document.body.style.overflow='hidden';element.querySelector<HTMLButtonElement>('.new-request-close')?.focus({preventScroll:true});
  function pop(){if(requestKind()===kind)return;if(!allowClose()){if(ownsEntry.current)history.forward();else history.pushState({...history.state,npcgenRequest:kind},'',modalUrl);return;}close.current();}
  function unload(e:BeforeUnloadEvent){if(dirty.current||busy.current){e.preventDefault();e.returnValue='';}}
  window.addEventListener('popstate',pop);window.addEventListener('beforeunload',unload);
  return()=>{window.removeEventListener('popstate',pop);window.removeEventListener('beforeunload',unload);element.close();Object.assign(document.body.style,previous);trigger?.isConnected&&trigger.focus({preventScroll:true});window.scrollTo(scroll.x,scroll.y);};
 },[kind,open,immersive]);
 return <dialog ref={dialog} data-request-kind={kind} data-immersive={immersive||undefined} className={`new-request-modal ${kind==='portrait'?'portrait-request-modal':''}`} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();dismiss();}} onClick={e=>{if(e.target===e.currentTarget){const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dismiss();}}}>
  <div className="new-request-heading"><h2 id={titleId}>{title}</h2><div className="button-row"><button type="button" className="new-request-close" aria-label={immersive?'플레이 닫기':undefined} title={immersive?'플레이 종료 · 다시 시작하면 처음부터':undefined} onClick={dismiss}>{immersive?<span aria-hidden="true">×</span>:'닫기'}</button>{kind!=='portrait'&&kind!=='story-play'&&kind!=='story-info'&&<button type="button" onClick={dismiss}>취소</button>}</div></div>
  {notice&&<p className="scope-note" role="status">{notice}</p>}
  <div className="new-request-body" onInputCapture={()=>{if(kind!=='story-info')dirty.current=true;}} onChangeCapture={()=>{if(kind!=='story-info')dirty.current=true;}} onClickCapture={e=>{const link=(e.target as HTMLElement).closest('a');if(link&&link.getAttribute('href')?.startsWith('/')&&!link.getAttribute('href')?.startsWith('/api/')&&!link.download){e.preventDefault();e.stopPropagation();setNotice('현재 요청을 닫은 뒤 다른 화면으로 이동하세요.');}}}><ModalContext.Provider value={{...context,footer,dismiss}}>{children}</ModalContext.Provider></div>
  {kind==='portrait'&&<div className="new-request-footer" ref={setFooter}/>}
 </dialog>;
}
/** Intercepts ordinary new-request links only; modified clicks keep existing deep links. */
export default function NewRequestHost({children}:{children:ReactNode}){
 const q=typeof location==='undefined'?new URLSearchParams():new URLSearchParams(location.search),savedNpc=q.get('requestTarget')||'',initialNpcId=/^[A-Za-z0-9._:-]{1,180}$/.test(savedNpc)?savedNpc:undefined;
 const [kind,setKind]=useState<'portrait'|'transfer'|null>(null);const active=useRef(kind);useLayoutEffect(()=>{active.current=kind;},[kind]);
 useEffect(()=>{function sync(){const next=requestKind();if(!active.current&&(next==='portrait'||next==='transfer')&&!document.querySelector(`dialog[data-request-kind="${next}"]`))setKind(next);}sync();window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);
 return <div onClickCapture={e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return;const link=(e.target as HTMLElement).closest('a');if(!link||link.target||link.download)return;const url=new URL(link.href,location.href);if(url.origin!==location.origin||!['/prompt','/transfers'].includes(url.pathname)||url.search||url.hash)return;e.preventDefault();if(!active.current)setKind(url.pathname==='/prompt'?'portrait':'transfer');}}>{children}{kind&&<NewRequestModal kind={kind} title={kind==='portrait'?'새 포트레이트 생성 요청':'새 파일·문서 전달 요청'} onClose={()=>setKind(null)}>{kind==='portrait'?<PromptWorkspace displayName="" embedded initialProject={q.get('projectId')||'binari'} initialNpcId={initialNpcId}/>:<IntakeWorkspace displayName="" embedded/>}</NewRequestModal>}</div>;
}
