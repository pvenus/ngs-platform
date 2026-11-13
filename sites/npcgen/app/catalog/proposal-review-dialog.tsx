import {useUnifiedRequests} from './request-review-context';
"use client";
import {useId,useRef,useEffect,type ReactNode} from 'react';
import {createProposalReviewDialogController} from '../../lib/proposal-review-dialog-controller.mjs';
import './proposal-review-dialog.css';

export function ProposalReviewDialog({busy,status,onOpened,onClosed,sidebar,count,children,notice,title="콘텐츠 요청 · 비교 및 선택",launchLabel,launchTitle,sidebarLabel="전체 콘텐츠 요청",openRequested=false,globalLaunch=false}:{globalLaunch?:boolean;openRequested?:boolean;sidebarLabel?:string;title?:string;launchLabel?:string;launchTitle?:string;notice?:string;busy:boolean;status:string;onOpened?:()=>void;onClosed?:()=>void;sidebar?:ReactNode;count?:number;children:ReactNode}){
 const unified=useUnifiedRequests();
 const launch=useRef<HTMLButtonElement>(null);
 const ref=useRef<HTMLDialogElement>(null),close=useRef<HTMLButtonElement>(null),busyRef=useRef(busy),opened=useRef(onOpened),id=useId();busyRef.current=busy;opened.current=onOpened;
 const controller=useRef<ReturnType<typeof createProposalReviewDialogController>|null>(null);
 if(!controller.current)controller.current=createProposalReviewDialogController({dialog:()=>ref.current,busy:()=>busyRef.current,focusInitial:()=>close.current?.focus({preventScroll:true}),opened:()=>opened.current?.()});
 const c=controller.current;
 useEffect(()=>{if(openRequested&&launch.current)c.open(launch.current);},[openRequested,c]);
 return <div className="proposal-review-launcher"><button hidden={unified&&!globalLaunch} ref={launch} type="button" className="proposal-review-open" aria-haspopup="dialog" aria-controls={id} disabled={busy} onClick={e=>c.open(e.currentTarget)} aria-label={launchLabel||(count===undefined?"콘텐츠 요청 목록 열기":`콘텐츠 요청 목록 열기 · ${count}건`)} title={launchTitle||title} data-tooltip={launchTitle||title}><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M9 3v18M5.5 7h1M5.5 12h1M5.5 17h1M12 7h6M12 12h6M12 17h4"/></svg>{count!==undefined&&<span className="proposal-review-count" aria-hidden="true">{count}</span>}</button><span className="proposal-review-launch-status">{status}</span>
  <dialog ref={ref} id={id} className="proposal-review-dialog" aria-labelledby={id+'-title'} aria-describedby={id+'-notice'} aria-busy={busy} onClose={e=>{if(e.target===e.currentTarget){c.closed();onClosed?.();}}} onCancel={e=>{if(e.target===e.currentTarget)c.cancel(e);}} onKeyDown={e=>c.keyDown(e)}>
   <header className="proposal-review-dialog-heading"><div><h2 id={id+'-title'}>{title}</h2><p role="status">{status}</p></div><button ref={close} type="button" className="proposal-review-close" disabled={busy} onClick={()=>c.close()} aria-label={launchLabel?title+' 닫기':'콘텐츠 비교 팝업 닫기'}>닫기</button></header>
   <div className={sidebar?"proposal-review-master-detail":"proposal-review-scroll"}>{sidebar&&<aside className="proposal-review-request-list" aria-label={sidebarLabel}>{sidebar}</aside>}{sidebar?<div className="proposal-review-detail proposal-review-scroll" aria-live="polite">{children}</div>:children}</div>
   <p id={id+'-notice'} className="proposal-review-dialog-notice">{busy?'선택·폐기 접수를 확인하고 있습니다. 완료될 때까지 잠시 기다려 주세요.':notice||'닫아도 요청과 후보는 유지됩니다. 최종 선택과 전체 폐기는 각각 확인 후 접수됩니다.'}</p>
  </dialog>
 </div>;
}
