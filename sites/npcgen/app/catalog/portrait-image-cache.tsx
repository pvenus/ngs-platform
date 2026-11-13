'use client';
import {frontendFetch} from '@/lib/frontend-transport.mjs';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {catalogCacheReset,purgeCatalogCaches,publishedAsset,documentOf,rows,CatalogAccessError,type Snapshot} from './adapter';
const MAX_BYTES=64*1024*1024,MAX_ITEMS=48;
type Entry={key:string;npcId:string;assetId:string;size:number;refs:number;url?:string;controller:AbortController;promise:Promise<string>};
/** No persistent/offline cache. Every identity is minted by a freshly authorized
 * current manifest, and also checks the NPC-to-asset binding in its documents. */
export function portraitIdentity(snapshot:Snapshot,npcId:string,assetId:string){
 const resource=snapshot.resources.find(r=>r.kind==='asset'&&r.assetId===assetId),npc=rows(documentOf(snapshot,'npcs').characters).find(n=>n.id===npcId);
 if(!snapshot.authorizationScope||!/^([a-f0-9]{64})$/.test(snapshot.authorizationScope)||!resource?.sha256||!/^([a-f0-9]{64})$/.test(resource.sha256)||resource.mime!=='image/png'||!Number.isSafeInteger(resource.size)||resource.size!<=0||resource.size!>5*1024*1024||!npc||!rows(npc.portraits).some(p=>p.assetId===assetId))return null;
 return {key:[snapshot.authorizationScope,snapshot.projectId,npcId,assetId,resource.sha256,resource.size,resource.mime].join('|'),resource};
}
export class PortraitImageCache{
 entries=new Map<string,Entry>();scope='';generation=0;
 remove(entry:Entry){entry.controller.abort();if(entry.url)URL.revokeObjectURL(entry.url);this.entries.delete(entry.key);}
 clear(){this.generation++;for(const entry of this.entries.values())this.remove(entry);this.scope='';}
 reconcile(snapshot:Snapshot|null){
  const scope=snapshot?.authorizationScope?`${snapshot.authorizationScope}|${snapshot.projectId}`:'';
  if(scope!==this.scope){this.clear();this.scope=scope;}
  // Metadata has no NPC bindings yet. Keep dormant leases; acquire still requires
  // a freshly authorized concrete binding and verifies the current asset identity.
  if(snapshot?.catalogLazy&&(!snapshot.documents.npcs||snapshot.catalogIndexPending))return;
  if(snapshot)for(const entry of this.entries.values())if(portraitIdentity(snapshot,entry.npcId,entry.assetId)?.key!==entry.key)this.remove(entry);
 }
 prune(){let bytes=[...this.entries.values()].reduce((n,e)=>n+e.size,0);for(const entry of this.entries.values()){if(bytes<=MAX_BYTES&&this.entries.size<=MAX_ITEMS)break;if(!entry.refs){bytes-=entry.size;this.remove(entry);}}}
 acquire(snapshot:Snapshot,npcId:string,assetId:string){
  this.reconcile(snapshot);const identity=portraitIdentity(snapshot,npcId,assetId);if(!identity)throw Error('이미지 재사용 기준이 없습니다.');
  let entry=this.entries.get(identity.key);
  if(!entry){
   const generation=this.generation,controller=new AbortController(),resource=identity.resource;
   entry={key:identity.key,npcId,assetId,size:resource.size!,refs:0,controller,promise:Promise.resolve('')};const created=entry;
   created.promise=(async()=>{
    try{
     const response=await frontendFetch(publishedAsset(snapshot,assetId)!,{cache:'no-store',signal:controller.signal});
     if([401,403].includes(response.status)){purgeCatalogCaches(response.status===401?undefined:snapshot.projectId,true);throw new CatalogAccessError('이미지 권한 확인 실패',response.status);}
     if(!response.ok)throw Error('이미지 조회 실패');
     if(response.headers.get('Content-Type')?.split(';')[0].trim()!==resource.mime)throw Error('이미지 MIME 불일치');
     const bytes=await response.arrayBuffer();if(bytes.byteLength!==resource.size)throw Error('이미지 크기 불일치');
     const digest=await crypto.subtle.digest('SHA-256',bytes),hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');if(hash!==resource.sha256)throw Error('이미지 hash 불일치');
     if(generation!==this.generation||controller.signal.aborted||this.entries.get(created.key)!==created)throw new DOMException('Aborted','AbortError');
     created.url=URL.createObjectURL(new Blob([bytes],{type:resource.mime}));this.prune();return created.url;
    }catch(error){if(this.entries.get(created.key)===created)this.remove(created);throw error;}
   })();this.entries.set(entry.key,entry);
  }
  entry.refs++;this.entries.delete(entry.key);this.entries.set(entry.key,entry);let released=false;
  return {promise:entry.promise,release:()=>{if(!released){released=true;entry!.refs=Math.max(0,entry!.refs-1);if(!entry!.refs&&!entry!.url&&this.entries.get(entry!.key)===entry)this.remove(entry!);this.prune();}}};
 }
}
const Context=createContext<PortraitImageCache|null>(null);
export function PortraitImageProvider({snapshot,children}:{snapshot:Snapshot|null;children:ReactNode}){
 const cache=useRef<PortraitImageCache|null>(null);if(!cache.current)cache.current=new PortraitImageCache();const current=cache.current;
 useEffect(()=>{current.reconcile(snapshot);},[current,snapshot]);
 useEffect(()=>{const reset=(e:Event)=>{const project=(e as CustomEvent).detail?.projectId;if(!project||current.scope.endsWith('|'+project))current.clear();};window.addEventListener(catalogCacheReset,reset);return()=>{window.removeEventListener(catalogCacheReset,reset);current.clear();};},[current]);
 return <Context.Provider value={current}>{children}</Context.Provider>;
}
export function usePortraitImage(snapshot:Snapshot,npcId:string,assetId:string,attempt:number){
 const cache=useContext(Context),identity=cache?portraitIdentity(snapshot,npcId,assetId):null,key=identity?.key||publishedAsset(snapshot,assetId)||'';
 const result=useRef<{key:string;url?:string;error?:boolean}>({key:''});
 // State is local to the image; a manifest with a different identity never renders an old URL.
 const [,update]=useState(0);
 useEffect(()=>{let alive=true;result.current={key};if(!identity||!cache){update(n=>n+1);return;}
  update(n=>n+1);const lease=cache.acquire(snapshot,npcId,assetId);lease.promise.then(url=>{if(alive){result.current={key,url};update(n=>n+1);}}).catch(()=>{if(alive){result.current={key,error:true};update(n=>n+1);}});return()=>{alive=false;lease.release();};
 },[cache,key,attempt]);
 if(!identity)return {url:publishedAsset(snapshot,assetId),error:false,loading:false};
 return result.current.key===key?{url:result.current.url,error:!!result.current.error,loading:!result.current.url&&!result.current.error}:{url:undefined,error:false,loading:true};
}
