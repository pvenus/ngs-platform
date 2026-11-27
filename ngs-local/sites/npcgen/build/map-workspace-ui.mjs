import {fileUpdateType,fileUpdateSchema,mapUpdateRoot,validFileUpdate} from './file-update-envelope.mjs';
import {mountCatalogRosterEdit} from './catalog-roster-edit.mjs';
import {orderedMapChain} from './map-warp.mjs';
import {mountAssemblyActor} from './assembly-actor.mjs';
import {decorationsLoader,decorationBox,paintDecoration,renderMapDecorations} from './assembly-sprite-layout.mjs';
import {hashBrowserMap} from './map-contract.mjs';
import {mapTypes,mapGenerateDecorSchema,backgroundId,validMapGraph,validMapState,validMapRequest,mapRect,mapPoint,mapCanonical,maxMapColliders,mapColliderShape,mapColliderRotation,mapDecorPinKey,mapDecorPropPin,maxMapDecorations,maxMapDecorationCandidates} from './map-contract.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn,cls='prop-control')=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b;};
const empty=()=>({title:'',regions:[],startRegionId:null,connections:[]});
const mapTabs=[['start','시작 맵'],['links','이동 연결'],['colliders','충돌 영역'],['decorations','꾸미기']];
const tabFields={start:['startRegionId','startPoint'],links:['regions','connections'],colliders:['colliders'],decorations:['decorations']};
const tabTitle=tab=>mapTabs.find(([key])=>key===tab)?.[1];
export function projectMapTab(base,draft,tab){
 const graph={...base};
 for(const name of tabFields[tab]??[]){
  if(Object.hasOwn(draft,name))graph[name]=draft[name];else delete graph[name];
 }
 return graph;
}
const tabChanged=(base,draft,tab)=>mapCanonical(base)!==mapCanonical(projectMapTab(base,draft,tab));
export const mapDraftKey=(project,id)=>'ngs-map-draft:v1:'+project+':'+(id??'new');
// Rebase only independent portal edits. A real collision on the same
// connection still requires an explicit decision; never replace newer routes.
function rebasePortalDraft(base,draft,current){
 if(!base||!draft||!current||!['regions','connections'].every(k=>Array.isArray(base[k])&&Array.isArray(draft[k])&&Array.isArray(current[k])))return null;
 if(mapCanonical(base.regions)!==mapCanonical(draft.regions)||mapCanonical(base.regions)!==mapCanonical(current.regions)||
    ['start','colliders','decorations'].some(k=>tabChanged(base,draft,k)))return null;
 const index=g=>new Map(g.connections.map(row=>[row.id,row]));
 const before=index(base),local=index(draft),merged=index(current);
 const eq=(a,b)=>a===undefined||b===undefined?a===b:mapCanonical(a)===mapCanonical(b);
 for(const id of new Set([...before.keys(),...local.keys()])){
  const old=before.get(id),mine=local.get(id),remote=merged.get(id);
  if(eq(old,mine))continue;
  if(!eq(old,remote)&&!eq(mine,remote))return null;
  if(mine)merged.set(id,mine);else merged.delete(id);
 }
 return {...current,connections:[...merged.values()]};
}
export function chooseMapDraft(saved,published){
 if(!saved?.graph||typeof saved.graph!=='object')return {graph:published?.graph??empty(),conflict:false};
 if(!published||saved.base===published.revision)return {graph:saved.graph,conflict:false};
 const submission=saved.submission;
 if(tabTitle(submission?.tab)&&submission?.graph&&
    (published.officialRequestId===submission.id||mapCanonical(published.graph)===mapCanonical(submission.graph))){
  let graph=published.graph;
  for(const [tab] of mapTabs)if(tab!==submission.tab||tabChanged(submission.graph,saved.graph,tab))
   graph=projectMapTab(graph,saved.graph,tab);
  return {graph,conflict:false,done:true};
 }
 if(published.officialRequestId===saved.accepted||mapCanonical(published.graph)===mapCanonical(saved.graph)||
    (saved.baseline&&mapCanonical(saved.baseline)===mapCanonical(saved.graph)))
  return {graph:published.graph,conflict:false,done:true};
 if(!saved.pending&&!submission){
  const rebased=rebasePortalDraft(saved.baseline,saved.graph,published.graph);
  if(rebased)return {graph:rebased,conflict:false,done:true};
 }
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

export async function mountMapWorkspace({items,detail,tools,request,submit,projectId,item,enabled,updateEnabled=enabled,navigate,signal,deleteItem,storage=globalThis.sessionStorage}){
 const q=new URLSearchParams({projectId}), mapUrl='/api/map-workspace?'+q;
 const itemUrl=item&&item!=='new'?mapUrl+'&item='+encodeURIComponent(item):null;
 const [{maps:listed},{backgrounds},record]=await Promise.all([request(mapUrl),request('/api/background-workspace?'+q),itemUrl?
  request(itemUrl).catch(error=>({error})):null]);
 if(signal?.aborted)return;
 if(record?.error&&listed.some(row=>row.mapId===item))throw record.error;
 let published=record?.map;
 if(published&&!validMapState(published))throw Error('MAP_READ_INVALID');
 const maps=[...listed],listOwners=items.parentElement;
 listOwners?.classList.add('npc-roster-list','prop-roster');detail.classList?.add('npc-detail','prop-detail');
 const assets=new Map(backgrounds.filter(b=>backgroundId(b.backgroundId)&&!b.title.endsWith(' · 시네마틱 원본')).map(b=>[b.backgroundId,b]));
 const opener=button('+',openNew,'npc-one-stop-trigger');
 opener.setAttribute('aria-label','새 맵');opener.title='새 맵';opener.disabled=!enabled||!submit;
 let modal=null,editor=null,editorAbort=null;
 tools.replaceChildren(opener);tools.hidden=false;
 const edit=signal&&mountCatalogRosterEdit({items,tools,deleteItem,signal});
 const roKey='ngs:map-roster:v1:'+projectId,search=el('input',undefined,'npc-search cinematic-search');
 let rosterState={};
 try{rosterState=JSON.parse(storage.getItem(roKey))??{};}catch{}
 search.type='search';search.id='map-search';search.maxLength=120;search.placeholder='맵 이름 검색';
 search.value=typeof rosterState.query==='string'?rosterState.query.slice(0,120):'';
 const searchLabel=el('label','맵 검색','npc-search-label');searchLabel.htmlFor=search.id;
 items.before?.(searchLabel,search);
 const remember=()=>{try{storage.setItem(roKey,JSON.stringify({query:search.value,top:Number(items.scrollTop)||0}));}catch{}};
 const normalize=v=>v.normalize('NFC').trim().toLocaleLowerCase();
 function renderRoster(top){
  const terms=normalize(search.value).split(/\s+/u).filter(Boolean);
  const rows=maps.filter(m=>terms.every(term=>normalize(m.title).includes(term))).map(m=>{
   const li=el('li'),a=el('a',undefined,'request-item npc-roster-entry');
   a.href=navigate({item:m.mapId});if(m.mapId===item&&published)a.setAttribute('aria-current','page');
   a.append(el('strong',m.title),el('span','버전 '+m.revision,'meta'));
   li.append(a);edit?.decorate(li,m.mapId,m.title,{revision:m.revision,officialRequestId:m.officialRequestId});return li;
  });
  items.replaceChildren(...(rows.length?rows:[el('li',terms.length?'검색 결과가 없습니다.':'게시된 맵이 없습니다.','meta')]));
  edit?.refresh();items.scrollTop=Math.max(0,Number(top)||0);
 }
 search.oninput=()=>{renderRoster(0);remember();};
 items.addEventListener('scroll',remember,{passive:true,...(signal?{signal}:{})});
 renderRoster(rosterState.top);
 function showDetail(){
  editorAbort?.abort();editorAbort=new AbortController();
  if(published)editor=mountMapEditor({detail,maps,assets,request,projectId,navigate,signal:editorAbort.signal,storage,published,submit,enabled:updateEnabled});
  else detail.replaceChildren(el('h3','맵 제작'),el('p','배경을 먼저 제작하고, + 버튼으로 새 맵을 만들어 구역과 포털을 연결하세요.','meta'));
 }
 showDetail();
 let refreshing=false,timer=null;
 if(signal){
  signal.addEventListener('abort',()=>{clearInterval(timer);editorAbort?.abort();remember();searchLabel.remove();search.remove();
   detail.classList?.remove('npc-detail','prop-detail');listOwners?.classList.remove('npc-roster-list','prop-roster');},{once:true});
  timer=setInterval(async()=>{
   if(refreshing||signal.aborted||globalThis.document?.hidden)return;
   refreshing=true;
   try{
    const {maps:next}=await request(mapUrl);
    if(signal.aborted)return;
    const row=next.find(x=>x.mapId===item);
    if(published&&(!row||row.revision!==published.revision)&&editor?.canRefresh()){
     const current=row?await request(itemUrl):{map:null};
     if(signal.aborted)return;
     // Do not replace an editor that started submitting while the list request ran.
     if(editor?.canRefresh()&&(current.map===null||validMapState(current.map))){
      published=current.map;showDetail();
     }
    }
    if(mapCanonical(maps)!==mapCanonical(next)){
     const top=items.scrollTop;maps.splice(0,maps.length,...next);renderRoster(top);modal?.refreshMap?.();
    }
   }catch{/* keep the current list and draft during a temporary replica outage */}
   finally{refreshing=false;}
  },5000);
  timer.unref?.();
 }
 if(item==='new'&&enabled&&submit)openNew();
 function openNew(){
  if(modal||!enabled||!submit||signal?.aborted)return;
  modal=el('dialog',undefined,'prop-workspace-dialog map-create-dialog');
  const dialog=modal,content=el('div'),heading=el('h3','새 맵 생성 요청'),id='map-create-'+crypto.randomUUID();
  heading.id=id;dialog.setAttribute('aria-labelledby',id);
  dialog.append(heading,el('p','배경을 그룹으로 묶고 시작 맵, 포털, 충돌 영역, 꾸미기 요청을 지정하세요. 꾸미기를 선택하면 선택한 프랍의 배치 제안 단계가 추가돼요.','meta'),content);
  const abort=()=>dialog.close();
  const close=()=>dialog.close();
  const createEditor=mountMapEditor({detail:content,maps,assets,request,projectId,navigate,signal,storage,submit,enabled,onClose:close});
  dialog.refreshMap=createEditor.refreshMap;
  dialog.addEventListener('cancel',ev=>{if(!createEditor.canRefresh())ev.preventDefault();});
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

function mountMapEditor({detail,maps,assets,request,projectId,navigate,signal,storage,published,submit,enabled,onClose}){
 const q=new URLSearchParams({projectId});
 const imageAligned=r=>!!r&&assets.get(r.backgroundId)?.sha256===r.imageSha256;
 const assetTitle=id=>assets.get(id)?.displayTitle??assets.get(id)?.title??(id?'누락된 배경 · '+id.slice(-8):'배경 미연결');
 const key=mapDraftKey(projectId,published?.mapId);let saved;
 try{saved=JSON.parse(storage.getItem(key)??'null');}catch{}
 const draft=chooseMapDraft(saved,published);
 const decorationDesign={mode:'none',notes:'',candidates:[],...saved?.decorationDesign};
 const decorArt=decorationsLoader(request,projectId);
 let decorRegion=null,decorId=null,decorPreview=false,warpSight=false,propRows=null,propLoading=false,propLoadFailed=false,decorAdding=false;
 const decorSelection={propId:'',visibility:'both'};
 let decorListScroll=0;
 const newDecorationId=()=> 'd-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
 const showDecorationMode=visibility=>{if(visibility!=='both')decorPreview=visibility==='cinematic';};
 const visibilityLabels={both:'능력 OFF / ON 모두','pixel':'능력 OFF · 픽셀만','cinematic':'능력 ON · 시네마틱만'};
 const pinProp=p=>({propId:p.propId,revision:p.revision,sha256:p.sha256});
 const loadPropRows=()=>{
  if(propRows||propLoading||propLoadFailed)return;
  propLoading=true;
  request('/api/prop-workspace?'+q).then(v=>{if(!Array.isArray(v.props))throw Error('MISSING_PROP_LIST');
   propRows=v.props.filter(p=>mapDecorPropPin(pinProp(p)));
  }).catch(()=>{propLoadFailed=true;}).finally(()=>{propLoading=false;if(!signal?.aborted&&detail.isConnected!==false)render();});
 };
 let routeText=typeof saved?.routeText==='string'?saved.routeText:'';
 const design={startNotes:'',portalNotes:'',collisionNotes:'',collisionMode:'',...saved?.design};
 let startSelected=saved?.startSelected===true;
 let graph=structuredClone(draft.graph),intent=typeof saved?.intent==='string'?saved.intent:'',conflict=draft.conflict,pending=draft.done?null:saved?.pending??null,lastToken=draft.done?null:saved?.requestToken??null,lastBody=saved?.requestBody??null;
 if(published)graph.title=published.graph.title;
 let tab=tabTitle(saved?.tab)?saved.tab:'start',submission=draft.done?null:saved?.submission??null;
 let collisionRegion=graph.startRegionId,collisionId=null,drawingCollider=false,newColliderShape='rect';
 let refreshAction=()=>{};
 let edgeId=graph.connections[0]?.id??null,active=graph.startRegionId,mode='edit',busy=false,returnRegion=null,setupExpanded=false,stopMovement=()=>{};
 if(draft.done){try{storage.removeItem(key);}catch{}}
 const aspectOf=r=>{const a=r&&assets.get(r.backgroundId);return a?.width>0&&a?.height>0?a.width/a.height:1;};
 const region=id=>graph.regions.find(r=>r.id===id), regionIds=()=>graph.regions.map(r=>r.id), title=id=>region(id)?.name??'구역 미선택';
 const dirty=key=>published&&tabChanged(published.graph,graph,key);
 const decorRegionDirty=id=>published&&mapCanonical((graph.decorations??[]).filter(c=>c.regionId===id))!==
  mapCanonical((published.graph.decorations??[]).filter(c=>c.regionId===id));
 const colliderRegionDirty=id=>published&&mapCanonical((graph.colliders??[]).filter(c=>c.regionId===id))!==
  mapCanonical((published.graph.colliders??[]).filter(c=>c.regionId===id));
 const store=()=>{try{storage.setItem(key,JSON.stringify({base:conflict?saved?.base:published?.revision??0,
  baseline:conflict?saved?.baseline:published?.graph,graph,intent,routeText,tab,pending,submission,
  ...(!published?{design,startSelected,decorationDesign}:{}),
  accepted:pending?.id??null,requestToken:lastToken,requestBody:lastBody}));}catch{}};
 if(draft.done&&published)store();
 const publishedRegion=id=>published?.graph.regions.find(r=>r.id===id);
 const publishedIds=()=>published?.graph.regions.map(r=>r.id)??regionIds();
 const bark=el('p','','map-status');bark.setAttribute('role','status');
 const persist=()=>{store();bark.textContent='세션에만 저장됨. 적용 전에는 원본이 바뀌지 않습니다.';};
 const changed=(paint=true)=>{persist();if(paint)render();else refreshAction();};
 const setOptions=(values,selected,optionsTitle=title)=>{const s=el('select');for(const v of values){const o=el('option',optionsTitle(v));o.value=v;s.append(o);}s.value=selected??'';return s;};
 const label=(text,input)=>{const l=el('label',text,'map-field');l.append(input);return l;};
 const imageUrl=b=>'/api/background-workspace?'+q+'&image='+b.sha256;
 const locate=(ev,box)=>{const r=box.getBoundingClientRect(),cap=v=>Math.max(0,Math.min(1000,Math.round(v)));return{x:cap((ev.clientX-r.left)*1000/r.width),y:cap((ev.clientY-r.top)*1000/r.height)};};
 async function apply(){
  if(!enabled||!submit||busy||conflict||pending||decorAdding)return;
  const currentTab=tab;
  if(published&&!dirty(currentTab))return;
  const scoped=published?projectMapTab(published.graph,graph,currentTab):graph;
  if(published&&currentTab==='links'&&scoped.regions.some(r=>{
   const base=publishedRegion(r.id);
   return base&&(base.backgroundId!==r.backgroundId||base.imageSha256!==r.imageSha256)&&(colliderRegionDirty(r.id)||decorRegionDirty(r.id));
  })){
   bark.textContent='바꿀 배경에 충돌 영역 또는 꾸미기 초안이 있어요. 해당 탭부터 적용해 주세요.';return;
  }
  if(!published&&!startSelected){bark.textContent='시작 맵 구역을 먼저 선택해 주세요.';return;}
  if(!published&&!['suggest','none'].includes(design.collisionMode)){bark.textContent='충돌 방식에서 자동 제안 또는 사용 안 함을 먼저 선택해 주세요.';return;}
  const requestType=published?fileUpdateType:mapTypes[0];
  const payload=published?{
   schemaVersion:fileUpdateSchema,projectId,target:{root:mapUpdateRoot,path:published.mapId,kind:'metadata'},
   expected:{revision:published.revision,officialRequestId:published.officialRequestId},content:structuredClone(scoped),
  }:{schemaVersion:mapGenerateDecorSchema,projectId,graph:structuredClone(scoped),
   intent:intent.trim(),design:Object.fromEntries(Object.entries(design).map(([key,value])=>[key,value.trim()])),
   decorationDesign:{...decorationDesign,notes:decorationDesign.notes.trim()}};
  if(!(published?validFileUpdate(payload):validMapRequest(payload,requestType))){
   bark.textContent=published?(currentTab==='links'?'모든 연결의 출입구와 도착점을 지정하고, 시작 구역과 충돌 영역이 있는 구역은 남겨 주세요.':'선택한 구역과 영역 좌표를 확인해 주세요. 새 구역은 이동 연결에서 먼저 적용해야 해요.'):'맵 이름, 배경 2개 이상, 시작 구역, 방향 연결과 꾸미기 후보를 확인하세요.';return;
  }
  if(scoped.regions.some(r=>!imageAligned(r))){bark.textContent='누락된 배경을 제거하거나 교체해 주세요.';return;}
  const body=mapCanonical(payload);
  if(!lastToken||lastBody!==body){lastToken='map:'+crypto.randomUUID();lastBody=body;store();}
  busy=true;render();
  try{
   const response=await submit({requestType,idempotencyKey:lastToken,payload});
   const value=await response.json().catch(()=>null);
   if(!isQueuedRequest(response,value))throw Error(value?.error??'MAP_REQUEST_NOT_ACCEPTED');
   pending={id:await hashBrowserMap(projectId,value.queueId)};
   if(published)submission={id:pending.id,tab:currentTab,graph:payload.content};
   store();
   bark.textContent=published?tabTitle(currentTab)+' 적용 요청을 접수했어요. 완료하면 다른 탭은 초안으로 남아요.':'정식 요청이 접수됐습니다. 완료 후 결과를 확인하세요.';
  }catch(e){bark.textContent=['MAP_REVISION_CONFLICT','FILE_UPDATE_REVISION_CONFLICT'].includes(e.message)?'다른 변경이 먼저 적용됐습니다. 새로고침해 확인해 주세요.':'정식 요청 접수를 확인하지 못했어요. 세션 초안은 그대로입니다.';}
  finally{busy=false;render();}
 }
 signal?.addEventListener('abort',()=>stopMovement(),{once:true});
 const warpGraph=()=>conflict&&published?published.graph:graph;
 const playable=()=>{const plan=warpGraph();return validMapGraph(plan)&&plan.connections.length>0&&plan.regions.every(imageAligned);};
 function startWarp(){
  if(!playable()||signal?.aborted)return;
  if(mode==='edit')returnRegion=active;
  active=warpGraph().startRegionId;mode='play';warpSight=false;
  bark.textContent='';render();
 }
 function closeWarp(){
  if(mode!=='play')return;
  active=returnRegion??graph.startRegionId;returnRegion=null;mode='edit';
  bark.textContent='';render({focusPlay:true});
 }
 function render({focusPlay=false}={}){
  stopMovement();stopMovement=()=>{};let mountPlay;
  const locked=busy||!!pending;refreshAction=()=>{};

  const head=el('div',undefined,'map-row');
  const name=el('input');name.value=graph.title;name.maxLength=100;name.disabled=locked;
  name.oninput=()=>{graph.title=name.value;changed(false);};
  const play=button(mode==='edit'?'워프 플레이':'처음부터 다시',startWarp);
  play.disabled=!playable();
  if(!published)head.append(label('맵 이름',name));
  if(published)head.append(play);
  if(mode==='play')head.append(button('플레이 닫기',closeWarp));
  const side=el('div',undefined,'map-panel');
  const sections=el('section',undefined,'npc-tab-panel map-tab-panel');
  const card=(caption,cls='')=>{
   const node=el('section',undefined,'prop-surface map-edit-card '+cls), heading=el('h4',caption,'npc-media-heading');
   node.setAttribute('aria-label',caption);node.append(heading);return node;
  };
  const setup=published?card('구역 구성','map-region-card'):side;
  const start=card(published?'시작 맵':'1. 시작 맵','map-start-card');
  const movement=card(published?'이동 연결':'2. 포털 · 이동 연결','map-connection-card');
  const collision=published?card('충돌 영역','map-collision-card'):null;
  const decoration=published?card('꾸미기','map-decoration-card'):null;
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
  function paintCollider(mark,rect,shape,rotation){
   paintMarker(mark,rect);mark.style.borderRadius=shape==='ellipse'?'50%':'0';
   mark.style.transform='rotate('+rotation+'deg)';
  }
  function movableMarker(box,initial,k,commit,{shape='rect',rotation=0,aspect=1}={}){
   const rectangular=k!=='spawn',collider=k==='collider',objectLabel=collider?'충돌 영역':rectangular?'출입구':'도착점';
   const wrapper=el('div',undefined,rectangular?'map-exit selected map-drag-marker map-portal-marker'+(collider?' map-collider-marker':''):'map-spawn map-drag-marker');
   const legalLabel=objectLabel+' 이동';
   const drag=button(objectLabel,()=>{},'map-drag-body');
   drag.title=legalLabel+' · 드래그 또는 방향키';drag.setAttribute('aria-label',drag.title);wrapper.append(drag);
   const paint=r=>collider?paintCollider(wrapper,r,shape,rotation):paintMarker(wrapper,r);
   const makeCommit=control=>next=>commit(next,control.getAttribute('aria-label'));
   dragControl(drag,box,initial,rectangular?moveMapPortal:(p,dx,dy)=>({x:clampMap(p.x+dx),y:clampMap(p.y+dy)}),paint,makeCommit(drag));
   if(rectangular)for(const [corner,label] of [['nw','왼쪽 위'],['ne','오른쪽 위'],['sw','왼쪽 아래'],['se','오른쪽 아래']]){
    const handle=button('',()=>{},'map-resize-handle map-resize-'+corner);
    handle.title=label+' 모서리로 '+objectLabel+' 크기 조절 · 드래그 또는 방향키';handle.setAttribute('aria-label',handle.title);
    dragControl(handle,box,initial,(r,dx,dy)=>{
     if(!collider||rotation===0)return resizeMapPortal(r,corner,dx,dy);
     const t=rotation*Math.PI/180,cos=Math.cos(t),sin=Math.sin(t);
     const localX=cos*dx+sin*dy/aspect,localY=-sin*dx*aspect+cos*dy;
     // Keep the rotation center fixed while scaling a turned shape.
     const cx=r.x+r.width/2,cy=r.y+r.height/2;
     const w=Math.max(1,Math.min(2*Math.min(cx,1000-cx),Math.round(r.width+2*localX*(corner.endsWith('e')?1:-1))));
     const h=Math.max(1,Math.min(2*Math.min(cy,1000-cy),Math.round(r.height+2*localY*(corner.startsWith('s')?1:-1))));
     return {x:Math.round(cx-w/2),y:Math.round(cy-h/2),width:w,height:h};
    },paint,makeCommit(handle));wrapper.append(handle);
   }
   paint(initial);box.append(wrapper);
  }
  function restoreControl(aria){
   if(aria)for(const b of detail.querySelectorAll?.('[aria-label]')??[]){
    if(b.getAttribute('aria-label')===aria){b.focus({preventScroll:true});break;}
   }
  }
  function coordinates(caption,keys,initial,makeDefault,validate,commit,live){
   const row=el('fieldset');row.append(el('legend',caption+' 좌표 (0–1000)'));
   for(const key of keys){
    const n=el('input');n.type='number';n.min=['width','height'].includes(key)?'1':'0';n.max='1000';n.step='1';
    n.value=initial?.[key]??'';n.disabled=locked;
    const update=onBlur=>{
     const before=live?.read()??initial;
     const proposed={...(before??makeDefault()),[key]:n.valueAsNumber};
     if(validate(proposed)){
      if(mapCanonical(before??null)!==mapCanonical(proposed))(live?live.commit:commit)(proposed);
     }else if(onBlur){n.value=before?.[key]??'';bark.textContent='그림 밖이거나 유효하지 않은 좌표예요.';}
    };
    if(live)n.oninput=()=>update(false);
    n.onchange=()=>update(true);
    row.append(label({x:'X',y:'Y',width:'너비',height:'높이'}[key],n));
   }
   return row;
  }
  function dragNewCollider(box,shape,commit){
   const surface=el('div',undefined,'map-collider-draw');
   const ghost=el('span',undefined,'map-collider-ghost');ghost.hidden=true;surface.append(ghost);
   let gesture=null;
   const bounds=(a,b)=>({x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
   surface.onpointerdown=ev=>{
    if(ev.button!==0||gesture)return;
    ev.preventDefault();surface.setPointerCapture(ev.pointerId);gesture={id:ev.pointerId,origin:locate(ev,box)};
   };
   surface.onpointermove=ev=>{
    if(gesture?.id!==ev.pointerId)return;
    const next=bounds(gesture.origin,locate(ev,box));ghost.hidden=!mapRect(next);paintCollider(ghost,next,shape,0);
   };
   surface.onpointerup=ev=>{
    if(gesture?.id!==ev.pointerId)return;
    const next=bounds(gesture.origin,locate(ev,box));gesture=null;ghost.hidden=true;
    if(mapRect(next))commit(next);
    else bark.textContent='시작점에서 반대쪽 모서리까지 끌어 영역을 그려 주세요.';
   };
   surface.onpointercancel=surface.onlostpointercapture=ev=>{if(gesture?.id===ev.pointerId){gesture=null;ghost.hidden=true;}};
   box.append(surface);
  }
  function renderColliders(){
   collision.append(el('p','통과할 수 없는 부분을 지정합니다. 충돌 영역은 이동 포털과 별개예요. 웹에서는 표시만 하고 Unity에서 이동을 막는 데 사용해요.','meta'));
   const rooms=publishedIds();
   if(!rooms.includes(collisionRegion)){collisionRegion=published.graph.startRegionId??rooms[0];collisionId=null;drawingCollider=false;}
   const room=setOptions(rooms,collisionRegion,id=>publishedRegion(id)?.name??id);
   room.onchange=()=>{collisionRegion=room.value;collisionId=null;drawingCollider=false;render();};
   const regionsHere=(graph.colliders??[]).filter(c=>c.regionId===collisionRegion);
   const selected=regionsHere.find(c=>c.id===collisionId);
   const controls=el('div',undefined,'map-row');
   const current=publishedRegion(collisionRegion), atLimit=(graph.colliders??[]).length>=maxMapColliders;
   const shapeTitle=shape=>shape==='ellipse'?'원 / 타원':'사각형';
   const shapeChoice=setOptions(['rect','ellipse'],newColliderShape,shapeTitle);
   shapeChoice.disabled=locked||atLimit;
   shapeChoice.onchange=()=>{newColliderShape=shapeChoice.value;render();};
   const draw=button(drawingCollider?'그리기 취소':'새 충돌 영역 그리기',()=>{drawingCollider=!drawingCollider;render();});
   draw.disabled=locked||!imageAligned(current)||atLimit;
   const addKeyboard=button('좌표로 충돌 영역 추가',()=>{
    const rect=centerMapPortal({x:500,y:500});
    if(newColliderShape==='ellipse'){
     const aspect=aspectOf(current);
     rect.width=Math.max(1,Math.round(120/Math.max(aspect,1)));
     rect.height=Math.max(1,Math.round(120*Math.min(aspect,1)));
     rect.x=Math.round(500-rect.width/2);rect.y=Math.round(500-rect.height/2);
    }
    addCollider(rect);
   });
   addKeyboard.disabled=draw.disabled;
   controls.append(label('충돌을 편집할 구역',room),label('새 영역 모양',shapeChoice),draw,addKeyboard);collision.append(controls);
   if(atLimit)collision.append(el('p','맵마다 충돌 영역을 최대 '+maxMapColliders+'개까지 저장할 수 있어요.','meta'));
   const selectedId=setOptions(['',...regionsHere.map(c=>c.id)],collisionId,
    id=>id?'충돌 영역 '+(regionsHere.findIndex(c=>c.id===id)+1):'충돌 영역 선택');
   selectedId.onchange=()=>{collisionId=selectedId.value||null;drawingCollider=false;render();};
   collision.append(label('선택한 충돌 영역',selectedId));
   const box=preview(collision,current);
   const addCollider=rect=>{
    if(locked||!imageAligned(current)||!mapRect(rect)||(graph.colliders??[]).length>=maxMapColliders)return;
    const id='c-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
    graph.colliders=[...(graph.colliders??[]),{id,regionId:collisionRegion,rect,shape:newColliderShape,rotation:0}];
    collisionId=id;drawingCollider=false;changed();
   };
   const saveRect=(rect,aria)=>{selected.rect=rect;changed();restoreControl(aria);};
   if(box){
    box.className+=' map-collision-canvas';
    for(const [i,c] of regionsHere.entries()){
     if(c===selected&&!locked&&!drawingCollider){movableMarker(box,c.rect,'collider',saveRect,{shape:mapColliderShape(c),rotation:mapColliderRotation(c),aspect:aspectOf(current)});continue;}
     const caption='충돌 영역 '+(i+1);
     const node=button(caption,()=>{collisionId=c.id;drawingCollider=false;render();},'map-collider-outline');
     node.title=caption+' 선택';node.disabled=drawingCollider;paintCollider(node,c.rect,mapColliderShape(c),mapColliderRotation(c));box.append(node);
    }
    if(drawingCollider&&!draw.disabled){
     collision.append(el('p','이미지에서 한 모서리를 눌러 반대쪽 모서리까지 끌어 주세요.','meta'));
     dragNewCollider(box,newColliderShape,addCollider);
    }
   }
   if(selected){
    const shapeEdit=setOptions(['rect','ellipse'],mapColliderShape(selected),shapeTitle);shapeEdit.disabled=locked;
    shapeEdit.onchange=()=>{selected.rotation=mapColliderRotation(selected);selected.shape=shapeEdit.value;changed();};
    const angle=el('input');angle.type='number';angle.min='0';angle.max='359';angle.step='1';
    angle.value=mapColliderRotation(selected);angle.disabled=locked;
    angle.onchange=()=>{
     if(!Number.isInteger(angle.valueAsNumber)||angle.valueAsNumber<0||angle.valueAsNumber>359){
      angle.value=mapColliderRotation(selected);bark.textContent='회전은 0°에서 359° 사이로 입력해 주세요.';return;
     }
     selected.shape=mapColliderShape(selected);selected.rotation=angle.valueAsNumber;changed();
    };
    const slider=el('input');slider.type='range';slider.min='0';slider.max='359';slider.step='1';
    slider.value=angle.value;slider.disabled=locked;
    slider.oninput=()=>{angle.value=slider.value;const mark=box?.querySelector?.('.map-collider-marker');if(mark)mark.style.transform='rotate('+slider.value+'deg)';};
    slider.onchange=()=>{angle.value=slider.value;angle.onchange();restoreControl('충돌 영역 회전 슬라이더');};
    slider.setAttribute('aria-label','충돌 영역 회전 슬라이더');
    const shapeRow=el('div',undefined,'map-row');shapeRow.append(label('선택 영역 모양',shapeEdit),label('회전 (°)',angle),label('회전 미리 보기',slider));
    collision.append(shapeRow);
    collision.append(coordinates('충돌 영역',['x','y','width','height'],selected.rect,()=>selected.rect,mapRect,saveRect));
    const remove=button('선택한 충돌 영역 삭제',()=>{
     graph.colliders=graph.colliders.filter(c=>c.id!==collisionId);collisionId=null;changed();
    });
    remove.disabled=locked;collision.append(remove);
   }
  }

  const namedProp=p=>propRows?.find(x=>x.propId===p.propId)?.title??p.propId;
  function availableProps(host,excluded,onAdd,selection){
   loadPropRows();
   if(propLoadFailed){host.append(button('프랍 목록 다시 불러오기',()=>{propLoadFailed=false;render();}));return;}
   if(!propRows){host.append(el('p','프랍 목록 불러오는 중…','meta'));return;}
   const rows=propRows.filter(p=>!excluded.has(p.propId));
   const selector=setOptions(['',...rows.map(p=>p.propId)],rows.some(p=>p.propId===selection?.propId)?selection.propId:'',id=>id?rows.find(p=>p.propId===id).title:'프랍 선택');
   const vis=setOptions(Object.keys(visibilityLabels),selection?.visibility??'both',value=>visibilityLabels[value]);
   const action=button('프랍 추가',()=>{if(locked||decorAdding||action.disabled)return;const row=rows.find(p=>p.propId===selector.value);if(row)void onAdd(pinProp(row),vis.value);});
   selector.disabled=vis.disabled=locked||decorAdding||!rows.length;
   action.disabled=selector.disabled||!selector.value;
   const sample=el('div',undefined,'map-decoration-source-preview');
   sample.setAttribute('aria-label','추가할 프랍 미리보기');
   sample.hidden=true;
   let version=0;
   const showSample=async()=>{
    const ticket=++version,selected=rows.find(p=>p.propId===selector.value);
    sample.hidden=!selected;sample.replaceChildren();
    if(!selected)return;
    const status=el('p','프랍 이미지 불러오는 중…','meta');
    status.setAttribute('role','status');sample.append(status);
    const prop=pinProp(selected),art=(await decorArt.load([{prop}])).get(mapDecorPinKey(prop));
    if(signal?.aborted||sample.isConnected===false||ticket!==version)return;
    const imgAsset=art?.detail??art?.cinematic;
    if(!imgAsset){status.textContent='이 프랍의 비픽셀 미리보기를 불러올 수 없어요.';return;}
    const img=el('img');img.alt=selected.title+' 비픽셀 미리보기';img.draggable=false;
    img.width=imgAsset.width;img.height=imgAsset.height;
    img.onerror=()=>{img.hidden=true;status.textContent='이 프랍의 비픽셀 미리보기를 불러올 수 없어요.';};
    img.src=imgAsset.url;status.textContent=art.detail?'비픽셀 원본 미리보기':'비픽셀 배치 이미지 미리보기';sample.append(img);
   };
   selector.onchange=()=>{
    if(selection)selection.propId=selector.value;
    action.disabled=selector.disabled||!selector.value;void showSample();
   };
   vis.onchange=()=>{if(selection)selection.visibility=vis.value;};
   const row=el('div',undefined,'map-row');
   row.append(label('사용할 프랍',selector),label('표시 모드',vis),action);host.append(row,sample);
   if(selector.value)queueMicrotask(()=>void showSample());
  }
  const decorPaintTicket=new WeakMap();
  const drawDecorArt=(host,placements,mapRegion,sight,dropSignal=signal)=>{
   const ticket=Symbol();decorPaintTicket.set(host,ticket);
   const area=mapRegion&&assets.get(mapRegion.backgroundId);
   const size=area&&{id:mapRegion.id,width:area.width,height:area.height};
   const here=placements.filter(p=>p.regionId===mapRegion?.id);
   const paint=()=>{
    if(host.isConnected===false||dropSignal?.aborted||decorPaintTicket.get(host)!==ticket)return;
    renderMapDecorations(host,here,decorArt.cache,size,sight,mapDecorPinKey);
   };
   paint();if(here.length)void decorArt.load(here).then(paint);
  };
  function renderDecorations(){
   decoration.append(el('p','퍼즐과 상호작용이 없는 프랍을 지도에 배치해요. 프랍을 고른 뒤 지도에서 위치 점을 드래그하세요. 크기 100%는 배치용 이미지의 원래 크기예요.','meta'));
   const rooms=publishedIds();if(!rooms.includes(decorRegion))decorRegion=published.graph.startRegionId??rooms[0];
   const room=setOptions(rooms,decorRegion,id=>publishedRegion(id)?.name??id);
   room.onchange=()=>{decorRegion=room.value;decorId=null;decorListScroll=0;render();};
   const toggle=button(decorPreview?'서진 능력 · ON':'서진 능력 · OFF',()=>{decorPreview=!decorPreview;render();restoreControl('꾸미기 서진 능력 미리보기');});
   toggle.setAttribute('aria-label','꾸미기 서진 능력 미리보기');toggle.setAttribute('aria-pressed',String(decorPreview));
   const controls=el('div',undefined,'map-row');controls.append(label('꾸밀 구역',room));decoration.append(controls);
   const rows=graph.decorations??[], here=rows.filter(p=>p.regionId===decorRegion),chosen=here.find(p=>p.id===decorId);
   if(rows.length<maxMapDecorations)availableProps(decoration,new Set(),async(prop,visibility)=>{
    if(decorAdding||locked)return;
    const regionId=decorRegion;
    decorAdding=true;render();
    const id=newDecorationId();
    const row={id,regionId,prop,anchor:{x:500,y:650},scale:100,visibility};
    const art=(await decorArt.load([row])).get(mapDecorPinKey(prop));decorAdding=false;
    if(signal?.aborted)return;
    if(!art||(visibility==='both'?!(art.pixel&&art.cinematic):!art[visibility])){
     bark.textContent='선택한 프랍에 표시 모드에 필요한 이미지가 없어요.';render();return;
    }
    graph.decorations=[...(graph.decorations??[]),row];decorRegion=regionId;decorId=id;
    decorSelection.propId='';decorListScroll=Number.MAX_SAFE_INTEGER;showDecorationMode(visibility);changed();
   },decorSelection);else decoration.append(el('p','맵 하나에 꾸미기 프랍을 최대 '+maxMapDecorations+'개까지 배치할 수 있어요.','meta'));
   const workspace=el('div',undefined,'map-decoration-editor');
   const mapPane=el('div',undefined,'map-preview map-decoration-map');
   const view=el('div',undefined,'map-decoration-view');
   view.append(el('h5','배치 화면'),toggle);mapPane.append(view);
   const roster=el('section',undefined,'map-decoration-roster');
   roster.setAttribute('aria-label','배치한 프랍');
   roster.append(el('h5','배치한 프랍 ('+here.length+')'));
   const list=el('ul',undefined,'map-decoration-list');
   list.onscroll=()=>{decorListScroll=list.scrollTop;};
   const select=(row,focus)=>{
    decorListScroll=list.scrollTop??decorListScroll;
    if(decorId!==row.id){decorId=row.id;render();}
    if(focus)queueMicrotask(()=>restoreControl(focus));
   };
   const matchesView=row=>row.visibility==='both'||row.visibility===(decorPreview?'cinematic':'pixel');
   for(const [index,row] of here.entries()){
    const entry=el('li'),caption='배치 '+(index+1)+' · '+namedProp(row.prop);
    const pick=button('',()=>select(row,caption),'map-decoration-list-item');
    pick.setAttribute('aria-label',caption);pick.setAttribute('aria-pressed',String(row===chosen));
    pick.append(el('span',caption),el('small',visibilityLabels[row.visibility]+(matchesView(row)?'':' · 현재 숨김')));
    entry.append(pick);list.append(entry);
   }
   if(here.length){roster.append(list);queueMicrotask(()=>{if(list.isConnected!==false)list.scrollTop=decorListScroll;});}
   else roster.append(el('p','이 구역에는 배치한 꾸미기 프랍이 없어요.','meta'));
   if(here.length){
    const remove=button('선택한 프랍 배치 삭제',()=>{
     if(!chosen||locked)return;
     graph.decorations=(graph.decorations??[]).filter(r=>r.id!==chosen.id);
     decorId=null;changed();
    });
    const duplicate=button('선택한 프랍 복제',()=>{
     if(!chosen||locked||decorAdding||rows.length>=maxMapDecorations)return;
     const {x,y}=chosen.anchor,offset=value=>value<=960?value+40:value-40;
     const copy={...chosen,id:newDecorationId(),anchor:{x:offset(x),y:offset(y)}};
     graph.decorations=[...(graph.decorations??[]),copy];decorId=copy.id;
     decorListScroll=Number.MAX_SAFE_INTEGER;showDecorationMode(copy.visibility);changed();
    });
    duplicate.disabled=locked||decorAdding||!chosen||rows.length>=maxMapDecorations;
    remove.disabled=locked||!chosen;
    const actions=el('div',undefined,'map-decoration-actions');
    actions.append(duplicate,remove);roster.append(actions);
   }
   workspace.append(roster,mapPane);decoration.append(workspace);
   const current=publishedRegion(decorRegion),box=preview(mapPane,current);
   if(box){
    box.className+=' map-decoration-canvas';
    const img=box.querySelector('img'),back=assets.get(current.backgroundId);
    if(decorPreview&&back?.cinematic?.sha256)img.src=imageUrl(back.cinematic);
    const markers=el('div',undefined,'map-decoration-layer');box.append(markers);
    const size={id:current.id,width:back.width,height:back.height};
    const paint=()=>{
     if(box.isConnected===false||signal?.aborted)return;
     markers.replaceChildren();
     for(const [index,row] of here.entries()){
      const art=decorArt.cache.get(mapDecorPinKey(row.prop)),visual=decorationBox(row,art,size,decorPreview);
      const selected=row===chosen, caption='배치 '+(index+1)+' · '+namedProp(row.prop)+' 위치';
      const icon=el('img',undefined,'map-decor-sprite map-decoration-selectable');icon.alt='';icon.draggable=false;
      icon.onclick=()=>select(row,caption);
      paintDecoration(icon,visual);markers.append(icon);
      if(!visual&&!selected)continue;
      const pick=button(selected?'●':'○',()=>select(row,caption),'map-decoration-anchor');
      pick.title=caption;pick.setAttribute('aria-label',caption);pick.setAttribute('aria-pressed',String(selected));
      paintMarker(pick,row.anchor);markers.append(pick);
      if(!locked&&selected)dragControl(pick,box,row.anchor,(point,dx,dy)=>({x:Math.min(1000,Math.max(0,point.x+dx)),y:Math.min(1000,Math.max(0,point.y+dy))}),
       anchor=>{paintMarker(pick,anchor);paintDecoration(icon,decorationBox({...row,anchor},art,size,decorPreview));},
       anchor=>{row.anchor=anchor;changed();restoreControl(caption);});
     }
    };
    if(here.length){
     const missing=el('p',undefined,'meta');missing.hidden=true;decoration.append(missing);
     const report=()=>{const count=here.filter(row=>{
      const art=decorArt.cache.get(mapDecorPinKey(row.prop));
      return !art||(row.visibility==='both'?!(art.pixel&&art.cinematic):!art[row.visibility]);
     }).length;missing.hidden=count===0;missing.textContent=count?'배치 이미지 '+count+'개를 읽을 수 없어요. 프랍의 게시 버전과 표시 모드를 확인해 주세요.':'';};
     queueMicrotask(paint);void decorArt.load(here).then(()=>{paint();report();});
    }
   }
   if(!chosen)return;
   if(!matchesView(chosen)){
    decoration.append(el('p','선택한 프랍은 현재 미리보기에서 숨겨져요. 서진 능력 '+(chosen.visibility==='pixel'?'OFF':'ON')+'에서 보여요.','meta'));
   }
   const visibility=setOptions(Object.keys(visibilityLabels),chosen.visibility,value=>visibilityLabels[value]);visibility.disabled=locked;
   visibility.onchange=async()=>{
    const next=visibility.value;
    const art=(await decorArt.load([chosen])).get(mapDecorPinKey(chosen.prop));
    if(signal?.aborted)return;
    if(!art||(next==='both'?!(art.pixel&&art.cinematic):!art[next])){
     visibility.value=chosen.visibility;bark.textContent='이 표시 모드에 필요한 배치 이미지가 없어요.';return;
    }
    chosen.visibility=next;showDecorationMode(next);changed();
   };
   const scale=el('input');scale.type='number';scale.min='10';scale.max='300';scale.step='1';scale.value=chosen.scale;scale.disabled=locked;
   scale.onchange=()=>{
    if(!Number.isInteger(scale.valueAsNumber)||scale.valueAsNumber<10||scale.valueAsNumber>300){scale.value=chosen.scale;return;}
    chosen.scale=scale.valueAsNumber;changed();
   };
   roster.append(label('표시 모드',visibility));
   const sizeField=el('div',undefined,'map-decoration-size');sizeField.append(label('크기 (%)',scale));decoration.append(sizeField);
  }
  function createDecorationPrompt(){
   const prompt=card('4. 꾸미기','map-decoration-card');
   const policy=setOptions(['none','suggest'],decorationDesign.mode,v=>v==='suggest'?'선택한 프랍 자동 배치':'꾸미기 없이 생성');
   policy.disabled=locked;
   policy.onchange=()=>{decorationDesign.mode=policy.value;if(policy.value==='none')decorationDesign.candidates=[];changed();};
   prompt.append(label('꾸미기 방식',policy));
   if(policy.value==='none')return prompt;
   const memo=el('textarea');memo.maxLength=1000;memo.rows=2;memo.value=decorationDesign.notes;memo.disabled=locked;
   memo.placeholder='예: 돌담길 가장자리에 등불을 놓고, 포털과 움직이는 길은 가리지 않게 배치해 주세요.';
   memo.oninput=()=>{decorationDesign.notes=memo.value;changed(false);};
   prompt.append(label('꾸미기 배치 요청 사항',memo));
   const rows=decorationDesign.candidates;
   if(rows.length<maxMapDecorationCandidates)availableProps(prompt,new Set(rows.map(x=>x.prop.propId)),async(prop,visibility)=>{
    decorAdding=true;render();const art=(await decorArt.load([{prop}])).get(mapDecorPinKey(prop));decorAdding=false;
    if(signal?.aborted||detail.isConnected===false||decorationDesign.mode!=='suggest'){render();return;}
    if(!art||(visibility==='both'?!(art.pixel&&art.cinematic):!art[visibility])){
     bark.textContent='선택한 후보에 이 모드의 배치 이미지가 없어요.';render();return;
    }
    rows.push({prop,visibility});changed();
   });
   const list=el('ul',undefined,'map-order');
   for(const [i,c] of rows.entries()){
    const item=el('li',namedProp(c.prop)+' · '+visibilityLabels[c.visibility]+' ');
    const remove=button('빼기',()=>{rows.splice(i,1);changed();});remove.disabled=locked;
    remove.setAttribute('aria-label',namedProp(c.prop)+' 후보에서 빼기');item.append(remove);list.append(item);
   }
   prompt.append(list,el('p','후보는 최소 1개, 최대 '+maxMapDecorationCandidates+'개예요. 워커는 여기서 고른 프랍과 표시 모드만 사용해요.','meta'));
   return prompt;
  }
  const tabs=el('nav',undefined,'npc-detail-tabs');
  if(published&&mode==='edit'){
   tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','맵 상세 영역');
   const switchTab=next=>{
    tab=next;drawingCollider=false;store();render();
    for(const link of detail.querySelectorAll?.('[role="tab"]')??[])
     if(link.id==='map-tab-'+next)link.focus({preventScroll:true});
   };
   for(const [index,[key,caption]] of mapTabs.entries()){
    const link=el('a',caption+(dirty(key)?' •':''));link.href='#map-tab-panel';link.id='map-tab-'+key;
    link.setAttribute('role','tab');link.setAttribute('aria-label',caption+(dirty(key)?' (수정 중)':''));
    link.setAttribute('aria-controls','map-tab-panel');link.setAttribute('aria-selected',String(key===tab));
    link.tabIndex=key===tab?0:-1;
    link.onclick=ev=>{ev?.preventDefault();if(key!==tab)switchTab(key);};
    link.onkeydown=ev=>{
     const next=ev.key==='Home'?0:ev.key==='End'?mapTabs.length-1:ev.key==='ArrowLeft'?
      (index+mapTabs.length-1)%mapTabs.length:ev.key==='ArrowRight'?(index+1)%mapTabs.length:null;
     if(next!==null){ev.preventDefault();switchTab(mapTabs[next][0]);}
    };
    tabs.append(link);
   }
   sections.id='map-tab-panel';sections.tabIndex=0;sections.setAttribute('role','tabpanel');
   sections.setAttribute('aria-labelledby','map-tab-'+tab);
   const regionDetails=el('details',undefined,'prop-surface map-region-details');regionDetails.open=setupExpanded;
   regionDetails.append(el('summary','구역 구성 · '+graph.regions.length+'개'),setup);
   regionDetails.ontoggle=()=>{setupExpanded=regionDetails.open;};
   if(tab==='start')sections.append(start);else if(tab==='links')sections.append(movement,regionDetails);else if(tab==='colliders')sections.append(collision);else{renderDecorations();sections.append(decoration);}
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
   bgPick.onchange=()=>{plus.disabled=!bgPick.value||graph.regions.length>=(published?24:12)||locked;};
   bgPick.disabled=locked;
   const open=el('a','배경 설계에서 먼저 제작하기','prop-control');open.href='/?'+new URLSearchParams({projectId,catalogArea:'resources'});
   setup.append(open,label('완성된 배경',bgPick),plus);
   const order=el('ol',undefined,'map-order');
   for(const [i,r] of graph.regions.entries()){
    const item=el('li',r.name+' ');
    const swap=j=>{[graph.regions[i],graph.regions[j]]=[graph.regions[j],graph.regions[i]];changed();};
    const up=button('↑',()=>swap(i-1)),down=button('↓',()=>swap(i+1));
    up.setAttribute('aria-label',r.name+' 앞으로');down.setAttribute('aria-label',r.name+' 뒤로');
    up.disabled=locked||i===0;down.disabled=locked||i===graph.regions.length-1;item.append(up,down);order.append(item);
   }
   const chain=button('배치 순서대로 단방향 연결',()=>{
    if(graph.connections.length&&!globalThis.confirm('현재 연결을 배치 순서대로 다시 만들까요? 기존 포털 좌표도 초기화됩니다.'))return;
    graph.connections=orderedMapChain(graph.regions);
    active=graph.startRegionId;edgeId=graph.connections[0].id;changed();
   });chain.disabled=graph.regions.length<2||locked;
   setup.append(el('h4','맵 배치 순서'),order);
   // On a published map topology creation remains an explicit edit; the
   // initial ordered chain uses the formal coordinate-authoring request.
   if(!published)movement.append(chain);
   const startOptions=published?publishedIds():['',...regionIds()];
   const cs=setOptions(startOptions,published||startSelected?graph.startRegionId:'',id=>!id?'시작 구역 선택':published?publishedRegion(id)?.name:title(id));
   cs.disabled=locked;cs.required=!published;
   cs.onchange=()=>{
    if(!published)startSelected=Boolean(cs.value);
    if(cs.value&&graph.startRegionId!==cs.value){graph.startRegionId=cs.value;delete graph.startPoint;}
    changed();
   };
   start.append(label(published?'워프 플레이를 시작할 구역':'시작 구역 (필수)',cs));
   if(published){
    const thumb=el('div',undefined,'map-start-thumbnail'),point=graph.startPoint??{x:500,y:850};
    const box=preview(thumb,publishedRegion(graph.startRegionId));
    const savePoint=(next,aria)=>{graph.startPoint=next;changed();restoreControl(aria);};
    if(box){if(locked)marker(box,point,'map-spawn','시작');else movableMarker(box,point,'spawn',savePoint);}
    start.append(thumb,coordinates('시작 위치',['x','y'],point,()=>point,mapPoint,savePoint));
   }
   const room=setOptions(regionIds(),active);room.onchange=()=>{active=room.value;render();};
   setup.append(label('편집할 구역',room));
   const current=region(active);
   if(current){
    const name=el('input');name.value=current.name;name.maxLength=100;name.disabled=locked;
    name.oninput=()=>{current.name=name.value;changed(false);};name.onchange=()=>render();
    const memo=el('textarea');memo.value=current.description;memo.maxLength=1000;memo.disabled=locked;
    memo.oninput=()=>{current.description=memo.value;changed(false);};
    const linked=setOptions([...new Set([current.backgroundId,...assets.keys()])],current.backgroundId,assetTitle);
    linked.disabled=locked;
    const rebind=()=>{
     const bg=assets.get(linked.value);
     if(!bg||current.backgroundId===linked.value&&current.imageSha256===bg.sha256)return;
     if(published&&(colliderRegionDirty(current.id)||decorRegionDirty(current.id))){
      linked.value=current.backgroundId;bark.textContent='이 구역의 충돌 또는 꾸미기 초안을 먼저 적용하거나 지운 뒤 배경을 바꿔 주세요.';return;
     }
     current.backgroundId=linked.value;current.imageSha256=bg.sha256;
     for(const e of graph.connections){if(e.from===current.id)e.hit=null;if(e.to===current.id)e.spawn=null;}
     changed();bark.textContent='새 배경에서 출입구와 도착점을 다시 지정해 주세요.'+
      (published&&(published.graph.colliders??[]).some(c=>c.regionId===current.id)?' 적용한 뒤 기존 충돌 영역도 새 배경에 맞는지 확인해 주세요.':'');
    };
    linked.onchange=rebind;
    setup.append(label('구역 이름',name),label('구역 설명',memo),label('연결한 배경',linked),el('small','구역 ID: '+current.id));
    if(!locked&&!imageAligned(current)&&assets.has(current.backgroundId))setup.append(button('최신 이미지 연결',rebind));
    if(current.backgroundId)setup.append(el('small','배경 ID: '+current.backgroundId));
    if(published){const thumb=el('div',undefined,'map-start-thumbnail');preview(thumb,current);setup.append(thumb);}
   }
   const remove=button('이 구역 빼기',()=>{
    if(!active)return;
    if(graph.connections.some(e=>e.from===active||e.to===active)){bark.textContent='이 구역의 연결을 먼저 삭제하세요.';return;}
    if(published&&(active===published.graph.startRegionId||active===graph.startRegionId)){
     bark.textContent='시작 맵 탭에서 다른 구역을 먼저 적용해 주세요.';return;
    }
    if(published&&(graph.decorations??[]).concat(published.graph.decorations??[]).some(c=>c.regionId===active)){
    bark.textContent='꾸미기 탭에서 이 구역의 프랍 배치를 먼저 삭제하고 적용해 주세요.';return;
   }
   if(published&&(graph.colliders??[]).concat(published.graph.colliders??[]).some(c=>c.regionId===active)){
     bark.textContent='충돌 영역 탭에서 이 구역의 영역을 먼저 삭제하고 적용해 주세요.';return;
    }
    if(!published&&graph.colliders)graph.colliders=graph.colliders.filter(c=>c.regionId!==active);
    graph.regions=graph.regions.filter(x=>x.id!==active);if(graph.startRegionId===active)graph.startRegionId=graph.regions[0]?.id??null;
    if(!graph.startRegionId)startSelected=false;
    active=graph.startRegionId;changed();
   });remove.disabled=!active||locked;setup.append(remove);
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
    newEdge.disabled=!from.value||!to.value||graph.connections.length>=96||locked;
   };
   const newEdge=button('이동 연결 추가',()=>{
    if(!imageAligned(region(from.value))||!imageAligned(region(to.value))||from.value===to.value||graph.connections.length>=96)return;
    const id='e-'+crypto.randomUUID().replaceAll('-','').slice(0,20);
    graph.connections.push({id,from:from.value,to:to.value,label:title(to.value).slice(0,100),hit:null,spawn:null});
    edgeId=id;changed();
   });
   from.disabled=to.disabled=locked;from.onchange=refreshTargets;refreshTargets();
   addControls.append(label('출발 구역',from),label('도착 구역',to),newEdge);movement.append(addControls);
   const edges=setOptions(graph.connections.map(e=>e.id),edgeId,displayEdge);
   edges.onchange=()=>{edgeId=edges.value;render();};
   movement.append(label('편집할 이동 연결',edges));
   const edge=graph.connections.find(e=>e.id===edgeId);
   if(edge){
    const edgeLabel=el('input');edgeLabel.value=edge.label;edgeLabel.maxLength=100;edgeLabel.disabled=locked;edgeLabel.oninput=()=>{edge.label=edgeLabel.value;changed(false);};
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
       restoreControl(restoreFocus);
      };
      const box=preview(panel,region(id),{aria:pickLabel,activate:locked||valid?null:p=>savePosition(k==='hit'?centerMapPortal(p):p,
       k==='hit'?'출입구 이동 · 드래그 또는 방향키':'도착점 이동 · 드래그 또는 방향키')});
      if(box&&valid){
       if(!locked)movableMarker(box,edge[k],k,savePosition);
       else marker(box,edge[k],k==='hit'?'map-exit selected':'map-spawn',k==='hit'?'출입구':'도착');
      }
      panel.append(el('p',k==='hit'?
       (valid?'출입구 안을 끌어 이동하고, 모서리를 끌어 크기를 조절하세요.':'이미지를 눌러 출입구를 처음 놓으세요.'):
       (valid?'도착 마커를 끌어 옮기세요.':'이미지를 눌러 도착점을 처음 놓으세요.'),'meta'));
      panel.append(coordinates(caption.split(' · ')[1],fields,edge[k],
       ()=>k==='hit'?centerMapPortal({x:500,y:500}):{x:500,y:500},k==='hit'?mapRect:mapPoint,savePosition,{
        read:()=>edge[k],
        // Keep the selected coordinate field and the Apply button mounted
        // through blur; replacing the button here can swallow the click.
        commit:next=>{
         if(edge[k])Object.assign(edge[k],next);else edge[k]=next;
         const mark=box?.querySelector?.('.map-drag-marker');if(mark)paintMarker(mark,next);
         changed(false);
        },
       }));pair.append(panel);
     }
     movement.append(pair);
    }
    const del=button('이 연결 삭제',()=>{graph.connections=graph.connections.filter(e=>e.id!==edgeId);edgeId=graph.connections[0]?.id??null;changed();});
    del.disabled=locked;movement.append(del);
   }else if(published)movement.append(el('p','이동 연결을 추가하면 출발과 도착 이미지를 나란히 편집할 수 있어요.','meta'));
   if(published)renderColliders();
   if(!published){
    const routes=el('textarea');routes.value=routeText;routes.maxLength=4000;routes.disabled=locked;
    routes.placeholder='대문 → 앞마당 → 돌담길 → 뒤뜰 → 처마길 → 앞마당';
    routes.oninput=()=>{routeText=routes.value;changed(false);};
    const use=button('이 동선으로 연결 목록 만들기',()=>{
     try{graph.connections=parseMapRoutes(routeText,graph.regions);edgeId=graph.connections[0].id;changed();}
     catch{bark.textContent='구역 이름을 목록과 정확히 맞추고 방향은 → 또는 ->로 구분해 주세요.';}
    });use.disabled=locked;
    movement.append(label('방향 연결 목록 (필수) · 한 줄에 한 경로',routes),use);
    const memo=el('textarea');memo.value=intent;memo.maxLength=2000;memo.disabled=locked;memo.oninput=()=>{intent=memo.value;changed(false);};
    memo.required=true;
    const noteField=(labelName,key,example)=>{
     const input=el('textarea');input.rows=2;input.maxLength=1000;input.value=design[key];input.disabled=locked;input.placeholder=example;
     input.oninput=()=>{design[key]=input.value;changed(false);};return label(labelName,input);
    };
    const collisionPrompt=card('3. 충돌 영역','map-collision-card');
    const policy=setOptions(['','suggest','none'],design.collisionMode,value=>({suggest:'배경을 보고 충돌 영역 제안',none:'충돌 영역 없이 생성'})[value]??'충돌 방식 선택');
    policy.required=true;policy.disabled=locked;policy.onchange=()=>{design.collisionMode=policy.value;changed(false);};
    collisionPrompt.append(label('충돌 방식 (필수)',policy),noteField('충돌 영역 요청 사항 (선택)','collisionNotes','예: 돌담과 잠긴 문만 표시하고 통로는 남겨 주세요.'));
    start.append(noteField('시작 맵 요청 사항 (선택)','startNotes','예: 대문 바로 안쪽의 평평하고 걸을 수 있는 곳에서 시작합니다.'));
    movement.append(noteField('포털 요청 사항 (선택)','portalNotes','예: 앞마당으로 들어가는 문턱 안쪽에서 도착하게 해 주세요.'));
    side.append(label('맵 그룹 제작 의도 (필수)',memo),start,movement,collisionPrompt,createDecorationPrompt());
   }
  }
  const view=el('div',undefined,'map-preview');
  if(mode==='play'||!published){
   const plan=mode==='play'?warpGraph():graph;
   const playRegion=id=>plan.regions.find(r=>r.id===id),playTitle=id=>playRegion(id)?.name??'구역 미선택';
   const heading=el('h4',(plan.regions.findIndex(r=>r.id===active)+1)+' / '+plan.regions.length+' · '+playTitle(active));view.append(heading);
   if(mode==='play'&&conflict&&published)view.append(el('p','게시 버전 '+published.revision+'로 플레이 중 · 이전 편집 초안은 그대로 남아 있어요.','meta'));
   const box=preview(view,playRegion(active));
   if(box&&mode==='play'){
    const picture=box.querySelector('img'),overlay=el('div'),decorLayer=el('div',undefined,'map-decoration-layer'),pos=el('p',undefined,'map-position'),hint=el('p');
    overlay.style.cssText='position:absolute;inset:0;pointer-events:none';box.append(decorLayer,overlay);view.append(hint,pos);
    if((plan.decorations??[]).length){
     const sight=button('서진 능력 · OFF',()=>{warpSight=!warpSight;sight.textContent='서진 능력 · '+(warpSight?'ON':'OFF');sight.setAttribute('aria-pressed',String(warpSight));show(active);box.focus({preventScroll:true});});
     sight.setAttribute('aria-pressed','false');head.append(sight);
    }
    const draw=({position})=>{pos.textContent='발 위치: '+Math.round(position.x)+', '+Math.round(position.y);};
    const show=(id,edge)=>{
     active=id;box.dataset.regionId=id;
     const r=playRegion(id),asset=assets.get(r.backgroundId);
     picture.src=imageUrl(warpSight&&asset.cinematic?.sha256?asset.cinematic:asset);
     drawDecorArt(decorLayer,plan.decorations??[],r,warpSight);picture.alt=r.name;picture.width=asset.width;picture.height=asset.height;
     heading.textContent=(plan.regions.findIndex(r=>r.id===id)+1)+' / '+plan.regions.length+' · '+title(id);
     box.setAttribute('aria-label',r.name+' 워프 플레이 · WASD로 이동');
     overlay.replaceChildren();
     for(const c of (plan.colliders??[]).filter(c=>c.regionId===id)){
      const outline=el('span',undefined,'map-collider-outline map-play-collider');
      paintCollider(outline,c.rect,mapColliderShape(c),mapColliderRotation(c));
      outline.setAttribute('aria-hidden','true');overlay.append(outline);
     }
     const exits=plan.connections.filter(e=>e.from===id&&mapRect(e.hit));
     for(const e of exits)marker(overlay,e.hit,'map-exit',e.label);
     hint.textContent=exits.length
      ?'WASD·방향키 또는 바닥 클릭으로 이동하세요. 포털 영역에 들어가면 이동합니다. 주황색 충돌 영역은 이 미리보기에서 표시만 해요.'
      :'이 구역에서 나가는 포털이 없어요. 구역 안에서는 계속 이동할 수 있어요.';
     if(edge)bark.textContent=playTitle(edge.from)+' → '+playTitle(id);
    };
    mountPlay=()=>{
     const controller=new AbortController();
     stopMovement=()=>controller.abort();
     const actor=mountAssemblyActor(box,{graph:plan,signal:controller.signal,arrows:true,clickToMove:true,collisions:false,markerClass:'map-player',onRegion:show,onMove:draw});
     show(actor.snapshot().regionId);draw(actor.snapshot());box.focus({preventScroll:true});
    };
   }
  }
  const foot=el('div',undefined,onClose?'prop-actions map-modal-footer':'map-row');
  if(onClose){const close=button('닫기',onClose);close.disabled=busy;foot.append(close);}
  if(mode==='edit'){
   const action=button(busy?'접수 중…':published?tabTitle(tab)+' 적용':'요청 보내기',apply,'prop-control prop-primary-control');
   refreshAction=()=>{
    action.disabled=!enabled||!submit||locked||conflict||decorAdding||Boolean(published&&!dirty(tab));
    for(const [i,[key,caption]] of mapTabs.entries()){
     const link=tabs.children[i];if(!link)continue;
     const changed=dirty(key);link.textContent=caption+(changed?' •':'');
     link.setAttribute('aria-label',caption+(changed?' (수정 중)':''));
    }
   };
   refreshAction();foot.append(action);
  }
  if(pending&&!published&&maps.some(x=>x.mapId===pending.id))foot.append(button('생성된 맵 열기',()=>{storage.removeItem(key);location.href=navigate({item:pending.id});}));
  if(pending)foot.append(button('접수 상태 확인 후 편집 계속',()=>{
   if(!globalThis.confirm('처리 중인 정식 요청은 취소되지 않습니다. 그래도 이 세션의 대기 표시만 지울까요?'))return;pending=null;store();render();
  }));
  if(pending&&!bark.textContent)bark.textContent='정식 요청 접수됨. OPS에서 진행 상태를 확인할 수 있어요.';
  if(!enabled&&!locked&&!bark.textContent)bark.textContent='정식 맵 요청을 접수할 수 없는 상태입니다.';
  const main=el('div',undefined,mode==='play'?'map-play-layout':published?'map-edit-layout':'map-editor');
  if(mode==='edit'&&(!published||conflict))main.append(side);
  main.append(mode==='edit'&&published?sections:view);
  if(mode==='play')for(const controls of [head,main])controls.onkeydown=ev=>{if(ev.key==='Escape'){ev.preventDefault();closeWarp();}};
  if(onClose)detail.replaceChildren(head,main,bark,foot);
  else{
   const header=el('header',undefined,'npc-detail-heading prop-detail-heading');
   const identity=el('div',undefined,'prop-identity'),badge=el('div',undefined,'npc-character-badges');
   badge.append(el('span','버전 '+published.revision));identity.append(el('h3',published.graph.title),badge);header.append(identity,head);
   if(mode==='edit'){sections.append(bark,foot);detail.replaceChildren(header,tabs,main);}
   else detail.replaceChildren(header,main,bark,foot);
  }
  mountPlay?.();if(focusPlay)play.focus({preventScroll:true});
 }
 render();
 return {canRefresh:()=>!busy,refreshMap:()=>{if(!busy&&pending)render();}};
}
