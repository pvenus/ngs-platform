"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {Button} from '../../components/ui/button';
/** UI-only replacement for native confirm; cancellation never submits. */
export function useConceptConfirmation(){
 const ref=useRef<HTMLDialogElement>(null),cancel=useRef<HTMLButtonElement>(null),resolve=useRef<((value:boolean)=>void)|null>(null),trigger=useRef<HTMLElement|null>(null),id=useId();
 const [draft,setDraft]=useState<{title:string;message:string;danger:boolean;actionLabel?:string}|null>(null);
 function finish(value:boolean){const done=resolve.current;resolve.current=null;ref.current?.close();setDraft(null);trigger.current?.isConnected&&trigger.current.focus({preventScroll:true});done?.(value);}
 useEffect(()=>{if(draft){ref.current?.showModal();cancel.current?.focus({preventScroll:true});}},[draft]);
 useEffect(()=>()=>{resolve.current?.(false);resolve.current=null;},[]);
 function confirm(message:string,danger=true,title=danger?'제거·폐기 확인':'최종 적용 확인',actionLabel?:string){if(resolve.current)return Promise.resolve(false);trigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setDraft({title,message,danger,actionLabel});return new Promise<boolean>(done=>{resolve.current=done;});}
 const confirmation=<dialog ref={ref} className="concept-proposal-dialog concept-confirmation-dialog" aria-labelledby={id} onKeyDown={e=>{if(e.key!=='Tab')return;const buttons=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])')),first=buttons[0],last=buttons.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}} onCancel={e=>{e.preventDefault();finish(false);}} onClose={()=>{if(resolve.current)finish(false);}}>{draft&&<><h2 id={id}>{draft.title}</h2><p style={{whiteSpace:'pre-wrap'}}>{draft.message}</p><div className="category-archive-confirm-actions"><Button data-action-tone={draft.actionLabel?(draft.danger?'discard':'confirm'):undefined} className={`concept-action-button ${draft.actionLabel?'candidate-decision-button':''}`} variant={draft.danger?'destructive':'default'} onClick={()=>finish(true)}>{draft.actionLabel||(draft.danger?'제거·폐기 확정':'적용 요청 확정')}</Button><Button ref={cancel} className="concept-action-button" variant="outline" onClick={()=>finish(false)}>취소</Button></div></>}</dialog>;
 return {confirm,confirmation};
}
