'use client';
import {useEffect,useRef,useState} from 'react';
import {categoryFramePath,mergeCategoryLocation,type ProductionArea} from './category-routing';

type Phase='loading'|'loaded-awaiting-ready'|'ready'|'delayed'|'failed';
type FrameView={area:ProductionArea;src:string;generation:number};
type ActiveFrame=FrameView & {phase:Phase;refreshLoading?:boolean};
type TimingStage='navigation-start'|'document-load'|'child-loading'|'ready'|'error'|'delayed';
type FrameTiming={generation:number;navigationStartAt:number;documentLoadAt:number;childLoadingAt:number;readyAt:number;errorAt:number;delayedAt:number;lastStage:TimingStage};
type FrameDomTiming={generation:number;addedCount:number;removedCount:number;moveCount:number;lastAddAt:number;lastRemoveAt:number;isConnected:number};

function stampTiming(previous:FrameTiming|null,currentGeneration:number,stage:Exclude<TimingStage,'navigation-start'>,at:number):FrameTiming|null{
 if(!previous||previous.generation!==currentGeneration)return previous;
 const field=stage==='document-load'?'documentLoadAt':stage==='child-loading'?'childLoadingAt':stage==='ready'?'readyAt':stage==='error'?'errorAt':'delayedAt';
 if(previous[field]!==0&&previous.lastStage===stage)return previous;
 return {...previous,[field]:previous[field]===0?at:previous[field],lastStage:stage};
}

