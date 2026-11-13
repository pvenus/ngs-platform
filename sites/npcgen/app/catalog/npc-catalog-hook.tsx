'use client';
import {useEffect,useState} from 'react';
import {NpcCatalogRefresh} from './npc-catalog-refresh';
import type {RecordData} from './adapter';
import {contentOperationsRpc} from './content-operations-api';
import {row,list,type PuzzleRow} from './puzzle-design-api';
import {npcCatalogRead,verifyNpcCatalog,npcCatalogLabels} from '../../lib/shared-runtime/npc-catalog-contract.mjs';
import {npcCatalogView,npcCatalogViewHref} from '../../lib/shared-runtime/npc-catalog-view.mjs';
import {catalogRead} from './story-catalog-api';
import {verifyStoryCatalog} from '../../lib/shared-runtime/story-catalog-contract.mjs';
import {jsonDetails} from '../../lib/shared-runtime/ngs-content-operation-ui.mjs';

type NpcCatalogModel={catalog?:RecordData;index?:RecordData;targets?:RecordData;story?:RecordData;referenceRoster?:RecordData[];viewMode?:'current'|'history';previousHref?:string;ready:boolean;error:string;reload:()=>void;choose:(value:string,preferredNpcId?:string)=>Promise<void>;latest:()=>Promise<void>;previous:()=>void};
export function useNpcCatalog(active:boolean,selected:string,revision:unknown,storyRevision:unknown):NpcCatalogModel {
  const [query,setQuery]=useState(''),[retry,setRetry]=useState(0),[state,setState]=useState<PuzzleRow>({}),[error,setError]=useState('');
  const identity=JSON.stringify([query,retry,revision,storyRevision]);
  useEffect(()=>{const pop=()=>setQuery(location.search);pop();window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop);},[]);
  useEffect(()=>{
    if(!active)return;
    let alive=true;
    async function read(op:string,p:Record<string,unknown>={}) {
      try {const v=await contentOperationsRpc(npcCatalogRead(op,p));if(v.error)throw Error(String(v.error));return v;}
      catch(e){throw Error(op+': '+(e instanceof Error?e.message:String(e)));}
    }
    async function load() {
      try {
        const index=await read('npc-catalog-index'),href=location.href,q=new URL(href).searchParams,view=npcCatalogView(href,index);
        let id=view.id,version=view.version;
        const npcId=decodeURIComponent(new URL(href).hash.slice(1));
        if(npcId&&!view.working) {
          const resolved=await read('npc-catalog-resolve',{npcId,npcRevision:Number(q.get('npcRevision')||revision),...(id?{catalogId:id,version}:{}),...(q.get('npcCharacterHash')?{characterHash:q.get('npcCharacterHash')}:{})});
          id=String(resolved.catalogId);version=Number(resolved.catalogVersion);
        }
        if(!id){id=String(row(index.activation).activeCatalogId);version=Number(row(index.activation).activeCatalogVersion||1);}
        const exact=await verifyNpcCatalog(await read('npc-catalog-get',{catalogId:id,version}));
        if(view.working&&npcId&&!exact.membership.some((m:{npcId:string})=>m.npcId===npcId))throw Error('NPC_CATALOG_TARGET_NOT_CURRENT');
        const catalog=view.working?exact:{...exact,readOnly:true};
        const targets=await read('npc-catalog-request-targets'),source=await verifyNpcCatalog(await read('npc-catalog-get',{catalogId:'npc.catalog.source.npc'+String(row(catalog.npcSourceRef).revision),version:1})),ref=row(catalog.storyCatalogRef),storyId=catalog.kind==='current'?String(ref.id):'story.catalog.source.story'+String(row(ref.sourceRef).revision||storyRevision),story=await verifyStoryCatalog(await catalogRead('story-catalog-get',{catalogId:storyId,version:catalog.kind==='current'?Number(ref.version):1}));
        if(catalog.kind==='current'&&story.projectionHash!==ref.projectionHash)throw Error('NPC_CATALOG_STORY_PIN');
        if(alive){setState({identity,index,catalog,targets,referenceRoster:source.document.characters,story:story.document,viewMode:view.working?'current':'history',previousHref:view.previousHref});setError('');}
      } catch(e){if(alive){setState({identity});setError(e instanceof Error?e.message:String(e));}}
    }
    void load();return()=>{alive=false;};
  },[active,identity,query,revision,storyRevision]);
  const ready=state.identity===identity&&!!state.catalog;
  useEffect(()=>{
    if(!active||!ready||!state.viewMode)return;
    const u=npcCatalogViewHref(location.href,row(state.catalog),selected,state.viewMode==='current'?'current':'history');
    if(u.href!==location.href)history.replaceState(history.state,'',u);
  },[active,ready,state.catalog,state.viewMode,selected]);
  async function choose(value:string,preferredNpcId=selected) {
    try {
      const [id,version]=value.split('@'),v=await contentOperationsRpc(npcCatalogRead('npc-catalog-get',{catalogId:id,version:Number(version)})),c=await verifyNpcCatalog(v),freshIndex=await contentOperationsRpc(npcCatalogRead('npc-catalog-index')),a=row(freshIndex.activation);
      if(freshIndex.error)throw Error(String(freshIndex.error));
      const chosen=preferredNpcId&&c.membership.some((m:{npcId:string})=>m.npcId===preferredNpcId)?preferredNpcId:c.membership[0]?.npcId||'';
      const mode=a.activeCatalogId===c.id&&Number(a.activeCatalogVersion||1)===c.version?'current':'history';
      const u=npcCatalogViewHref(location.href,c,chosen,mode,{switching:true});
      history.pushState(history.state,'',u);window.dispatchEvent(new PopStateEvent('popstate'));
    }catch(e){setError(e instanceof Error?e.message:String(e));}
  }
  async function latest(){const index=await contentOperationsRpc(npcCatalogRead('npc-catalog-index')),a=row(index.activation);if(index.error){setError(String(index.error));return;}await choose(String(a.activeCatalogId)+'@'+String(a.activeCatalogVersion||1),selected);}
  function previous(){if(!state.previousHref)return;history.pushState(history.state,'',String(state.previousHref));window.dispatchEvent(new PopStateEvent('popstate'));}
  return {...(ready?state:{}),ready,error,reload:()=>setRetry(n=>n+1),choose,latest,previous} as NpcCatalogModel;
}

