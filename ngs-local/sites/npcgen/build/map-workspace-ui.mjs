import {createMapWarp,orderedMapChain} from './map-warp.mjs';
import {hashBrowserMap} from './map-contract.mjs';
import {mapTypes,mapSchemas,backgroundId,validMapGraph,validMapState,validMapRequest,mapRect,mapPoint,mapCanonical} from './map-contract.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls='prop-control')=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
const empty=()=>({title:'',regions:[],startRegionId:null,connections:[]});
export const mapDraftKey=(project,id)=>'ngs-map-draft:v1:'+project+':'+(id??'new');
export function chooseMapDraft(saved,published){
 if(!saved?.graph||typeof saved.graph!=='object')return {graph:published?.graph??empty(),conflict:false};
 if(!published||saved.base===published.revision)return {graph:saved.graph,conflict:false};
 if(published.officialRequestId===saved.accepted||mapCanonical(published.graph)===mapCanonical(saved.graph))
  return {graph:published.graph,conflict:false,done:true};
 return {graph:saved.graph,conflict:true};
}
export function followMapEdge(graph,active,edgeId){
 const e=graph.connections.find(e=>e.from===active&&e.id===edgeId);
 return e&&mapPoint(e.spawn)?{regionId:e.to,position:e.spawn}:null;
}
// Explicit directional chains are expanded locally, never interpreted by a model.
export function parseMapRoutes(text,regions){
 const matches=new Map();
 for(const r of regions)for(const key of new Set([r.id,r.name.trim()])){
  const ids=matches.get(key)??new Set();ids.add(r.id);matches.set(key,ids);
 }
 const result=[],pairs=new Set();
 for(const line of text.trim().split(/\r?\n/).filter(x=>x.trim())){
  const nodes=line.split(/→|->/).map(x=>x.trim());
  if(nodes.length<2||nodes.some(k=>matches.get(k)?.size!==1))throw Error('MAP_ROUTE_NAME_INVALID');
  const ids=nodes.map(k=>[...matches.get(k)][0]);
  for(let i=1;i<ids.length;i++){
   const from=ids[i-1],to=ids[i],pair=from+'>'+to;
   if(from===to)throw Error('MAP_ROUTE_SELF_LINK');
   if(pairs.has(pair))continue;
   pairs.add(pair);
   result.push({id:'route-'+String(result.length+1),from,to,label:regions.find(r=>r.id===to).name,hit:null,spawn:null});
  }
 }
 if(!result.length||result.length>96)throw Error('MAP_ROUTE_COUNT_INVALID');
 return result;
}

export async function mountMapWorkspace({items,detail,tools,request,submit,projectId,item,enabled,navigate,signal,storage=globalThis.sessionStorage}){
 const q=new URLSearchParams({projectId}), mapUrl='/api/map-workspace?'+q;
 const [{maps},{backgrounds},record]=await Promise.all([request(mapUrl),request('/api/background-workspace?'+q),item&&item!=='new'?request(mapUrl+'&item='+encodeURIComponent(item)):null]);
 if(signal?.aborted)return;
 const published=record?.map;
 if(record&&!validMapState(published))throw Error('MAP_READ_INVALID');
 const assets=new Map(backgrounds.filter(b=>backgroundId(b.backgroundId)&&!b.title.endsWith(' · 시네마틱 원본')).map(b=>[b.backgroundId,b]));
 const list=el('div',undefined,'cinematic-list');
 for(const m of maps){const a=el('a',m.title+' · r'+m.revision,'prop-control');a.href=navigate({item:m.mapId});if(m.mapId===item)a.setAttribute('aria-current','page');list.append(a);}
 const opener=button('+',openNew,'npc-one-stop-trigger');
 opener.setAttribute('aria-label','새 맵');opener.title='새 맵';opener.disabled=!enabled||!submit;
 let modal=null;
 items.replaceChildren(list);tools.replaceChildren(opener,button('새로고침',()=>location.reload()));tools.hidden=false;
 if(published)mountMapEditor({detail,maps,assets,projectId,navigate,signal,storage,published,submit,enabled});
 else detail.replaceChildren(el('h3','맵 제작'),el('p','배경을 먼저 제작하고, + 버튼으로 새 맵을 만들어 구역과 포털을 연결하세요.'));
 if(item==='new'&&enabled&&submit)openNew();
 function openNew(){
  if(modal||!enabled||!submit||signal?.aborted)return;
  modal=el('dialog',undefined,'prop-workspace-dialog map-create-dialog');
  const dialog=modal,content=el('div'),heading=el('h3','새 맵 생성 요청'),id='map-create-'+crypto.randomUUID();
  heading.id=id;dialog.setAttribute('aria-labelledby',id);
  dialog.append(heading,el('p','완성된 배경을 고르고 이동 순서를 정하세요. 문서 워커는 지정한 연결의 출입구와 도착점만 찾습니다.','meta'),content);
  const abort=()=>dialog.close();
  const close=()=>dialog.close();
  const canClose=mountMapEditor({detail:content,maps,assets,projectId,navigate,signal,storage,submit,enabled,onClose:close});
  dialog.addEventListener('cancel',ev=>{if(!canClose())ev.preventDefault();});
  dialog.addEventListener('close',()=>{
   signal?.removeEventListener('abort',abort);dialog.remove();modal=null;
   if(!signal?.aborted)opener.focus({preventScroll:true});
  },{once:true});
  signal?.addEventListener('abort',abort,{once:true});
  document.body.append(dialog);dialog.showModal();
  dialog.querySelector('input:not(:disabled)')?.focus({preventScroll:true});
 }
}