export function ProductionCategory({area}:{area:ProductionArea}){
 const frame=useRef<{node:HTMLIFrameElement;generation:number;area:ProductionArea}|null>(null);
 const active=useRef<ActiveFrame|null>(null);
 const identity=useRef<string|null>(null);
 const generation=useRef(0);
 const deadline=useRef<ReturnType<typeof setTimeout>|null>(null);
 const retry=useRef<(()=>void)|null>(null);
 const [view,setView]=useState<FrameView|null>(null);
 const [phase,setPhase]=useState<Phase>('loading');
 const [height,setHeight]=useState(900);
 const [timing,setTiming]=useState<FrameTiming|null>(null);
 const [domTiming,setDomTiming]=useState<FrameDomTiming|null>(null);
 const [scopeNotice,setScopeNotice]=useState<{area:ProductionArea;generation:number}|null>(null);

 // Install before navigation schedules the initial iframe commit. Ref callbacks
 // only identify the committed node; only childList records count as events.
 useEffect(()=>{
  if(typeof MutationObserver==='undefined')return;
  let observing=true;
  let trackedNode:HTMLIFrameElement|null=null;
  let tracked:FrameDomTiming|null=null;
  let pendingRemoval=false;
  const observer=new MutationObserver(records=>{
   if(!observing)return;
   const committed=frame.current,current=active.current;
   if(!committed||!current||committed.area!==area||current.area!==area||committed.generation!==current.generation)return;
   const node=committed.node,currentGeneration=committed.generation;
   let changed=false;
   for(const record of records){
    if(record.type!=='childList')continue;
    const removed=Array.from(record.removedNodes).some(candidate=>candidate===node||candidate.contains(node));
    const added=Array.from(record.addedNodes).some(candidate=>candidate===node||candidate.contains(node));
    if(!removed&&!added)continue;
    if(!tracked||tracked.generation!==currentGeneration||trackedNode!==node){
     trackedNode=node;
     tracked={generation:currentGeneration,addedCount:0,removedCount:0,moveCount:0,lastAddAt:0,lastRemoveAt:0,isConnected:0};
     pendingRemoval=false;
    }
    const at=Date.now();
    if(removed){
     tracked={...tracked,removedCount:Math.min(65535,tracked.removedCount+1),lastRemoveAt:at};
     pendingRemoval=true;
    }
    if(added){
     tracked={...tracked,addedCount:Math.min(65535,tracked.addedCount+1),moveCount:Math.min(65535,tracked.moveCount+(pendingRemoval?1:0)),lastAddAt:at};
     pendingRemoval=false;
    }
    changed=true;
   }
   if(!changed||!tracked)return;
   tracked={...tracked,isConnected:node.isConnected?1:0};
   const snapshot=tracked;
   setDomTiming(previous=>{
    const latest=frame.current,next=active.current;
    if(!observing||!latest||latest.node!==node||latest.generation!==currentGeneration||latest.area!==area||!next||next.generation!==currentGeneration||next.area!==area)return previous;
    return snapshot;
   });
  });
  try{
   if(!document.body){observer.disconnect();return;}
   observer.observe(document.body,{childList:true,subtree:true});
  }catch{
   // Only diagnostic observer setup may fail without affecting the lifecycle.
   observing=false;
   observer.disconnect();
   return;
  }
  return()=>{
   observing=false;
   observer.disconnect();
   trackedNode=null;
   tracked=null;
  };
 },[area]);

 useEffect(()=>{
  const handoffs=new Map<string,string|undefined>();
  function clearDeadline(){
   if(deadline.current!==null){clearTimeout(deadline.current);deadline.current=null;}
  }
  function startDeadline(next:ActiveFrame){
   clearDeadline();
   deadline.current=setTimeout(()=>{
    deadline.current=null;
    if(active.current!==next||next.phase==='ready'||next.phase==='failed')return;
    const at=Date.now();
    setTiming(previous=>stampTiming(previous,next.generation,'delayed',at));
    next.phase='delayed';
    setPhase('delayed');
   },45000);
  }
  function navigate(path:string,force=false){
   if(!force&&identity.current===path)return;
   clearDeadline();
   handoffs.clear();
   identity.current=path;
   const next:ActiveFrame={area,src:path,generation:++generation.current,phase:'loading'};
   active.current=next;
   setTiming({generation:next.generation,navigationStartAt:Date.now(),documentLoadAt:0,childLoadingAt:0,readyAt:0,errorAt:0,delayedAt:0,lastStage:'navigation-start'});
   setHeight(900);
   setPhase('loading');
   setView({area,src:path,generation:next.generation});
   startDeadline(next);
  }
  function restore(){navigate(categoryFramePath(area,location.search));}
  function receive(event:MessageEvent<unknown>){
   const current=active.current,committed=frame.current;
   if(!current||current.area!==area||!committed||committed.area!==area||committed.generation!==current.generation)return;
   if(event.origin!==location.origin||event.source!==committed.node.contentWindow)return;
   const data=event.data;
   if(typeof data==='object'&&data!==null&&'type' in data&&data.type==='ngs-project-request-review-open'){
    if(area!=='resources'||!('area' in data)||data.area!=='resources'||!('projectId' in data)||data.projectId!=='binari'||new URLSearchParams(location.search).get('projectId')!=='binari')return;
    if(Reflect.ownKeys(data).some(key=>typeof key!=='string'||!['type','area','projectId','correlationId','requestId'].includes(key)))return;
    if(!Object.prototype.hasOwnProperty.call(data,'type')||!Object.prototype.hasOwnProperty.call(data,'area')||!Object.prototype.hasOwnProperty.call(data,'projectId')||!Object.prototype.hasOwnProperty.call(data,'correlationId'))return;
    if(!('correlationId' in data)||typeof data.correlationId!=='string'||data.correlationId.length<1||data.correlationId.length>100||/[^A-Za-z0-9_.:-]/.test(data.correlationId))return;
    let requestId:string|undefined;
    if('requestId' in data){
     if(!Object.prototype.hasOwnProperty.call(data,'requestId')||typeof data.requestId!=='string'||data.requestId.length!==48||!/^content\.[a-f0-9]{40}$/.test(data.requestId))return;
     requestId=data.requestId;
    }
    const correlationId=data.correlationId,target=committed.node.contentWindow;
    if(!target)return;
    const duplicate=handoffs.has(correlationId);
    if(duplicate&&handoffs.get(correlationId)!==requestId)return;
    if(!duplicate){
     if(handoffs.size===16){
      const oldest=handoffs.keys().next();
      if(!oldest.done)handoffs.delete(oldest.value);
     }
     handoffs.set(correlationId,requestId);
     window.dispatchEvent(new CustomEvent('project-request-review-open',{detail:{projectId:'binari',...(requestId?{requestId}:{})}}));
    }
    // Dispatch accepts the open intent; it does not verify a server row.
    // A synchronous consumer may replace or unmount the frame before the ack.
    if(active.current!==current||frame.current!==committed||committed.node.contentWindow!==target||location.origin!==event.origin||new URLSearchParams(location.search).get('projectId')!=='binari')return;
    target.postMessage({type:'ngs-project-request-review-opened',area:'resources',projectId:'binari',correlationId,...(requestId?{requestId}:{})},location.origin);
    return;
   }
   if(typeof data!=='object'||data===null||!('type' in data)||data.type!=='ngs-production-category'||!('area' in data)||data.area!==area||!('path' in data)||typeof data.path!=='string')return;
   const incoming='phase' in data?data.phase:'ready';
   if(incoming!=='loading'&&incoming!=='ready'&&incoming!=='error')return;
   let next:URL|null;
   try{next=mergeCategoryLocation(area,location.href,data.path);}catch{return;}
   if(!next)return;
   const at=Date.now();
   setTiming(previous=>stampTiming(previous,current.generation,incoming==='loading'?'child-loading':incoming,at));
   if(incoming==='ready'){
    identity.current=categoryFramePath(area,next.search);
    if(next.href!==location.href)history.pushState(history.state,'',next);
   }
   if('height' in data&&typeof data.height==='number'&&Number.isFinite(data.height))setHeight(Math.max(600,Math.min(24000,data.height)));
   if(incoming==='loading'){
    if(!current.refreshLoading){
     current.refreshLoading=true;
     current.phase='loading';
     setPhase('loading');
     startDeadline(current);
    }
    return;
   }
   current.refreshLoading=false;
   clearDeadline();
   current.phase=incoming==='error'?'failed':'ready';
   setPhase(current.phase);
  }
  identity.current=null;
  retry.current=()=>navigate(identity.current??categoryFramePath(area,location.search),true);
  restore();
  window.addEventListener('message',receive);
  window.addEventListener('popstate',restore);
  return()=>{
   window.removeEventListener('message',receive);
   window.removeEventListener('popstate',restore);
   clearDeadline();
   handoffs.clear();
   retry.current=null;
   active.current=null;
   identity.current=null;
  };
 },[area]);

 // This effect owns only its parent style node and read-only child observers.
 useEffect(()=>{
  if(area!=='resources'||!view||view.area!==area||phase==='failed'||typeof MutationObserver==='undefined')return;
  const committed=frame.current,current=active.current;
  if(!committed||!current||committed.area!==area||current.area!==area||committed.generation!==view.generation||current.generation!==view.generation)return;
  const node=committed.node;
  let disposed=false;
  let child:Document|null=null;
  let childWindow:Window|null=null;
  let childObserver:MutationObserver|null=null;
  let ownedStyle:HTMLStyleElement|null=null;
  let attachment=0;
  function clearStyle(){
   ownedStyle?.remove();
   ownedStyle=null;
  }
  function isCurrent(){
   const latest=frame.current,next=active.current;
   return !disposed&&node.isConnected&&latest?.node===node&&latest.area===area&&latest.generation===view?.generation&&next!==null&&next===current&&next.area===area&&next.generation===view?.generation&&next.phase!=='failed'&&new URLSearchParams(location.search).get('projectId')==='binari';
  }
  function validDocument(doc:Document){
   try{
    const target=node.contentWindow;
    return isCurrent()&&node.contentDocument===doc&&target!==null&&target.document===doc&&target.location.origin===location.origin&&target.location.pathname==='/resource-design';
   }catch{return false;}
  }
  function update(){
   const doc=child;
   if(!doc||!validDocument(doc)){detach();return;}
   try{
    // No child modal-class contract is supplied. Unsupported :modal must
    // fail open rather than misclassify ordinary dialog[open] elements.
    let modal:Element|null=null;
    try{modal=doc.querySelector('dialog:modal');}catch{clearStyle();return;}
    if(!modal){clearStyle();return;}
    if(!ownedStyle&&document.head){
     const style=document.createElement('style');
     style.textContent='.project-request-dock .proposal-review-launcher > .proposal-review-open {visibility:hidden!important;pointer-events:none!important}';
     ownedStyle=style;
     document.head.appendChild(style);
    }
   }catch{detach();}
  }
  function afterDialogEvent(){
   const token=attachment;
   queueMicrotask(()=>{if(!disposed&&token===attachment)update();});
  }
  function detach(){
   attachment++;
   childObserver?.disconnect();
   childObserver=null;
   child?.removeEventListener('close',afterDialogEvent,true);
   child?.removeEventListener('cancel',afterDialogEvent,true);
   childWindow?.removeEventListener('pagehide',detach);
   childWindow?.removeEventListener('beforeunload',detach);
   child=null;
   childWindow=null;
   clearStyle();
  }
  function attach(){
   detach();
   if(!isCurrent())return;
   try{
    const doc=node.contentDocument,target=node.contentWindow;
    if(!doc||!target||!validDocument(doc))return;
    child=doc;
    childWindow=target;
    const token=attachment;
    childObserver=new MutationObserver(()=>{if(!disposed&&token===attachment)update();});
    childObserver.observe(doc,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
    doc.addEventListener('close',afterDialogEvent,true);
    doc.addEventListener('cancel',afterDialogEvent,true);
    target.addEventListener('pagehide',detach);
    target.addEventListener('beforeunload',detach);
    update();
   }catch{detach();}
  }
  const parentObserver=new MutationObserver(()=>{if(!isCurrent())detach();});
  node.addEventListener('load',attach);
  node.addEventListener('error',detach);
  window.addEventListener('pagehide',detach);
  window.addEventListener('popstate',attach);
  try{
   parentObserver.observe(document,{childList:true,subtree:true});
   attach();
  }catch{detach();}
  return()=>{
   disposed=true;
   parentObserver.disconnect();
   node.removeEventListener('load',attach);
   node.removeEventListener('error',detach);
   window.removeEventListener('pagehide',detach);
   window.removeEventListener('popstate',attach);
   detach();
  };
 },[area,view,phase]);

 function loaded(){
  const current=active.current;
  if(view&&view.area===area&&current?.generation===view.generation&&current.area===area){
   const at=Date.now();
   setTiming(previous=>stampTiming(previous,current.generation,'document-load',at));
  }
  if(!view||view.area!==area||current?.generation!==view.generation||current.area!==area||current.phase!=='loading')return;
  current.phase='loaded-awaiting-ready';
  setPhase('loaded-awaiting-ready');
 }
 function failed(){
  const current=active.current;
  if(!view||view.area!==area||current?.generation!==view.generation||current.area!==area)return;
  const at=Date.now();
  setTiming(previous=>stampTiming(previous,current.generation,'error',at));
  if(deadline.current!==null){clearTimeout(deadline.current);deadline.current=null;}
  current.phase='failed';
  setPhase('failed');
 }
 function openRequestReview(){
  const current=active.current;
  if(area!=='resources'||!view||view.area!==area||!current||current.area!==area||current.generation!==view.generation||(current.phase!=='delayed'&&current.phase!=='failed'))return;
  if(new URLSearchParams(location.search).get('projectId')!=='binari'){
   setScopeNotice({area,generation:view.generation});
   return;
  }
  setScopeNotice(null);
  window.dispatchEvent(new CustomEvent('project-request-review-open',{detail:{projectId:'binari'}}));
 }
 const visible=view?.area===area?view:null;
 const visibleTiming=visible&&timing?.generation===visible.generation?timing:null;
 const visibleDomTiming=visible&&domTiming?.generation===visible.generation?domTiming:null;
 const showScopeNotice=visible&&scopeNotice?.area===visible.area&&scopeNotice.generation===visible.generation;
 const recovery=visible&&(phase==='delayed'||phase==='failed');
 const stage=phase==='failed'?'화면 연결 오류':visibleTiming?.childLoadingAt?'자료 준비 완료 대기':visibleTiming?.documentLoadAt?'작업실 시작 응답 대기':'화면 불러오기 확인 대기';
 const status=phase==='delayed'?'작업 영역의 준비가 지연되고 있습니다. 진행 중인 작업은 중단되지 않습니다.':phase==='failed'?'작업 영역을 불러오지 못했습니다. 다시 시도해 주세요.':phase==='loaded-awaiting-ready'?'작업 영역의 준비 응답을 기다리고 있습니다.':'기존 설계 자료를 읽고 있습니다.';
 return <section className="production-category" aria-label={area==='resources'?'배경·프랍 설계':'사건 제작 세트'} data-frame-phase={visible?phase:'loading'} data-frame-generation={visible?.generation??0} data-frame-navigation-start-at={visibleTiming?.navigationStartAt??0} data-frame-document-load-at={visibleTiming?.documentLoadAt??0} data-frame-child-loading-at={visibleTiming?.childLoadingAt??0} data-frame-ready-at={visibleTiming?.readyAt??0} data-frame-error-at={visibleTiming?.errorAt??0} data-frame-delayed-at={visibleTiming?.delayedAt??0} data-frame-last-stage={visibleTiming?.lastStage??'loading'} data-frame-dom-added-count={visibleDomTiming?.addedCount??0} data-frame-dom-removed-count={visibleDomTiming?.removedCount??0} data-frame-dom-move-count={visibleDomTiming?.moveCount??0} data-frame-dom-last-add-at={visibleDomTiming?.lastAddAt??0} data-frame-dom-last-remove-at={visibleDomTiming?.lastRemoveAt??0} data-frame-dom-is-connected={visibleDomTiming?.isConnected??0} data-frame-dom-area={visible?.area}>
  <div aria-live="polite">
   {phase!=='ready'&&<p role="status">{status}</p>}
   {recovery&&<>
    <p>{stage}</p>
    {area==='resources'&&<p>요청 처리 상태는 정식 요청에서 확인할 수 있습니다.</p>}
    <p>다시 연결하면 저장하지 않은 입력이 사라질 수 있습니다. 저장된 요청은 유지됩니다.</p>
    <button type="button" onClick={()=>retry.current?.()}>작업실 화면 다시 연결</button>
    {area==='resources'&&<button type="button" onClick={openRequestReview}>정식 요청에서 상태 확인</button>}
    {showScopeNotice&&<p role="status">현재 프로젝트에서는 정식 요청 상태를 확인할 수 없습니다.</p>}
   </>}
  </div>
  {visible&&<iframe key={visible.generation} ref={node=>{frame.current=node?{node,generation:visible.generation,area:visible.area}:null;}} title={area==='resources'?'배경·프랍 설계 작업 영역':'사건 제작 세트 작업 영역'} src={visible.src} style={{width:'100%',height,border:0,display:'block'}} onLoad={loaded} onError={failed}/>}
 </section>;
}
