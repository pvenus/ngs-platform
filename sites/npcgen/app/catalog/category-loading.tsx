'use client';
import {useEffect,useState,type ReactNode} from 'react';
import {CatalogReadBoundary} from './read-access';
import {type Snapshot,type Json,type CatalogTransport,catalogCacheReset} from './adapter';
export function useCatalogPart(snapshot:Snapshot,transport:CatalogTransport,resource:string,selection:string,npcId='',active=true){
 const basis=JSON.stringify([snapshot.authorizationScope,snapshot.projectId,snapshot.snapshotId,snapshot.contentHash,resource,selection,npcId]),identity=basis+'|'+(snapshot.clientReadAt||'');
 const cached=snapshot.catalogLazy?transport.peek?.(snapshot,resource,selection,npcId):undefined;
 const enabled=active&&(!snapshot.catalogIndexPending||cached!==undefined);
 const [state,setState]=useState<{identity:string;basis?:string;loading?:boolean;value?:Json;error?:string}>({identity:''}),[retry,setRetry]=useState(0);
 useEffect(()=>{const reset=(e:Event)=>{const p=(e as CustomEvent).detail?.projectId;if(!p||p===snapshot.projectId){setState({identity:''});setRetry(n=>n+1);}};window.addEventListener(catalogCacheReset,reset);return()=>window.removeEventListener(catalogCacheReset,reset);},[snapshot.projectId]);
 useEffect(()=>{if(!snapshot.catalogLazy||!transport.part||!enabled||!selection)return;const controller=new AbortController();setState(previous=>previous.basis===basis?{...previous,identity,error:undefined,loading:cached===undefined}:{identity,basis,value:cached,loading:cached===undefined});transport.part(snapshot,resource,selection,npcId,controller.signal).then(value=>{if(!controller.signal.aborted)setState({identity,basis,value,loading:false});}).catch(e=>{if(!controller.signal.aborted)setState({identity,basis,loading:false,error:e instanceof Error?e.message:'본문 조회 실패'});});return()=>controller.abort();},[transport,identity,enabled,retry,snapshot.catalogLazy]);
 const current=state.basis===basis?state:undefined;
 const loading=!!(snapshot.catalogLazy&&active&&selection&&cached===undefined&&(snapshot.catalogIndexPending||state.identity!==identity||current?.loading||current?.value===undefined)&&!current?.error);
 return {value:cached!==undefined?cached:current?.value,active:enabled&&!!selection,error:current?.error,loading,retry:()=>setRetry(n=>n+1)};
}
export function CategoryLoading({state,children,label='선택한 카테고리'}:{label?:string;state:{loading:boolean;active?:boolean;error?:string;retry:()=>void};children:ReactNode}){return <>{state.error?<div role='alert'>{state.error} <button type='button' onClick={state.retry}>본문 다시 조회</button></div>:state.loading?<p role='status' className='catalog-loading-note'>{label}를 읽고 있습니다.</p>:null}<CatalogReadBoundary active={state.active!==false} scope='selected-body'><div hidden={!!state.error||state.loading} style={{minWidth:0}}>{children}</div></CatalogReadBoundary></>;}
