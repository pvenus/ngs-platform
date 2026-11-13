'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {CatalogAccessError,purgeCatalogCaches,type CatalogTransport,type Snapshot} from './adapter';
const Context=createContext<{snapshot:Snapshot|null;transport:CatalogTransport}|null>(null);
export function CatalogAccessProvider({snapshot,transport,children}:{snapshot:Snapshot|null;transport:CatalogTransport;children:ReactNode}){return <Context.Provider value={{snapshot,transport}}>{children}</Context.Provider>;}
export function useCatalogAccess(){return useContext(Context);}
/** Cached content is never an authorization token. Recheck on read-scope changes,
 * returning to this window, and a visible-page heartbeat; fetch no content here.
 * Keep children mounted while checking so controls, pages and flip state survive. */
export function CatalogReadBoundary({scope,children,active=true,shell=false}:{scope:string;children:ReactNode;active?:boolean;shell?:boolean}){
 const context=useContext(Context),snapshot=context?.snapshot,authorize=context?.transport.authorize,basis=snapshot?`${snapshot.authorizationScope}|${snapshot.projectId}|${snapshot.snapshotId}|${snapshot.contentHash}`:'',identity=basis+'|'+scope,enabled=!!(active&&snapshot&&authorize),[checked,setChecked]=useState(snapshot?.authorizationScope&&snapshot.clientReadAt?basis:''),[error,setError]=useState(''),[retry,setRetry]=useState(0),epoch=useRef(0);
 useEffect(()=>{if(!active||!snapshot||!authorize)return;let controller:AbortController|null=null;let alive=true;
  const check=async(background=false)=>{controller?.abort();controller=new AbortController();const current=++epoch.current,signal=controller.signal;setError('');try{try{await authorize(snapshot,signal);}catch(e){if(signal.aborted||!(e instanceof Error)||e.message!=='FRONTEND_SESSION_CONTEXT_CHANGED')throw e;await authorize(snapshot,signal);}if(alive&&current===epoch.current&&!signal.aborted)setChecked(basis);}catch(e){if(!alive||current!==epoch.current||signal.aborted)return;const denied=e instanceof CatalogAccessError&&[401,403,404].includes(e.status);if(denied)purgeCatalogCaches(e.status===401?undefined:snapshot.projectId,true);if(!background||denied)setChecked('');setError(e instanceof Error?e.message:'권한 확인 실패');}};
  void check();const focus=()=>{if(document.visibilityState==='visible')void check(true);},timer=setInterval(focus,60_000);window.addEventListener('focus',focus);document.addEventListener('visibilitychange',focus);return()=>{alive=false;epoch.current++;controller?.abort();clearInterval(timer);window.removeEventListener('focus',focus);document.removeEventListener('visibilitychange',focus);};
 },[active,authorize,identity,retry]);
 const allowed=shell||!enabled||checked===basis;
 return <>{!allowed&&<div className='catalog-access-check' role={error?'alert':'status'}>{error?<>{error} <button type='button' onClick={()=>setRetry(n=>n+1)}>권한 다시 확인</button></>:'자료 조회 권한을 확인하고 있습니다.'}</div>}<div className='catalog-authorized-content' style={{minWidth:0}} hidden={!allowed}>{children}</div></>;
}
