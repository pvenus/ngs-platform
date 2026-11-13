'use client';
import {catalogAppearances}from '../../lib/shared-runtime/npc-catalog-appearances.mjs';
import {useEffect,useMemo,useState} from 'react';
import {useCatalogPart} from './category-loading';
import {documentOf,object,npcMatches,type Snapshot,type CatalogTransport,type RecordData} from './adapter';
import {npcAppearances,scopeNpcs} from './npc-appearance-model';

export function useNpcAppearances(snapshot:Snapshot,transport:CatalogTransport,npcs:RecordData[],selected:string,active:boolean,search:string,status:string,setSearch:(value:string)=>void,setStatus:(value:string)=>void,catalogScope?:{actId:string;chapterId:string;npcIds:string[]}){
 const story=useCatalogPart(snapshot,transport,'story','index','',active);
 const doc=snapshot.catalogLazy?object(story.value):documentOf(snapshot,'story');
 const storyReady=!snapshot.catalogLazy||(story.value!==undefined&&!story.loading&&!story.error);
 const model=useMemo(()=>catalogAppearances(npcAppearances(doc,documentOf(snapshot,'npcs'),npcs),npcs,storyReady?catalogScope:undefined),[doc,snapshot,npcs,catalogScope,storyReady]);
 const [scope,setScope]=useState<{act:string;chapter:string}|null>(null);
 useEffect(()=>{function restore(){const q=new URLSearchParams(location.search);setScope({act:q.get('npcAct')||'',chapter:q.get('npcChapter')||q.get('chapter')||''});setSearch(q.get('npcSearch')||'');setStatus(q.get('npcStatus')||'all');}restore();window.addEventListener('popstate',restore);return()=>window.removeEventListener('popstate',restore);},[setSearch,setStatus]);
 const linked=model.appearances.find(l=>l.npcId===selected),act=model.acts.find(a=>a.id===scope?.act)||model.acts.find(a=>a.id===linked?.actId)||model.acts[0];
 const actId=act?.id||'',chapters=act?.chapters||[];
 const chapter=scope?.chapter==='unclassified'||scope?.chapter==='all'||chapters.some(c=>c.id===scope?.chapter)?scope!.chapter:!scope?.chapter&&model.unclassified.has(selected)?'unclassified':!scope?.chapter&&linked?.actId===actId&&linked.chapterId?linked.chapterId:chapters[0]?.id||'all';
 const ready=!!scope&&!snapshot.catalogIndexPending&&(!snapshot.catalogLazy||story.value!==undefined)&&!story.loading&&!story.error;
 useEffect(()=>{if(!active||!ready)return;const q=new URL(location.href);q.searchParams.set('npcAct',actId);q.searchParams.set('npcChapter',chapter);q.searchParams.delete('chapter');if(q.href!==location.href)history.replaceState(history.state,'',q);},[active,ready,actId,chapter]);
 function update(next:{act:string;chapter:string}){setScope(next);const url=new URL(location.href);url.searchParams.set('npcAct',next.act);url.searchParams.set('npcChapter',next.chapter);url.searchParams.delete('chapter');history.pushState(history.state,'',url);}
 function filter(key:'npcSearch'|'npcStatus',value:string){(key==='npcSearch'?setSearch:setStatus)(value);const url=new URL(location.href);if(value&&value!=='all')url.searchParams.set(key,value);else url.searchParams.delete(key);history.replaceState(history.state,'',url);}
 const filtered=npcs.filter(n=>npcMatches(n,search,status,'all')),groups=scopeNpcs(model,filtered,actId,chapter);
 return {model,act,actId,chapter,chapters,ready,story,groups,visible:[...groups.common,...groups.scoped],chooseAct:(id:string)=>update({act:id,chapter:'all'}),chooseChapter:(id:string)=>update({act:actId,chapter:id}),setSearch:(value:string)=>filter('npcSearch',value),setStatus:(value:string)=>filter('npcStatus',value),scrollKey:[snapshot.projectId,actId,chapter,search,status].join('|')};
}