export function centerMapPortal(point,previous=null){
 const {width,height}=mapRect(previous)?previous:{width:100,height:80};
 return {x:Math.min(1000-width,Math.max(0,Math.round(point.x-width/2))),
  y:Math.min(1000-height,Math.max(0,Math.round(point.y-height/2))),width,height};
}

const clampMap=(n,min=0,max=1000)=>Math.min(max,Math.max(min,n));
export function moveMapPortal(rect,dx,dy){
 return {...rect,x:clampMap(rect.x+dx,0,1000-rect.width),y:clampMap(rect.y+dy,0,1000-rect.height)};
}
export function resizeMapPortal(rect,corner,dx,dy){
 const east=corner.includes('e'),south=corner.includes('s');
 const oppositeX=east?rect.x:rect.x+rect.width,oppositeY=south?rect.y:rect.y+rect.height;
 const x=clampMap((east?rect.x+rect.width:rect.x)+dx,east?oppositeX+1:0,east?1000:oppositeX-1);
 const y=clampMap((south?rect.y+rect.height:rect.y)+dy,south?oppositeY+1:0,south?1000:oppositeY-1);
 return {x:Math.min(x,oppositeX),y:Math.min(y,oppositeY),width:Math.abs(x-oppositeX),height:Math.abs(y-oppositeY)};
}