export function NpcCatalogToolbar({model}:{model:ReturnType<typeof useNpcCatalog>}) {
  const c=row(model.catalog),options=list(row(model.index).catalogs),a=row(row(model.index).activation),isActive=(v:PuzzleRow)=>v.id===a.activeCatalogId&&Number(v.version)===Number(a.activeCatalogVersion||1);
  return <header className="story-catalog-header"><div>
    <label>NPC 카탈로그<select aria-label="NPC 카탈로그" value={c.id?String(c.id)+'@'+String(c.version):''} onChange={e=>void model.choose(e.target.value)}>
      <option value="" disabled>카탈로그 선택</option>{options.map(v=><option key={String(v.id)+'@'+String(v.version)} value={String(v.id)+'@'+String(v.version)}>{npcCatalogLabels[String(v.kind)]||String(v.id)} · v{String(v.version)}{v.kind==='current'&&!isActive(v)?' · 과거 원문':''}{v.kind==='source'?' · NPC rev'+String(row(v.npcSourceRef).revision||String(v.id).split('npc').pop()):''}</option>)}
      {!!c.id&&!options.some(x=>x.id===c.id&&x.version===c.version)&&<option value={String(c.id)+'@'+String(c.version)}>과거 원본 · NPC rev{String(row(c.npcSourceRef).revision)}</option>}
    </select></label>
    <p>{c.id?`${model.viewMode==='history'?'과거 원문 · 읽기 전용':'현재 작업 · 최신 활성 버전'} · ${npcCatalogLabels[String(c.kind)]} · ${list(c.membership).length}명 · NPC rev${String(row(c.npcSourceRef).revision)}${c.sourceIsLatest?' · 최신 원문 일치':c.kind==='current'?' · 원문 개정 변경 · 정식 카탈로그 갱신 필요':' · 고정된 과거 원문'}`:'정확한 NPC 개정을 확인하고 있습니다.'}</p>
    {model.previousHref&&<p role="status">이전 작업 링크를 최신 활성 카탈로그로 연결했습니다. 과거 원문과 대표 이력은 보존됩니다. <button onClick={model.previous}>이전 버전 원문 보기</button></p>}
    {model.viewMode==='history'&&<p>이 화면은 정확한 과거 버전을 표시합니다. 현재 대표와 제작 작업은 <button onClick={()=>void model.latest()}>최신 현재 NPC로 이동</button>에서 확인하세요.</p>}
    <p>{!!c.id&&!c.storyCatalogRef&&'이 NPC 개정의 역사적 스토리 계층은 제공되지 않아 현재 승인 스토리를 보조 분류 맥락으로 표시합니다. '}</p>
    <p>레거시는 활성 제작 목록과 분리한 보존 자료입니다. 원문·관계·이미지·이력을 삭제하지 않습니다.</p>
  </div><div>
    {c.kind==='current'&&model.viewMode==='current'&&<NpcCatalogRefresh reload={model.reload} choose={model.choose} activeIsViewed={isActive(c)}/>}
    <button onClick={model.reload}>NPC 카탈로그 새로고침</button>{!!c.id&&<button onClick={()=>jsonDetails('NPC 카탈로그 출처·정확 개정',c)}>NPC 출처 JSON</button>}
  </div>{model.error&&<p role="alert">{model.error}</p>}</header>;
}
