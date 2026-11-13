'use client';
import {createPortal} from 'react-dom';
import {StatusIcon} from './ui-icons';
import {createContext,useCallback,useContext,useEffect,useMemo,useState,type ReactNode} from 'react';
type Level='info'|'warning'|'error';
type Entry={title:string;level:Level;children:ReactNode};
const Context=createContext<{set:(id:string,entry:Entry|null)=>void}>({set:()=>{}});
export function StatusConsoleProvider({children}:{children:ReactNode}){
 const [anchor,setAnchor]=useState<HTMLElement|null>(null);
 useEffect(()=>{function locate(){setAnchor(document.getElementById('status-menu-slot'));}locate();const observer=new MutationObserver(locate);observer.observe(document.body,{childList:true,subtree:true});return()=>observer.disconnect();},[]);
 useEffect(()=>{const header=anchor?.closest<HTMLElement>('.site-header');if(!header)return;function measure(){document.documentElement.style.setProperty('--catalog-menu-height',`${header!.getBoundingClientRect().height}px`);}const observer=new ResizeObserver(measure);observer.observe(header);measure();return()=>{observer.disconnect();document.documentElement.style.removeProperty('--catalog-menu-height');};},[anchor]);
 const [entries,update]=useState<Record<string,Entry>>({});
 const set=useCallback((id:string,entry:Entry|null)=>update(old=>{const next={...old};if(entry)next[id]=entry;else delete next[id];return next;}),[]);
 const value=useMemo(()=>({set}),[set]),list=Object.entries(entries),errors=list.filter(([,e])=>e.level==='error').length,warnings=list.filter(([,e])=>e.level==='warning').length;
 const state=errors?'error':warnings?'warning':list.length?'normal':'checking',name=`상태 콘솔 열기 · ${errors?`오류 ${errors}개`:warnings?`주의 ${warnings}개`:list.length?'정상':'확인 중'}`;
 const consoleView=<details className={`status-console${anchor?' status-console-menu':''}`} data-severity={errors?'error':warnings?'warning':'info'}><summary className="status-tool-summary concept-tool-button" aria-label={name} title={name} data-tooltip={name}><StatusIcon state={state}/>{(errors||warnings)>0&&<span className="console-badge" role="status" aria-live="polite">{errors||warnings}</span>}</summary><div className="console-body"><h2>상태 콘솔</h2>{list.map(([id,e])=><section key={id} className="console-section" data-severity={e.level}><h3>{e.title}{e.level!=='info'&&<small>{e.level==='error'?'확인 필요':'주의'}</small>}</h3>{e.children}</section>)}{!list.length&&<p>연결 상태를 확인하고 있습니다.</p>}</div></details>;
 return <Context.Provider value={value}>{children}{anchor?createPortal(consoleView,anchor):consoleView}</Context.Provider>;
}
export function StatusConsoleSection({id,title,level='info',children}:{id:string;title:string;level?:Level;children:ReactNode}){
 const {set}=useContext(Context);
 useEffect(()=>{set(id,{title,level,children});},[set,id,title,level,children]);
 useEffect(()=>()=>set(id,null),[set,id]);
 return null;
}