function mountMapEditor({detail,maps,assets,projectId,navigate,signal,storage,published,submit,enabled,onClose}){
 const q=new URLSearchParams({projectId});
 const imageAligned=r=>!!r&&assets.get(r.backgroundId)?.sha256===r.imageSha256;
 const assetTitle=id=>assets.get(id)?.displayTitle??assets.get(id)?.title??(id?'누락된 배경 · '+id.slice(-8):'배경 미연결');
 const key=mapDraftKey(projectId,published?.mapId);let saved;
 try{saved=JSON.parse(storage.getItem(key)??'null');}catch{}
 const draft=chooseMapDraft(saved,published);
 let routeText=typeof saved?.routeText==='string'?saved.routeText:'';
 let graph=structuredClone(draft.graph),intent=typeof saved?.intent==='string'?saved.intent:'',conflict=draft.conflict,pending=draft.done?null:saved?.pending??null,lastToken=draft.done?null:saved?.requestToken??null,lastBody=saved?.requestBody??null;
 let edgeId=graph.connections[0]?.id??null,active=graph.startRegionId,mode='edit',busy=false,warp=null,returnRegion=null,setupExpanded=false,stopMovement=()=>{};
 if(draft.done){try{storage.removeItem(key);}catch{}}
 const region=id=>graph.regions.find(r=>r.id===id), regionIds=()=>graph.regions.map(r=>r.id), title=id=>region(id)?.name??'구역 미선택';
 const store=()=>{try{storage.setItem(key,JSON.stringify({base:conflict?saved?.base:published?.revision??0,graph,intent,routeText,pending,accepted:pending?.id??null,requestToken:lastToken,requestBody:lastBody}));}catch{}};
 const bark=el('p','','map-status');bark.setAttribute('role','status');
 const persist=()=>{store();bark.textContent='세션에만 저장됨. 적용 전에는 원본이 바뀌지 않습니다.';};
 const changed=(paint=true)=>{persist();if(paint)render();};
 const setOptions=(values,selected,optionsTitle=title)=>{const s=el('select');for(const v of values){const o=el('option',optionsTitle(v));o.value=v;s.append(o);}s.value=selected??'';return s;};
 const label=(text,input)=>{const l=el('label',text,'map-field');l.append(input);return l;};
 const imageUrl=b=>'/api/background-workspace?'+q+'&image='+b.sha256;
 const locate=(ev,box)=>{const r=box.getBoundingClientRect(),cap=v=>Math.max(0,Math.min(1000,Math.round(v)));return{x:cap((ev.clientX-r.left)*1000/r.width),y:cap((ev.clientY-r.top)*1000/r.height)};};
 async function apply(){
  if(!enabled||!submit||busy||conflict||pending)return;
  const i=published?1:0;
  const payload={schemaVersion:mapSchemas[i],projectId,graph:structuredClone(graph),
   ...(published?{mapId:published.mapId,expectedRevision:published.revision}:{intent:intent.trim()})};
  if(!validMapRequest(payload,mapTypes[i])){
   bark.textContent='맵 이름, 배경 2개 이상, 시작 구역과 확정된 방향 연결을 확인하세요. 수정할 때는 포털 좌표도 필요해요.';return;
  }
  if(graph.regions.some(r=>!imageAligned(r))){bark.textContent='누락된 배경을 제거하거나 교체해 주세요.';return;}
  const body=mapCanonical(payload);
  if(!lastToken||lastBody!==body){lastToken='map:'+crypto.randomUUID();lastBody=body;store();}
  busy=true;render();
  try{
   const response=await submit({requestType:mapTypes[i],idempotencyKey:lastToken,payload});
   const value=await response.json().catch(()=>null);
   if(!isQueuedRequest(response,value))throw Error(value?.error??'MAP_REQUEST_NOT_ACCEPTED');
   pending={id:await hashBrowserMap(projectId,value.queueId)};store();
   bark.textContent='정식 요청이 접수됐습니다. 완료 후 새로고침해 결과를 확인하세요.';
  }catch(e){bark.textContent=e.message==='MAP_REVISION_CONFLICT'?'다른 변경이 먼저 적용됐습니다. 새로고침해 확인해 주세요.':'정식 요청 접수를 확인하지 못했어요. 세션 초안은 그대로입니다.';}
  finally{busy=false;render();}
 }
 if(published)signal?.addEventListener('abort',()=>stopMovement(),{once:true});
 const playable=()=>validMapGraph(graph)&&graph.connections.length>0&&graph.regions.every(imageAligned);
 function startWarp(){
  if(!playable()||signal?.aborted)return;
  if(mode==='edit')returnRegion=active;
  warp=createMapWarp(graph);active=warp.snapshot().regionId;mode='play';
  bark.textContent='';render();
 }
 function closeWarp(){
  if(mode!=='play')return;
  active=returnRegion??graph.startRegionId;returnRegion=null;mode='edit';warp=null;
  bark.textContent='';render({focusPlay:true});
 }
 function drawPosition(actor,positionLabel,{position}){
  actor.style.left=position.x/10+'%';actor.style.top=position.y/10+'%';
  positionLabel.textContent='발 위치: '+Math.round(position.x)+', '+Math.round(position.y);
 }
 function bindMovement(box,draw){
  const current=warp;
  let frame,last=0,target=null;
  const keys=new Set(),vectors={arrowup:[0,-1],arrowdown:[0,1],arrowleft:[-1,0],arrowright:[1,0],w:[0,-1],s:[0,1],a:[-1,0],d:[1,0]};
  const tick=now=>{
   if(warp!==current||signal?.aborted)return;
   const {position}=current.snapshot(), step=Math.min(last?now-last:0,50)*.34;last=now;
   let x=0,y=0;
   for(const k of keys){x+=vectors[k][0];y+=vectors[k][1];}
   if(target&&keys.size===0){x=target.x-position.x;y=target.y-position.y;}
   const d=Math.hypot(x,y);
   if(d&&step){
    const stride=target?Math.min(d,step):step;
    const result=current.move(position.x+x/d*stride,position.y+y/d*stride);
    if(result.warp){
     active=result.regionId;bark.textContent=title(result.warp.from)+' → '+title(result.regionId);
     render();return;
    }
    draw(result);
    if(target&&d<=stride)target=null;
   }
   frame=requestAnimationFrame(tick);
  };
  box.tabIndex=0;
  box.setAttribute('aria-label','워프 플레이 화면. 방향키 또는 WASD로 이동');
  box.onkeydown=ev=>{
   const k=ev.key.toLowerCase();if(!Object.hasOwn(vectors,k)||ev.metaKey||ev.ctrlKey||ev.altKey)return;
   ev.preventDefault();target=null;keys.add(k);
  };
  box.onkeyup=ev=>keys.delete(ev.key.toLowerCase());
  box.onblur=()=>keys.clear();
  box.onpointerdown=ev=>{if(ev.button!==0)return;target=locate(ev,box);keys.clear();box.focus({preventScroll:true});};
  box.focus({preventScroll:true});frame=requestAnimationFrame(tick);
  stopMovement=()=>{
   cancelAnimationFrame(frame);keys.clear();target=null;
   box.onkeydown=box.onkeyup=box.onblur=box.onpointerdown=null;
  };
 }
 function render({focusPlay=false}={}){
  stopMovement();stopMovement=()=>{};let mountPlay;

  const head=el('div',undefined,'map-row');
  const name=el('input');name.value=graph.title;name.maxLength=100;name.disabled=!!pending;
  name.oninput=()=>{graph.title=name.value;changed(false);};
  const play=button(mode==='edit'?'워프 플레이':'처음부터 다시',startWarp);
  play.disabled=!playable();
  head.append(label('맵 이름',name));
  if(published)head.append(play);
  if(mode==='play')head.append(button('플레이 닫기',closeWarp));
  const side=el('div',undefined,'map-panel');
  const sections=el('div',undefined,'map-edit-sections');
  const card=(caption,cls='')=>{
   const node=el('section',undefined,'map-edit-card '+cls), heading=el('h4',caption);
   node.setAttribute('aria-label',caption);node.append(heading);return node;
  };
  const setup=published?card('구역 구성','map-region-card'):side;
  const start=published?card('시작 맵','map-start-card'):side;
  const movement=published?card('이동 연결','map-connection-card'):side;
  function paintMarker(mark,r){
   mark.style.left=r.x/10+'%';mark.style.top=r.y/10+'%';
   if(r.width){mark.style.width=r.width/10+'%';mark.style.height=r.height/10+'%';}
  }
  const marker=(box,r,cls,text)=>{
   const mark=el('span',text,cls);paintMarker(mark,r);box.append(mark);
  };
  function preview(parent,r,{activate,aria}={}){
   const asset=imageAligned(r)?assets.get(r.backgroundId):null;
   if(!asset){parent.append(el('p',r?'연결된 배경 이미지가 없거나 버전이 다릅니다.':'구역을 선택하면 배경이 표시됩니다.','meta'));return null;}
   const box=el('div',undefined,'map-canvas'+(activate?' map-edit-canvas':''));
   const picture=activate?el('button',undefined,'map-coordinate-picker'):box;
   if(activate){
    picture.type='button';picture.setAttribute('aria-label',aria);
    picture.onclick=ev=>activate(ev.detail===0?{x:500,y:500}:locate(ev,box));
    box.append(picture);
   }
   const img=el('img');img.src=imageUrl(asset);img.alt=r.name;img.draggable=false;img.width=asset.width;img.height=asset.height;
   picture.append(img);parent.append(box);return box;
  }
  function dragControl(control,box,initial,adjust,paint,commit){
   let gesture=null;
   control.onpointerdown=ev=>{
    if(ev.button!==0||gesture)return;
    ev.preventDefault();control.focus({preventScroll:true});
    control.setPointerCapture(ev.pointerId);
    gesture={id:ev.pointerId,at:locate(ev,box),next:initial};
   };
   control.onpointermove=ev=>{
    if(gesture?.id!==ev.pointerId)return;
    const p=locate(ev,box);
    gesture.next=adjust(initial,p.x-gesture.at.x,p.y-gesture.at.y);
    paint(gesture.next);
   };
   control.onpointerup=ev=>{
    if(gesture?.id!==ev.pointerId)return;
    control.onpointermove(ev);
    const next=gesture.next;gesture=null;
    if(mapCanonical(next)!==mapCanonical(initial))commit(next);
   };
   control.onpointercancel=control.onlostpointercapture=ev=>{
    if(gesture?.id!==ev.pointerId)return;gesture=null;paint(initial);
   };
   control.onkeydown=ev=>{
    const step=ev.shiftKey?10:1,arrow={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[ev.key];
    if(!arrow)return;
    ev.preventDefault();commit(adjust(initial,...arrow));
   };
  }
  function movableMarker(box,initial,k,commit){
   const portal=k==='hit';
   const wrapper=el('div',undefined,portal?'map-exit selected map-drag-marker map-portal-marker':'map-spawn map-drag-marker');
   const legalLabel=portal?'출입구 이동':'도착점 이동';
   const drag=button(portal?'출입구':'도착',()=>{},'map-drag-body');
   drag.title=legalLabel+' · 드래그 또는 방향키';drag.setAttribute('aria-label',drag.title);wrapper.append(drag);
   const paint=r=>paintMarker(wrapper,r);
   const makeCommit=control=>next=>commit(next,control.getAttribute('aria-label'));
   dragControl(drag,box,initial,portal?moveMapPortal:(p,dx,dy)=>({x:clampMap(p.x+dx),y:clampMap(p.y+dy)}),paint,makeCommit(drag));
   if(portal)for(const [corner,label] of [['nw','왼쪽 위'],['ne','오른쪽 위'],['sw','왼쪽 아래'],['se','오른쪽 아래']]){
    const handle=button('',()=>{},'map-resize-handle map-resize-'+corner);
    handle.title=label+' 모서리로 출입구 크기 조절 · 드래그 또는 방향키';handle.setAttribute('aria-label',handle.title);
    dragControl(handle,box,initial,(r,dx,dy)=>resizeMapPortal(r,corner,dx,dy),paint,makeCommit(handle));wrapper.append(handle);
   }
   paint(initial);box.append(wrapper);
  }
  if(published){
   const regionDetails=el('details',undefined,'map-region-details');regionDetails.open=setupExpanded;
   regionDetails.append(el('summary','구역 구성 · '+graph.regions.length+'개'),setup);
   regionDetails.ontoggle=()=>{setupExpanded=regionDetails.open;};
   sections.append(start,regionDetails,movement);
  }
  if(conflict){side.append(el('p','현재 버전이 바뀌었습니다. 세션 초안은 유지되지만 이전 버전으로 적용할 수 없습니다.'),button('초안 버리고 최신 버전 열기',()=>{
   if(!globalThis.confirm('세션에만 저장된 초안을 버리고 최신 버전을 열까요?'))return;
   storage.removeItem(key);location.reload();
  }));}
  if(mode==='edit'){
   const bgPick=setOptions(['',...assets.keys()],'',id=>id?assetTitle(id):'완성된 배경 선택');
   const plus=button('선택 배경으로 구역 추가',()=>{
    const bg=assets.get(bgPick.value);
    if(!bg||graph.regions.length>=(published?24:12))return;
    const id='r-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
    graph.regions.push({id,name:assetTitle(bgPick.value).slice(0,100),description:'이 배경을 사용해 이동하는 구역',backgroundId:bgPick.value,imageSha256:bg.sha256});
    graph.startRegionId??=id;active=id;changed();
   });plus.disabled=true;
   bgPick.onchange=()=>{plus.disabled=!bgPick.value||graph.regions.length>=(published?24:12)||!!pending;};
   bgPick.disabled=!!pending;
   const open=el('a','배경 설계에서 먼저 제작하기','prop-control');open.href='/?'+new URLSearchParams({projectId,catalogArea:'resources'});
   setup.append(open,label('완성된 배경',bgPick),plus);
   const order=el('ol',undefined,'map-order');
   for(const [i,r] of graph.regions.entries()){
    const item=el('li',r.name+' ');
    const swap=j=>{[graph.regions[i],graph.regions[j]]=[graph.regions[j],graph.regions[i]];changed();};
    const up=button('↑',()=>swap(i-1)),down=button('↓',()=>swap(i+1));
    up.setAttribute('aria-label',r.name+' 앞으로');down.setAttribute('aria-label',r.name+' 뒤로');
    up.disabled=!!pending||i===0;down.disabled=!!pending||i===graph.regions.length-1;item.append(up,down);order.append(item);
   }
   const chain=button('배치 순서대로 단방향 연결',()=>{
    if(graph.connections.length&&!globalThis.confirm('현재 연결을 배치 순서대로 다시 만들까요? 기존 포털 좌표도 초기화됩니다.'))return;
    graph.connections=orderedMapChain(graph.regions);graph.startRegionId=graph.regions[0].id;
    active=graph.startRegionId;edgeId=graph.connections[0].id;changed();
   });chain.disabled=graph.regions.length<2||!!pending;
   setup.append(el('h4','맵 배치 순서'),order);
   // On a published map topology creation remains an explicit edit; the
   // initial ordered chain uses the formal coordinate-authoring request.
   if(!published)side.append(chain);
   const cs=setOptions(regionIds(),graph.startRegionId);cs.disabled=!!pending;
   cs.onchange=()=>{graph.startRegionId=cs.value;changed();};start.append(label('워프 플레이를 시작할 구역',cs));
   if(published){const thumb=el('div',undefined,'map-start-thumbnail');preview(thumb,region(graph.startRegionId));start.append(thumb);}
   const room=setOptions(regionIds(),active);room.onchange=()=>{active=room.value;render();};
   setup.append(label('편집할 구역',room));
   const current=region(active);
   if(current){
    const name=el('input');name.value=current.name;name.maxLength=100;name.disabled=!!pending;
    name.oninput=()=>{current.name=name.value;changed(false);};name.onchange=()=>render();
    const memo=el('textarea');memo.value=current.description;memo.maxLength=1000;memo.disabled=!!pending;
    memo.oninput=()=>{current.description=memo.value;changed(false);};
    const linked=setOptions([...new Set([current.backgroundId,...assets.keys()])],current.backgroundId,assetTitle);
    linked.disabled=!!pending;
    const rebind=()=>{
     const bg=assets.get(linked.value);
     if(!bg||current.backgroundId===linked.value&&current.imageSha256===bg.sha256)return;
     current.backgroundId=linked.value;current.imageSha256=bg.sha256;
     for(const e of graph.connections){if(e.from===current.id)e.hit=null;if(e.to===current.id)e.spawn=null;}
     changed();bark.textContent='이미지가 바뀌어 이 구역의 출입구와 도착점을 비웠어요. 새 배경에 다시 찍어주세요.';
    };
    linked.onchange=rebind;
    setup.append(label('구역 이름',name),label('구역 설명',memo),label('연결한 배경',linked),el('small','구역 ID: '+current.id));
    if(!pending&&!imageAligned(current)&&assets.has(current.backgroundId))setup.append(button('최신 이미지 연결',rebind));
    if(current.backgroundId)setup.append(el('small','배경 ID: '+current.backgroundId));
    if(published){const thumb=el('div',undefined,'map-start-thumbnail');preview(thumb,current);setup.append(thumb);}
   }
   const remove=button('이 구역 빼기',()=>{
    if(!active)return;
    if(graph.connections.some(e=>e.from===active||e.to===active)){bark.textContent='이 구역의 연결을 먼저 삭제하세요.';return;}
    graph.regions=graph.regions.filter(x=>x.id!==active);if(graph.startRegionId===active)graph.startRegionId=graph.regions[0]?.id??null;
    active=graph.startRegionId;changed();
   });remove.disabled=!active||!!pending;setup.append(remove);
   const displayEdge=id=>{const e=graph.connections.find(x=>x.id===id);return title(e.from)+' → '+title(e.to)+' · '+e.label;};
   const selected=graph.connections.find(e=>e.id===edgeId);
   const from=setOptions(regionIds().filter(x=>imageAligned(region(x))),selected?.from??active);
   const to=setOptions([],'');
   const addControls=el('div',undefined,'map-row');
   const refreshTargets=()=>{
    const prior=to.value,ids=regionIds().filter(x=>x!==from.value&&imageAligned(region(x)));
    to.replaceChildren();
    for(const id of ids){const option=el('option',title(id));option.value=id;to.append(option);}
    to.value=ids.includes(prior)?prior:ids[0]??'';
    newEdge.disabled=!from.value||!to.value||graph.connections.length>=96||!!pending;
   };
   const newEdge=button('이동 연결 추가',()=>{
    if(!imageAligned(region(from.value))||!imageAligned(region(to.value))||from.value===to.value||graph.connections.length>=96)return;
    const id='e-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
    graph.connections.push({id,from:from.value,to:to.value,label:title(to.value).slice(0,100),hit:null,spawn:null});
    edgeId=id;changed();
   });
   from.disabled=to.disabled=!!pending;from.onchange=refreshTargets;refreshTargets();
   addControls.append(label('출발 구역',from),label('도착 구역',to),newEdge);movement.append(addControls);
   const edges=setOptions(graph.connections.map(e=>e.id),edgeId,displayEdge);
   edges.onchange=()=>{edgeId=edges.value;render();};
   movement.append(label('편집할 이동 연결',edges));
   const edge=graph.connections.find(e=>e.id===edgeId);
   if(edge){
    const edgeLabel=el('input');edgeLabel.value=edge.label;edgeLabel.maxLength=100;edgeLabel.disabled=!!pending;edgeLabel.oninput=()=>{edge.label=edgeLabel.value;changed(false);};
    movement.append(label('이동 이름',edgeLabel));
    if(published){
     const pair=el('div',undefined,'map-connection-pair');
     for(const [k,id,caption,fields] of [['hit',edge.from,'출발 이미지 · 출입구',['x','y','width','height']],['spawn',edge.to,'도착 이미지 · 도착점',['x','y']]]){
      const panel=el('section',undefined,'map-connection-side');
      const visibleTitle=caption+' ('+title(id)+')';
      panel.setAttribute('aria-label',visibleTitle);panel.append(el('h5',visibleTitle));
      const valid=(k==='hit'?mapRect:mapPoint)(edge[k]),pickLabel=visibleTitle+' 최초 위치 지정. 키보드로 누르면 이미지 중앙에 놓입니다.';
      const savePosition=(next,restoreFocus)=>{
       edge[k]=next;changed();
       if(restoreFocus)for(const b of detail.querySelectorAll?.('[aria-label]')??[]){
        if(b.getAttribute('aria-label')===restoreFocus){b.focus({preventScroll:true});break;}
       }
      };
      const box=preview(panel,region(id),{aria:pickLabel,activate:pending||valid?null:p=>savePosition(k==='hit'?centerMapPortal(p):p,
       k==='hit'?'출입구 이동 · 드래그 또는 방향키':'도착점 이동 · 드래그 또는 방향키')});
      if(box&&valid){
       if(!pending)movableMarker(box,edge[k],k,savePosition);
       else marker(box,edge[k],k==='hit'?'map-exit selected':'map-spawn',k==='hit'?'출입구':'도착');
      }
      panel.append(el('p',k==='hit'?
       (valid?'출입구 안을 끌어 이동하고, 모서리를 끌어 크기를 조절하세요.':'이미지를 눌러 출입구를 처음 놓으세요.'):
       (valid?'도착 마커를 끌어 옮기세요.':'이미지를 눌러 도착점을 처음 놓으세요.'),'meta'));
      const row=el('fieldset');row.append(el('legend',caption.split(' · ')[1]+' 좌표 (0–1000)'));
      for(const f of fields){
       const n=el('input');n.type='number';n.min=['width','height'].includes(f)?'1':'0';n.max='1000';n.step='1';n.value=edge[k]?.[f]??'';n.disabled=!!pending;
       n.onchange=()=>{
        const current=edge[k]??(k==='hit'?centerMapPortal({x:500,y:500}):{x:500,y:500}),proposed={...current,[f]:n.valueAsNumber};
        if((k==='hit'?mapRect:mapPoint)(proposed)){edge[k]=proposed;changed();}
        else{n.value=edge[k]?.[f]??'';bark.textContent='그림 밖이거나 유효하지 않은 좌표예요.';}
       };
       row.append(label({x:'X',y:'Y',width:'너비',height:'높이'}[f],n));
      }
      panel.append(row);pair.append(panel);
     }
     movement.append(pair);
    }
    const del=button('이 연결 삭제',()=>{graph.connections=graph.connections.filter(e=>e.id!==edgeId);edgeId=graph.connections[0]?.id??null;changed();});
    del.disabled=!!pending;movement.append(del);
   }else if(published)movement.append(el('p','이동 연결을 추가하면 출발과 도착 이미지를 나란히 편집할 수 있어요.','meta'));
   if(!published){
    const routes=el('textarea');routes.value=routeText;routes.maxLength=4000;routes.disabled=!!pending;
    routes.placeholder='대문 → 앞마당 → 돌담길 → 뒤뜰 → 처마길 → 앞마당';
    routes.oninput=()=>{routeText=routes.value;changed(false);};
    const use=button('이 동선으로 연결 목록 만들기',()=>{
     try{graph.connections=parseMapRoutes(routeText,graph.regions);edgeId=graph.connections[0].id;changed();}
     catch{bark.textContent='구역 이름을 목록과 정확히 맞추고 방향은 → 또는 ->로 구분해 주세요.';}
    });use.disabled=!!pending;
    side.append(label('동선 붙여넣기 (한 줄에 한 경로)',routes),use);
    const memo=el('textarea');memo.value=intent;memo.maxLength=2000;memo.disabled=!!pending;memo.oninput=()=>{intent=memo.value;changed(false);};
    side.append(label('배경 제작 의도와 좌표 힌트 (예: 대문에서 마당으로, 문턱 바로 안쪽에 도착)',memo));}
  }
  const view=el('div',undefined,'map-preview');
  if(mode==='play'||!published){
   view.append(el('h4',(graph.regions.findIndex(r=>r.id===active)+1)+' / '+graph.regions.length+' · '+title(active)));
   const box=preview(view,region(active));
   if(box&&mode==='play'){
    for(const e of graph.connections.filter(e=>e.from===active&&mapRect(e.hit)))marker(box,e.hit,'map-exit',e.label);
    const actor=el('span',undefined,'map-player');actor.setAttribute('aria-label','캐릭터 위치');box.append(actor);
    const pos=el('p',undefined,'map-position');
    const outgoing=graph.connections.some(e=>e.from===active);
    view.append(el('p',outgoing?'방향키·WASD 또는 바닥 클릭으로 이동하세요. 포털 영역에 들어가면 워프합니다.':'마지막 구역에 도착했습니다. 처음부터 다시 플레이하거나 편집으로 돌아갈 수 있어요.'),pos);
    const draw=state=>drawPosition(actor,pos,state);draw(warp.snapshot());
    mountPlay=outgoing?()=>bindMovement(box,draw):()=>play.focus({preventScroll:true});
   }
  }
  const foot=el('div',undefined,onClose?'prop-actions map-modal-footer':'map-row');
  if(onClose){const close=button('닫기',onClose);close.disabled=busy;foot.append(close);}
  if(mode==='edit'){
   const action=button(busy?'접수 중…':published?'적용 · 정식 수정 요청':'요청 보내기',apply,onClose?'prop-control prop-primary-control':'prop-control');
   action.disabled=!enabled||!submit||busy||conflict||!!pending;foot.append(action);
  }
  if(pending&&!published&&maps.some(x=>x.mapId===pending.id))foot.append(button('생성된 맵 열기',()=>{storage.removeItem(key);location.href=navigate({item:pending.id});}));
  if(pending)foot.append(button('결과 새로고침',()=>location.reload()),button('접수 상태 확인 후 편집 계속',()=>{
   if(!globalThis.confirm('처리 중인 정식 요청은 취소되지 않습니다. 그래도 이 세션의 대기 표시만 지울까요?'))return;pending=null;store();render();
  }));
  if(pending&&!bark.textContent)bark.textContent='정식 요청 접수됨. OPS에서 진행 상태를 확인할 수 있어요.';
  if(!enabled&&!pending&&!bark.textContent)bark.textContent='정식 맵 요청을 접수할 수 없는 상태입니다.';
  const main=el('div',undefined,mode==='play'?'map-play-layout':published?'map-edit-layout':'map-editor');
  if(mode==='edit'&&(!published||conflict))main.append(side);
  main.append(mode==='edit'&&published?sections:view);
  if(mode==='play')for(const controls of [head,main])controls.onkeydown=ev=>{if(ev.key==='Escape'){ev.preventDefault();closeWarp();}};
  if(onClose)detail.replaceChildren(head,main,bark,foot);
  else detail.replaceChildren(el('h3','맵 제작 · r'+published.revision),head,main,foot,bark);
  mountPlay?.();if(focusPlay)play.focus({preventScroll:true});
 }
 render();
 return ()=>!busy;
}
