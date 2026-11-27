import {fileUpdateType,fileUpdateSchema,assemblyUpdateRoot,validFileUpdate} from './file-update-envelope.mjs';
import {assemblySpriteBox,applyAssemblySpriteBox,exactScale,scaleOf,imageSize,decorationArt,decorationsLoader} from './assembly-sprite-layout.mjs';
import {assemblyReachable,bowlStates,validPortalConditions} from './assembly-contract.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
import {validMapState} from './map-contract.mjs';
import {wellDemoId,wellDemoTitle,wellAssemblySlots,mountWellPuzzleDemo,spiritDemoId,spiritDemoTitle,mountSpiritManifestation,prepareWellPuzzle} from './well-puzzle-demo.mjs';

const slots=Object.entries(wellAssemblySlots),spiritSlots=[['spirit','영물']],allSlots=[...slots,...spiritSlots];
const usesSpirit=p=>p?.type===spiritDemoId;
const slotsFor=p=>usesSpirit(p)?spiritSlots:slots;
const roleTitle=role=>role==='spirit'?'영물':wellAssemblySlots[role];
const applicable=(p,key)=>usesSpirit(p)=== (key==='spirit');
const stateLabels=['제상의 빈 그릇','들고 있는 빈 그릇','들고 있는 물그릇','제상에 올린 물그릇'];
const suggestions={table:/^ritual-seal-altar-/,bowl:/(?:water-bowl|ritual-seal-ash-catcher-)/,well:/^ritual-seal-well-v/,lid:/^ritual-seal-well-cover-/,spirit:/(?:talisman|bell|lantern|charm|thread|hanji)/};
const el=(tag,value,cls)=>{const n=document.createElement(tag);if(value)n.textContent=value;if(cls)n.className=cls;return n;};
const field=(title,input)=>{const row=el('label',title,'prop-form-field');row.append(input);return row;};
const option=(id,title)=>{const n=el('option',title);n.value=id;return n;};
const control=title=>{const n=el('button',title,'prop-control');n.type='button';return n;};
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const safeMedia=url=>typeof url==='string'&&url.startsWith('/api/prop-workspace?');
const viewPoint=p=>['x','y'].every(axis=>Number.isInteger(p?.[axis])&&p[axis]>=10&&p[axis]<=90);
const stateKey='ngs:map-rehearsal:v2:';

const attachmentParent={bowl:'altar',lid:'well'};
const roleParent={table:'altar',well:'well',spirit:'spirit'};
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Math.round(n)));
const offsetOk=p=>['x','y'].every(k=>Number.isInteger(p?.[k])&&Math.abs(p[k])<=12);

const applyErrors={
 FILE_UPDATE_REVISION_CONFLICT:'다른 편집이 먼저 적용됐어요. 조립본을 다시 열고 확인해 주세요.',
 ASSEMBLY_REVISION_CONFLICT:'다른 편집이 먼저 적용됐어요. 조립본을 다시 열고 확인해 주세요.',
 ASSEMBLY_LAYOUT_UNREACHABLE:'최신 맵에서 제상과 우물을 왕복할 수 없어요. 이동 연결을 확인해 주세요.',
 ASSEMBLY_WORKFLOW_UNAVAILABLE:'조립 요청 서비스에 연결되지 않았어요. 배포가 끝난 뒤 다시 시도해 주세요.',
 NGS_REQUEST_QUEUE_UNAVAILABLE:'정식 요청 큐가 잠시 연결되지 않았어요. 초안은 남아 있어요.',
 SPACE_MAP_ASSEMBLY_ACTION_DENIED:'현재 계정에는 조립 수정 권한이 없어요.',
 SPACE_QUEUE_WRITE_NOT_GRANTED:'현재 계정에는 정식 요청을 보낼 권한이 없어요.',
 ASSEMBLY_NOT_FOUND:'조립본을 더 이상 찾을 수 없어요. 목록을 다시 열어 주세요.',
 MAP_NOT_FOUND:'연결한 맵을 찾을 수 없어요. 맵 목록에서 확인해 주세요.',
 NGS_ASSEMBLY_PAYLOAD_INVALID:'프랍 연결이나 배치 값을 다시 확인해 주세요.',
 FRONTEND_SESSION_CONTEXT_CHANGED:'배포 또는 로그인으로 세션이 바뀌었어요. 새로고침한 뒤 변경 적용을 다시 눌러 주세요.',
 LOCAL_SESSION_EXPIRED_OR_REVOKED:'세션이 만료됐어요. 새로고침한 뒤 다시 적용해 주세요.',
 CSRF_INVALID:'세션이 바뀌었어요. 새로고침한 뒤 다시 적용해 주세요.',
};
export function assemblyApplyFailure(code,status){
 if(typeof code==='string'&&Object.hasOwn(applyErrors,code))return applyErrors[code]+' ('+code+')';
 if(status===401||status===419)return '세션을 다시 열어야 해요. 새로고침한 뒤 변경 적용을 다시 눌러 주세요. (HTTP '+status+')';
 if(Number.isInteger(status)&&status>=400&&status<600)return '수정 요청이 접수되지 않았어요. 초안은 남아 있어요. (HTTP '+status+')';
 return '수정 요청의 접수 여부를 확인하지 못했어요. 초안은 남아 있어요.';
}

function mapRehearsalRegions(map,backgrounds){
 const byBackground=new Map(backgrounds.map(x=>[x.backgroundId,x]));
 return map.graph.regions.map(region=>{
  const asset=byBackground.get(region.backgroundId);
  const lane=[asset,asset?.pixel,asset?.cinematic].find(p=>p?.sha256===region.imageSha256);
  if(!lane||!sha(lane.sha256)||!(lane.width>0&&lane.height>0))throw Error('MAP_ART_MISSING');
  const url=entry=>sha(entry?.sha256)&&entry.width>0&&entry.height>0
   ? '/api/background-workspace?'+new URLSearchParams({projectId:map.projectId,image:entry.sha256}) : undefined;
  const src=url(lane);
  return {id:region.id,name:region.name,width:lane.width,height:lane.height,src,pixelSrc:url(asset.pixel)??src,spiritSrc:url(asset.cinematic)??src};
 });
}

export function dragWellPlacement({role,regionId,clientX,clientY,rect,layout,attachments}){
 if(![clientX,clientY,rect.left,rect.top,rect.width,rect.height].every(Number.isFinite)||rect.width<=0||rect.height<=0||!regionId||
    clientX<rect.left||clientX>rect.left+rect.width||clientY<rect.top||clientY>rect.top+rect.height)return null;
 const x=(clientX-rect.left)*100/rect.width,y=(clientY-rect.top)*100/rect.height;
 const parent=attachmentParent[role];
 if(parent){
  if(layout[parent].regionId!==regionId||!viewPoint(layout[parent]))return null;
  const point={x:clamp(x-layout[parent].x,-12,12),y:clamp(y-layout[parent].y,-12,12)};
  return {layout,attachments:{...attachments,[role]:point}};
 }
 const base=roleParent[role];
 return base?{layout:{...layout,[base]:{regionId,x:clamp(x,10,90),y:clamp(y,10,90)}},attachments}:null;
}

export function buildWellRehearsal({map,backgrounds,props,layout,attachments,bindings,media,pins,scale,portalConditions}){
 if(!validMapState(map))throw Error('MAP_INVALID');
 if(!['altar','well'].every(key=>viewPoint(layout[key])&&map.graph.regions.some(x=>x.id===layout[key].regionId)))throw Error('PLACEMENT_INVALID');
 if(attachments&&!['bowl','lid'].every(key=>offsetOk(attachments[key])))throw Error('ATTACHMENT_INVALID');
 const regions=mapRehearsalRegions(map,backgrounds);
 const art={},spiritArt={},artSizes={};
 for(const [role] of slots){
  const row=pins?.[role]??props.find(p=>p.propId===bindings[role]), result=media[role];
  if(!row||!result||result.propId!==row.propId||result.source?.revision!==row.revision||
    result.source?.sha256!==row.sha256||!imageSize(result.media?.pixel)||!safeMedia(result.media?.pixel?.url)||result.media.pixel.mediaType!=='image/png')
   throw Error('PROP_ART_MISSING_OR_STALE');
  const {pixel,spirit}=result.media;
  art[role]=pixel.url;artSizes[role]={width:pixel.width,height:pixel.height};
  if(spirit?.mediaType==='image/png'&&spirit.width===pixel.width&&spirit.height===pixel.height&&safeMedia(spirit.url))
   spiritArt[role]=spirit.url;
 }
 return {initialRegion:map.graph.startRegionId,regions,connections:map.graph.connections,positions:layout,attachments,scale,art,spiritArt,artSizes,graph:map.graph,portalConditions};
}

export function buildSpiritRehearsal(map,backgrounds,point,scale,prop,pin,decorArt){
 const media=pin?decorationArt(prop,pin):null;
 if(!media?.pixel||!media.cinematic||!viewPoint(point)||!map.graph.regions.some(r=>r.id===point.regionId)||!exactScale(scale))
  throw Error('SPIRIT_PLACEMENT_OR_ART_INVALID');
 return {graph:map.graph,regions:mapRehearsalRegions(map,backgrounds),point,scale,media,decorArt};
}

export async function mountWellAssembly({items,detail,request,projectId,signal,published,submit,updateEnabled=true}){
 const loadDecor=decorationsLoader(request,projectId);
 const api=(resource,query={})=>'/api/'+resource+'-workspace?'+new URLSearchParams({projectId,...query});
 const [{maps},{props},{backgrounds}]=await Promise.all(['map','prop','background'].map(name=>request(api(name))));
 if(signal.aborted)return;
 if(![maps,props,backgrounds].every(Array.isArray))throw Error('ASSEMBLY_CATALOG_UNAVAILABLE');
 if(!published){const roster=el('li');roster.append(el('strong','테스트 조립'),el('p','맵 · 퍼즐 · 프랍 연결','meta'));items.replaceChildren(roster);}
 const card=el('section',null,'prop-surface well-assembly'),head=el('h3',published?.title??'조립·플레이');
 const note=el('p',published?'게시 리비전 '+published.revision+' · 편집 중에는 임시 저장되며 적용을 눌러야 정식 요청이 들어가요.':'게임에 게시하지 않고 현재 브라우저에서 연결과 동작을 시험해요.','meta');
 const draftKey=published?'ngs:assembly-draft:'+published.assemblyId+':'+published.revision:stateKey+projectId;
 const feedback=el('p',null,'meta');feedback.setAttribute('role','status');
 const mapSelect=el('select'),puzzle=el('select');
 puzzle.append(option(wellDemoId,wellDemoTitle),option(spiritDemoId,spiritDemoTitle));
 const inputs=el('div',null,'well-assembly-grid');inputs.append(field('맵',mapSelect));
 const positionInputs={},propInputs={},offsetInputs={},scaleInputs={},sizeLabels={},retryArt={},bindingGroups={},positionGroups={},offsetGroups={};
 const placement=el('div',null,'well-assembly-grid');
 const bindingFields=el('div',null,'well-assembly-grid');
 for(const [role,label] of allSlots){
  const pattern=suggestions[role];
  const select=el('select');select.append(option('','프랍 선택'));
  const candidates=props.filter(row=>pattern.test(row.propId));
  const other=props.filter(row=>!pattern.test(row.propId));
  for(const row of [...candidates,...other]){
   const alias=role==='bowl'&&row.propId.startsWith('ritual-seal-ash-catcher-')?' (물그릇 임시 대역)':'';
   select.append(option(row.propId,row.title+alias));
  }
  select.value='';
  propInputs[role]=select;
  const group=el('div',null,'well-assembly-role'),size=el('input'),dimensions=el('small','100% = 원래 픽셀 크기','meta');
  size.type='number';size.min='10';size.max='300';size.step='1';size.value='100';size.required=true;
  size.setAttribute('aria-label',label+' 크기 (%)');scaleInputs[role]=size;sizeLabels[role]=dimensions;
  const reset=control('100%로');reset.addEventListener('click',()=>{size.value='100';size.dispatchEvent(new Event('input',{bubbles:true}));},{signal});
  const scaleLine=el('div',null,'well-assembly-scale');scaleLine.append(field('크기 (%)',size),reset);
  dimensions.setAttribute('aria-live','polite');
  const retry=control('이미지 다시 불러오기');retry.hidden=true;retryArt[role]=retry;
  retry.addEventListener('click',()=>{if(selected)void paintArt(selected,role);},{signal});
  group.append(field(label,select),scaleLine,dimensions,retry);bindingGroups[role]=group;bindingFields.append(group);
 }
 for(const [key,title] of [['altar','제상 위치 · 그릇 자리 포함'],['well','우물 위치 · 뚜껑 포함'],['spirit','영물 위치']]){
  const group=el('fieldset'),legend=el('legend',title),region=el('select'),coords=el('div',null,'well-assembly-grid');
  const number=()=>{const n=el('input');n.type='number';n.required=true;n.min='10';n.max='90';n.step='1';return n;};
  const x=number(),y=number();group.append(legend,field('구역',region),coords);coords.append(field('가로 위치 (%)',x),field('세로 위치 (%)',y));
  positionInputs[key]={region,x,y};positionGroups[key]=group;placement.append(group);
 }
 for(const [key,title] of [['bowl','물그릇 위치 · 제상 기준'],['lid','뚜껑 위치 · 우물 기준']]){
  const group=el('fieldset'),coords=el('div',null,'well-assembly-grid');
  const number=()=>{const n=el('input');n.type='number';n.required=true;n.min='-12';n.max='12';n.step='1';return n;};
  const x=number(),y=number();group.append(el('legend',title),coords);
  coords.append(field('가로 오프셋 (%)',x),field('세로 오프셋 (%)',y));offsetInputs[key]={x,y};offsetGroups[key]=group;placement.append(group);
 }
 const gates=el('fieldset'),gateList=el('ul',null,'well-assembly-list'),gateEdge=el('select'),gateState=el('select');
 gateState.append(...bowlStates.map((id,i)=>option(id,stateLabels[i])));
 gateState.value='carried-empty';
 const gateSet=control('조건 등록');
 gates.append(el('legend','포털 사용 조건'),el('p','방향별로 지정해요. 조건이 없으면 포털은 항상 사용할 수 있어요.','meta'),
  field('이동 연결',gateEdge),field('물그릇 상태',gateState),gateSet,gateList);
 const overview=el('div',null,'well-assembly-board'),boardNotice=el('p','제상·우물은 다른 구역으로도 옮길 수 있어요. 그릇과 뚜껑은 연결된 프랍 근처에서 위치만 조정해요.','meta');
 overview.setAttribute('aria-label','맵 전체 배치');
 const stage=el('section'),play=control('테스트 플레이'),stop=control('테스트 종료'),apply=control('변경 적용'),playPublished=control('게시본 플레이');stop.hidden=true;
 const actions=el('div',null,'prop-actions');actions.append(play,stop);
 if(published){apply.disabled=!submit;playPublished.disabled=!published.puzzles.length;}
 const shell=el('div',null,'well-assembly-shell'), boardSide=el('section'), sidebar=el('aside',null,'well-assembly-sidebar');
 const list=el('ul',null,'well-assembly-list'),add=control('퍼즐 추가'),inspector=el('section',null,'well-assembly-inspector');
 const search=el('input',null,'npc-search');search.type='search';search.placeholder='퍼즐 이름 검색';search.maxLength=100;
 const zoom=el('select');zoom.append(option('','전체 구역'));
 const markMode=()=>zoom.value?'상세 배치':'전체 구역';
 const inspectorTitle=el('h4'),fine=el('details'),remove=control('퍼즐 삭제');
 remove.classList.add('prop-animation-delete','well-assembly-remove');
 const removeDialog=el('dialog',null,'prop-workspace-dialog well-assembly-remove-dialog');
 const removeTitle=el('h3','조립에서 퍼즐 삭제'),removeBody=el('p'),cancelRemove=control('취소'),confirmRemove=control('삭제');
 removeTitle.id='well-assembly-remove-'+crypto.randomUUID();removeDialog.setAttribute('aria-labelledby',removeTitle.id);
 confirmRemove.classList.add('prop-animation-delete');
 const removeActions=el('div',null,'prop-actions');removeActions.append(cancelRemove,confirmRemove);
 removeDialog.append(removeTitle,removeBody,removeActions);fine.append(el('summary','좌표 미세 조정'),placement);
 boardSide.append(el('h4','맵 배치'),field('보기 크기',zoom),boardNotice,overview);
  const presetTools=el('div',null,'prop-panel-heading');presetTools.append(el('h4','퍼즐 목록'),add);
 add.textContent='+';add.className='npc-one-stop-trigger';add.setAttribute('aria-label','퍼즐 추가');add.title='퍼즐 추가';
 sidebar.append(presetTools,field('추가할 퍼즐',puzzle),field('검색',search),list,inspector);
 inspector.append(inspectorTitle,bindingFields,fine,gates,actions,remove);inspector.hidden=true;
 shell.append(boardSide,sidebar);
 card.append(head,note,inputs);if(published){const buttons=el('div',null,'prop-actions');buttons.append(apply,playPublished);card.append(buttons);}
 card.append(shell,feedback,stage,removeDialog);detail.replaceChildren(card);
 let drafts,previous;try{drafts=JSON.parse(sessionStorage.getItem(draftKey)??'null');previous=JSON.parse(sessionStorage.getItem('ngs:well-rehearsal:v1:'+projectId)??'null');}catch{}
 if(!drafts||typeof drafts!=='object'||Array.isArray(drafts))drafts={};
 let map,run,generation=0,busy=false,instances=[],selected=null,removing=null;
 const overlays=new Map(),pins=new Map(),spriteViews=new Map(),artCache=new Map();let dragging=null;
 const lastMap=(()=>{try{return sessionStorage.getItem(stateKey+projectId+':active');}catch{return null;}})();
 mapSelect.append(option('','맵 선택'),...maps.map(x=>option(x.mapId,x.title)));
 if(published&&!maps.some(x=>x.mapId===published.map.mapId))mapSelect.append(option(published.map.mapId,'기존 게시 맵'));
 mapSelect.value=published?.map.mapId??(maps.some(x=>x.mapId===lastMap)?lastMap:maps[0]?.mapId??'');mapSelect.disabled=Boolean(published);
 const layout=()=>Object.fromEntries(Object.entries(positionInputs).filter(([k])=>applicable(selected,k)).map(([key,v])=>[key,{regionId:v.region.value,x:Number(v.x.value),y:Number(v.y.value)}]));
 const attachments=()=>Object.fromEntries(Object.entries(offsetInputs).filter(()=>!usesSpirit(selected)).map(([key,v])=>[key,{x:Number(v.x.value),y:Number(v.y.value)}]));
 const scale=()=>Object.fromEntries(Object.entries(scaleInputs).filter(([k])=>applicable(selected,k)).map(([key,v])=>[key,Number(v.value)]));
 const bindings=()=>Object.fromEntries(Object.entries(propInputs).filter(([k])=>applicable(selected,k)).map(([key,v])=>[key,v.value]));
 const setStatus=s=>{feedback.textContent=s;};
 async function latestMap(id){
  const {map:next}=await request(api('map',{item:id}));
  if(!validMapState(next)||next.mapId!==id)throw Error('MAP_INVALID');
  return next;
 }
 async function playInputs(id,loadMedia){
  const [latest,{backgrounds:art},entries]=await Promise.all([
   latestMap(id),request(api('background')),loadMedia,
  ]);
  if(!Array.isArray(art))throw Error('MAP_ART_MISSING');
  return {latest,art,media:Object.fromEntries(entries),decorArt:await loadDecor.load(latest.graph.decorations??[])};
 }

 function remember(){
  if(!map)return;
  drafts[map.mapId]=instances;
  try{
   sessionStorage.setItem(draftKey,JSON.stringify(drafts));
   sessionStorage.setItem(stateKey+projectId+':active',map.mapId);
  }catch{}
 }
 function snapshotSelected(){
  if(!selected)return;
  const next=layout(),offsets=attachments();
  if(Object.values(next).every(viewPoint))selected.layout=next;
  if(Object.values(offsets).every(offsetOk))selected.attachments=offsets;
  const values=bindings();
  for(const [role,id] of Object.entries(values))if(selected.pinned?.[role]?.propId!==id)delete selected.pinned?.[role];
  selected.bindings=values;
  const sizes=scale();if(Object.values(sizes).every(exactScale))selected.scale=sizes;
 }
 function newPreset(){
  const regions=map.graph.regions,shift=(instances.length%5)*5;
  if(puzzle.value===spiritDemoId)return {id:crypto.randomUUID(),type:spiritDemoId,layout:{spirit:{regionId:map.graph.startRegionId,x:55+shift,y:65}},attachments:{},bindings:{spirit:''}};
  return {id:crypto.randomUUID(),type:wellDemoId,
   layout:{altar:{regionId:regions.find(x=>x.id==='zone-2')?.id??regions[0].id,x:43+shift,y:70},
           well:{regionId:regions.find(x=>x.id==='zone-4')?.id??regions.at(-1).id,x:53+shift,y:70}},
   attachments:{bowl:{x:5,y:-10},lid:{x:5,y:-10}},bindings:Object.fromEntries(slots.map(([key])=>[key,'']))};
 }
 function presetName(preset){return (usesSpirit(preset)?spiritDemoTitle:wellDemoTitle)+' '+(instances.indexOf(preset)+1);}
 function showList(){
  const term=search.value.trim().normalize('NFC').toLocaleLowerCase();
  list.replaceChildren(...instances.filter(p=>presetName(p).normalize('NFC').toLocaleLowerCase().includes(term)).map(preset=>{
   const li=el('li'),label=control(presetName(preset)),count=Object.values(preset.bindings).filter(Boolean).length;
   label.dataset.preset=preset.id;label.setAttribute('aria-pressed',String(selected===preset&&!inspector.hidden));
   label.classList.add('request-item','npc-roster-entry');li.append(label,el('small',count+'/'+slotsFor(preset).length+' 연결','meta'));return li;
  }));
  if(term&&!list.children.length)list.append(el('li','검색 결과가 없습니다.','meta'));
 }
 search.addEventListener('input',showList,{signal});
 const gateLabel=edge=>edge?
  (map.graph.regions.find(r=>r.id===edge.from)?.name??edge.from)+' → '+(map.graph.regions.find(r=>r.id===edge.to)?.name??edge.to):'삭제된 이동 연결';
 function renderGates(){
  const edges=map?.graph.connections??[],prior=gateEdge.value;
  gateEdge.replaceChildren(option('','이동 연결 선택'),...edges.map(edge=>option(edge.id,gateLabel(edge)+' · '+edge.label)));
  if(edges.some(edge=>edge.id===prior))gateEdge.value=prior;
  const choices=selected?.portalConditions??[];
  const change=()=>{const current=choices.find(row=>row.portalId===gateEdge.value);
   if(current)gateState.value=current.requiredState;
   gateSet.textContent=current?'조건 수정':'조건 등록';
   gateSet.disabled=busy||!selected||!gateEdge.value||!current&&choices.length>=16;
  };
  gateEdge.onchange=change;change();
  gateList.replaceChildren(...choices.map(row=>{
   const li=el('li'),remove=control('조건 삭제'),edit=control(gateLabel(edges.find(e=>e.id===row.portalId)));
   li.append(edit,el('small',stateLabels[bowlStates.indexOf(row.requiredState)],'meta'),remove);
   edit.disabled=!edges.some(e=>e.id===row.portalId);remove.disabled=busy;
   edit.addEventListener('click',()=>{gateEdge.value=row.portalId;change();gateState.focus();},{signal});
   remove.addEventListener('click',()=>{
    if(!selected||busy)return;
    selected.portalConditions=(selected.portalConditions??[]).filter(c=>c.portalId!==row.portalId);
    stopPlay();remember();renderGates();
   },{signal});return li;
  }));
 }
 gateSet.addEventListener('click',()=>{
  if(!selected||busy||!map.graph.connections.some(e=>e.id===gateEdge.value))return;
  const entry={portalId:gateEdge.value,propRole:'bowl',requiredState:gateState.value};
  const next=[...(selected.portalConditions??[]).filter(row=>row.portalId!==entry.portalId),entry];
  if(!validPortalConditions(next))return;
  selected.portalConditions=next;stopPlay();remember();renderGates();
 },{signal});
 function selectPreset(preset,focusRole){
  if(!preset)return;
  if(selected!==preset){stopPlay();selected=preset;}
  inspector.hidden=false;inspectorTitle.textContent=presetName(preset)+' 수정';
  for(const [key,entry] of Object.entries(positionInputs)){
   positionGroups[key].hidden=!applicable(preset,key);if(positionGroups[key].hidden)continue;
   const point=preset.layout[key];entry.region.value=point.regionId;entry.x.value=point.x;entry.y.value=point.y;
  }
  for(const [key,entry] of Object.entries(offsetInputs)){
   offsetGroups[key].hidden=usesSpirit(preset);if(usesSpirit(preset))continue;
   entry.x.value=preset.attachments[key].x;entry.y.value=preset.attachments[key].y;
  }
  for(const [key,entry] of Object.entries(propInputs)){
   bindingGroups[key].hidden=!applicable(preset,key);if(bindingGroups[key].hidden)continue;
   const id=preset.bindings[key]??'';
   if(id&&!Array.from(entry.options).some(o=>o.value===id))entry.append(option(id,id+' (게시본 참조)'));
   entry.value=id;scaleInputs[key].value=scaleOf(preset.scale,key);
  }
  gates.hidden=usesSpirit(preset);
  for(const [role] of slotsFor(preset))showDimensions(preset,role);
  for(const pin of pins.values())pin.classList.toggle('active',pin.dataset.instance===preset.id);
  showList();if(!usesSpirit(preset))renderGates();refresh();if(focusRole)propInputs[focusRole].focus({preventScroll:true});
 }
 list.addEventListener('click',e=>{
  const id=e.target.closest('[data-preset]')?.dataset.preset;
  if(id)selectPreset(instances.find(x=>x.id===id));
 },{signal});
 add.addEventListener('click',()=>{
  if(!map||busy)return;
  if(instances.length>=16){setStatus('한 맵에는 테스트 퍼즐을 최대 16개까지 추가할 수 있어요.');return;}
  const preset=newPreset();instances.push(preset);renderPins();showList();remember();
  setStatus('빈 퍼즐을 추가했어요. 목록이나 맵의 프랍 자리를 눌러 수정하세요.');
 },{signal});
 remove.addEventListener('click',()=>{
  if(busy||!map||!selected||removeDialog.open)return;
  removing={mapId:map.mapId,preset:selected};
  removeBody.textContent='‘'+presetName(selected)+'’의 배치와 프랍 연결만 지워요. 원본 맵과 프랍은 그대로예요.';
  removeDialog.showModal();cancelRemove.focus();
 },{signal});
 cancelRemove.addEventListener('click',()=>removeDialog.close(),{signal});
 removeDialog.addEventListener('close',()=>{
  if(removing&&selected===removing.preset&&!inspector.hidden)remove.focus();
  removing=null;
 },{signal});
 confirmRemove.addEventListener('click',()=>{
  const target=removing;
  if(!target||busy||target.mapId!==map?.mapId||target.preset!==selected||!instances.includes(target.preset))return;
  const name=presetName(target.preset);
  stopPlay();cancelDrag();
  instances=instances.filter(preset=>preset!==target.preset);
  selected=null;removing=null;inspector.hidden=true;removeDialog.close();
  renderPins();showList();remember();refresh();add.focus();
  setStatus('‘'+name+'’의 조립 배치를 삭제했어요.');
 },{signal});
 function ready(){return map&&selected&&Object.values(bindings()).every(Boolean)&&Object.values(layout()).every(viewPoint)&&Object.values(attachments()).every(offsetOk)&&Object.values(scale()).every(exactScale);}
 function refresh(){play.disabled=Boolean(busy||!ready());add.disabled=busy||!map;remove.disabled=busy||!selected;
  apply.disabled=busy||!submit||!updateEnabled||!map;
  playPublished.disabled=busy||!map||!published?.puzzles.length;
 }
 function stopPlay(){run?.abort();run=null;stop.hidden=true;stage.replaceChildren();}
 function movePin(preset,role){
  const pin=pins.get(preset.id+':'+role);
  if(!pin)return;
  const parent=attachmentParent[role],point=preset.layout[parent??roleParent[role]],delta=parent?preset.attachments[role]:{x:0,y:0};
  if(!viewPoint(point)||!offsetOk(delta))return;
  const layer=overlays.get(point.regionId);
  const view=spriteViews.get(preset.id+':'+role);
  if(!layer){pin.remove();view?.img.remove();return;}
  if(view&&view.img.parentNode!==layer)layer.append(view.img);
  if(pin.parentNode!==layer)layer.append(pin);
  pin.style.left=(point.x+delta.x)+'%';pin.style.top=(point.y+delta.y)+'%';
  if(view)applyAssemblySpriteBox(view.img,assemblySpriteBox({role,layout:preset.layout,attachments:preset.attachments,
   scale:preset.scale,asset:view.asset,region:layer.assemblyRegion}));
 }
 function showDimensions(preset,role){
  if(selected!==preset)return;
  const view=spriteViews.get(preset.id+':'+role),asset=view?.asset,pct=scaleOf(preset.scale,role);
  retryArt[role].hidden=view?.state!=='error';
  sizeLabels[role].textContent=view?.state==='loading'?'이미지 불러오는 중…':view?.state==='error'?view.message:asset?
   '원래 '+asset.width+' × '+asset.height+' px · 배치 '+Math.round(asset.width*pct/100)+' × '+Math.round(asset.height*pct/100)+' px':
   '100% = 원래 픽셀 크기';
 }
 async function pinnedRead(pin){
  const out=await request(api('prop',{propId:pin.propId}));
  if(out.prop?.source?.revision!==pin.revision||out.prop?.source?.sha256!==pin.sha256)throw Error('ASSEMBLY_PROP_PIN_INACTIVE');
  return out;
 }
 function loadProp(preset,role,id){const pin=preset?.pinned?.[role];return published&&pin?.propId===id?pinnedRead(pin):request(api('prop',{propId:id}));}
 async function paintArt(preset,role){
  const key=preset.id+':'+role,pin=pins.get(key),id=preset.bindings[role];
  if(!pin)return;
  pin.classList.toggle('unbound',!id);
  const view=spriteViews.get(key),img=view.img,token=Symbol();
  const current=()=>!signal.aborted&&spriteViews.get(key)===view&&view.token===token&&preset.bindings[role]===id;
  view.token=token;view.asset=null;view.state=id?'loading':'empty';
  img.hidden=true;img.removeAttribute('src');showDimensions(preset,role);
  if(!id)return;
  const row=preset.pinned?.[role]??props.find(p=>p.propId===id);
  const requestKey=row?id+':'+row.revision+':'+row.sha256:null;
  let job;
  try{
   if(!row)throw Error('ASSEMBLY_PROP_PIN_INACTIVE');
   job=artCache.get(requestKey);
   if(!job){
    job=loadProp(preset,role,id).then(({prop})=>{
     if(prop?.propId!==id||prop.source?.revision!==row.revision||prop.source?.sha256!==row.sha256)
      throw Error('ASSEMBLY_PROP_PIN_INACTIVE');
     const pixel=role==='spirit'?prop.media?.spirit:prop.media?.pixel;
     if(role==='spirit'&&!decorationArt(prop,{propId:id,revision:row.revision,sha256:row.sha256})?.pixel)throw Error('PROP_ART_MISSING_OR_STALE');
     if(pixel?.mediaType!=='image/png'||!imageSize(pixel)||!safeMedia(pixel.url))throw Error('PROP_ART_MISSING_OR_STALE');
     return pixel;
    });
    artCache.set(requestKey,job);
   }
   const src=await job;
   if(!current())return;
   img.src=src.url;
   // A valid manifest does not prove that the actual PNG loaded.
   await img.decode();
   if(!current())return;
   view.asset=src;view.state='ready';movePin(preset,role);showDimensions(preset,role);
  }catch(err){
   if(!current())return;
   if(job&&artCache.get(requestKey)===job)artCache.delete(requestKey);
   img.removeAttribute('src');view.state='error';
   view.message=err.message==='ASSEMBLY_PROP_PIN_INACTIVE'
    ?'연결한 프랍 버전을 읽을 수 없어요. 새로고침 후 현재 프랍을 다시 선택해 주세요.'
    :'프랍 이미지를 읽지 못했어요. 다시 불러오거나 다른 프랍을 선택해 주세요.';
   showDimensions(preset,role);
  }
 }
 function renderBoard(){
  cancelDrag();
  overlays.clear();pins.clear();overview.replaceChildren();
  if(!map)return;
  overview.classList.toggle('zoomed',Boolean(zoom.value));
  for(const region of mapRehearsalRegions(map,backgrounds).filter(r=>!zoom.value||r.id===zoom.value)){
   const tile=el('section',null,'well-assembly-region');
   const image=el('img',null,'well-assembly-map-art'),layer=el('div',null,'well-assembly-layer');
   image.src=region.src;image.alt='';image.draggable=false;image.loading='lazy';
   layer.style.aspectRatio=String(region.width/region.height);layer.dataset.regionId=region.id;layer.assemblyRegion=region;
   const caption=el('header',null,'well-assembly-region-heading'),zoomButton=control(zoom.value?'전체 보기':'크게 보기');
   zoomButton.setAttribute('aria-label',zoom.value?'전체 구역 보기':region.name+' 크게 보기');
   zoomButton.addEventListener('click',()=>{zoom.value=zoom.value?'':region.id;renderBoard();zoom.focus({preventScroll:true});},{once:true});
   caption.append(el('h5',region.name),zoomButton);
   layer.append(image);tile.append(caption,layer);overview.append(tile);overlays.set(region.id,layer);
  }
  renderPins();
 }
 function renderPins(){
  for(const pin of pins.values())pin.remove();pins.clear();for(const view of spriteViews.values())view.img.remove();spriteViews.clear();
  for(const preset of instances)for(const [role,title] of slotsFor(preset)){
   const pin=control('');pin.className='well-assembly-pin';pin.dataset.role=role;pin.dataset.instance=preset.id;
   pin.classList.toggle('active',selected===preset);pin.classList.toggle('unbound',!preset.bindings[role]);
   pin.setAttribute('aria-label',presetName(preset)+' · '+title+' 위치 조정');pin.title=pin.getAttribute('aria-label');
   const img=el('img',null,'well-assembly-sprite');img.dataset.role=role;img.dataset.instance=preset.id;img.hidden=true;img.alt='';img.draggable=false;
   const tag=el('span',(instances.indexOf(preset)+1)+' '+title);
   pin.append(tag);pins.set(preset.id+':'+role,pin);spriteViews.set(preset.id+':'+role,{img,asset:null});movePin(preset,role);void paintArt(preset,role);
  }
 }
 function hit(e){
  const layer=document.elementFromPoint(e.clientX,e.clientY)?.closest('.well-assembly-layer');
  return layer&&overview.contains(layer)?layer:null;
 }
 function setGhost(e){
  dragging.ghost.style.left=e.clientX+'px';dragging.ghost.style.top=e.clientY+'px';
  const layer=hit(e);overview.querySelector('.drop-target')?.classList.remove('drop-target');
  const parent=attachmentParent[dragging.role];
  if(layer&&(!parent||dragging.preset.layout[parent].regionId===layer.dataset.regionId))layer.classList.add('drop-target');
 }
 function cancelDrag(){
  if(!dragging)return;
  const d=dragging;dragging=null;
  d.ghost.remove();overview.querySelector('.drop-target')?.classList.remove('drop-target');
  if(overview.hasPointerCapture(d.id))overview.releasePointerCapture(d.id);
 }
 overview.addEventListener('pointerdown',e=>{
  const pin=e.target.closest('.well-assembly-pin');
  if(!pin||!e.isPrimary||e.button!==0||dragging)return;
  const preset=instances.find(x=>x.id===pin.dataset.instance);if(!preset)return;
  e.preventDefault();pin.focus();
  const ghost=el('span',roleTitle(pin.dataset.role),'well-assembly-ghost');
  overview.append(ghost);dragging={id:e.pointerId,role:pin.dataset.role,preset,ghost,x:e.clientX,y:e.clientY};
  overview.setPointerCapture(e.pointerId);setGhost(e);
 },{signal});
 overview.addEventListener('pointermove',e=>{if(dragging?.id===e.pointerId)setGhost(e);},{signal});
 overview.addEventListener('pointerup',e=>{
  if(dragging?.id!==e.pointerId)return;
  const {role,preset,x,y}=dragging,target=hit(e),click=Math.hypot(e.clientX-x,e.clientY-y)<5;
  const result=!click&&target&&dragWellPlacement({role,regionId:target.dataset.regionId,clientX:e.clientX,clientY:e.clientY,rect:target.getBoundingClientRect(),layout:preset.layout,attachments:preset.attachments});
  cancelDrag();
  if(click){selectPreset(preset,role);return;}
  if(!result){
   if(target&&attachmentParent[role])setStatus('그릇과 뚜껑은 연결된 프랍과 같은 구역에서 조정할 수 있어요.');
   return;
  }
  preset.layout=result.layout;preset.attachments=result.attachments;
  stopPlay();for(const [key] of slotsFor(preset))movePin(preset,key);selectPreset(preset);remember();setStatus(roleTitle(role)+' 위치를 바꿨어요.');
 },{signal});
 for(const type of ['pointercancel','lostpointercapture'])overview.addEventListener(type,e=>{if(dragging?.id===e.pointerId)cancelDrag();},{signal});
  overview.addEventListener('keydown',e=>{
  if(e.key==='Escape')cancelDrag();
  const pin=e.target.closest('.well-assembly-pin');
  if(pin&&(e.key==='Enter'||e.key===' ')){e.preventDefault();selectPreset(instances.find(x=>x.id===pin.dataset.instance),pin.dataset.role);}
 },{signal});

 async function readMap(){
  stopPlay();const ticket=++generation;busy=true;map=null;instances=[];selected=null;inspector.hidden=true;renderBoard();showList();refresh();
  try{
   if(!mapSelect.value){setStatus('게시된 맵을 선택하세요.');return;}
   setStatus('맵 구역을 읽고 있어요.');
   const next=await latestMap(mapSelect.value);
   if(signal.aborted||ticket!==generation)return;
   map=next;
   const targets=map.graph.regions;
   zoom.replaceChildren(option('','전체 구역'),...targets.map(x=>option(x.id,x.name)));
   for(const entry of Object.values(positionInputs))entry.region.replaceChildren(...targets.map(x=>option(x.id,x.name)));
   let saved=drafts[map.mapId];
   if(!saved&&published)saved=published.puzzles.map(p=>({...structuredClone(p),pinned:p.bindings,bindings:Object.fromEntries(Object.entries(p.bindings).map(([role,pin])=>[role,pin.propId]))}));
   if(!saved&&previous?.mapId===map.mapId&&previous.layout&&previous.bindings)
    saved=[{id:crypto.randomUUID(),type:wellDemoId,layout:previous.layout,bindings:previous.bindings,
      attachments:previous.attachments??{bowl:{x:5,y:-10},lid:{x:5,y:-10}}}];
   if(Array.isArray(saved)){
    instances=saved.slice(0,16).filter(p=>typeof p?.id==='string'&&[wellDemoId,spiritDemoId].includes(p.type)&&
     (usesSpirit(p)?['spirit']:['altar','well']).every(k=>viewPoint(p.layout?.[k])&&targets.some(r=>r.id===p.layout[k].regionId))&&
     (usesSpirit(p)||['bowl','lid'].every(k=>offsetOk(p.attachments?.[k])))&&p.bindings&&typeof p.bindings==='object');
    for(const preset of instances)for(const [role] of slotsFor(preset))if(!preset.pinned?.[role]&&!props.some(row=>row.propId===preset.bindings[role]))preset.bindings[role]='';
   }
   renderBoard();showList();remember();setStatus(instances.length?'목록이나 맵의 프랍 자리를 눌러 수정하세요.':'퍼즐을 추가하면 필요한 빈 프랍 자리가 맵에 표시돼요.');
  }catch{if(!signal.aborted&&ticket===generation)setStatus('선택한 맵을 읽지 못했어요.');}
  finally{if(!signal.aborted&&ticket===generation){busy=false;refresh();}}
 }
 zoom.addEventListener('change',()=>{renderBoard();boardNotice.textContent=markMode()==='상세 배치'?'확대 보기 · 놓을 위치로 프랍을 드래그하세요.':'전체 구역 · 제상과 우물을 다른 구역으로도 옮길 수 있어요.';},{signal});
 mapSelect.addEventListener('change',()=>void readMap(),{signal});
 for(const input of [...Object.values(propInputs),...[...Object.values(positionInputs),...Object.values(offsetInputs)].flatMap(x=>Object.values(x))])
  input.addEventListener('change',()=>{if(run){stopPlay();setStatus('연결이 바뀌었어요. 다시 테스트 플레이를 누르세요.');}snapshotSelected();if(selected)for(const [role] of slotsFor(selected))movePin(selected,role);showList();remember();refresh();},{signal});
 for(const [role,input] of Object.entries(scaleInputs))input.addEventListener('input',()=>{
  if(!selected||!applicable(selected,role)||!exactScale(Number(input.value))){refresh();return;}
  selected.scale={...Object.fromEntries(slotsFor(selected).map(([k])=>[k,scaleOf(selected.scale,k)])),[role]:Number(input.value)};
  movePin(selected,role);showDimensions(selected,role);if(run)stopPlay();remember();refresh();
 },{signal});
 for(const [role,input] of Object.entries(propInputs))input.addEventListener('change',()=>{if(selected)void paintArt(selected,role);},{signal});
 stop.addEventListener('click',()=>{stopPlay();setStatus('테스트를 종료했어요. 연결 값은 그대로예요.');play.focus();},{signal});
 play.addEventListener('click',async()=>{
  if(!ready()||busy)return;
  const which=map, instance=selected, coords=layout(), offsets=attachments(), sizes=scale(), chosen=bindings(), ticket=++generation;
  stopPlay();busy=true;refresh();setStatus('연결한 프랍과 맵 이미지를 확인하고 있어요.');
  try{
   const {latest,art,media,decorArt}=await playInputs(which.mapId,Promise.all(
    Object.entries(chosen).map(async([role,id])=>[role,(await loadProp(instance,role,id)).prop])));
   if(signal.aborted||ticket!==generation)return;
   if(selected!==instance||JSON.stringify(chosen)!==JSON.stringify(bindings())||JSON.stringify(coords)!==JSON.stringify(layout())||JSON.stringify(offsets)!==JSON.stringify(attachments())||JSON.stringify(sizes)!==JSON.stringify(scale())){setStatus('연결이 바뀌었어요. 다시 테스트 플레이를 누르세요.');return;}
   if(usesSpirit(instance)){
    const pin=instance.pinned?.spirit??props.find(p=>p.propId===chosen.spirit);
    const config=buildSpiritRehearsal(latest,art,coords.spirit,sizes.spirit,media.spirit,pin,decorArt);
    run=new AbortController();mountSpiritManifestation(stage,{signal:run.signal,rehearsal:config});stop.hidden=false;
    setStatus('영물 현현 테스트 중이에요.');return;
   }
   const rehearsal=buildWellRehearsal({map:latest,backgrounds:art,props,layout:coords,attachments:offsets,scale:sizes,bindings:chosen,media,pins:instance.pinned,portalConditions:instance.portalConditions});
   rehearsal.decorArt=decorArt;rehearsal.makeRuntime=await prepareWellPuzzle(instance.definition);if(signal.aborted||ticket!==generation)return;
   run=new AbortController();mountWellPuzzleDemo(stage,{signal:run.signal,rehearsal});stop.hidden=false;
   setStatus('테스트 중이에요. WASD로 움직이고, 표시된 포털 영역에 걸어 들어가면 이동해요.');
   stage.querySelector('.well-demo-scene')?.focus();
  }catch{if(!signal.aborted&&ticket===generation)setStatus('맵 이미지나 선택한 프랍 버전을 읽지 못했어요. 새로고침 후 다시 연결해 주세요.');}
  finally{if(!signal.aborted&&ticket===generation){busy=false;refresh();}}
 },{signal});
 let lastApply;
 apply.addEventListener('click',async()=>{
  if(!published||!submit||!updateEnabled||busy||!map)return;
  if(selected&&(!Object.values(layout()).every(viewPoint)||!Object.values(attachments()).every(offsetOk)||!Object.values(scale()).every(exactScale))){setStatus('선택한 퍼즐의 좌표 범위를 확인하세요.');return;}
  snapshotSelected();
  const puzzles=instances.map(p=>({id:p.id,type:p.type,layout:p.layout,attachments:p.attachments,...(p.scale?{scale:p.scale}:{}),
   ...(p.definition?{definition:p.definition}:{}),
   ...(p.portalConditions?.length?{portalConditions:p.portalConditions}:{}),
   bindings:Object.fromEntries(slotsFor(p).map(([role])=>{
    const row=p.pinned?.[role]??props.find(x=>x.propId===p.bindings[role]);
    return [role,row?{propId:row.propId,revision:row.revision,sha256:row.sha256}:null];
   }))}));
  const payload={schemaVersion:fileUpdateSchema,projectId,target:{root:assemblyUpdateRoot,path:published.assemblyId,kind:'metadata'},
   expected:{revision:published.revision,officialRequestId:published.officialRequestId},
   content:{title:published.title,mapId:published.map.mapId,puzzles}};
  if(!validFileUpdate(payload)){setStatus('모든 퍼즐의 필수 프랍 연결과 좌표를 확인하세요.');return;}
  const fingerprint=JSON.stringify(payload);
  if(!lastApply||lastApply.body!==fingerprint)lastApply={body:fingerprint,key:crypto.randomUUID()};
  busy=true;refresh();
  try{
   const current=await latestMap(map.mapId);
   if(signal.aborted)return;
   if(!assemblyReachable(current.graph,puzzles)){
    setStatus('최신 맵에서 퍼즐 위치에 도달할 수 없어요. 영물까지의 연결과 제상·우물 왕복 경로를 확인해 주세요.');return;
   }
   const res=await submit({requestType:fileUpdateType,idempotencyKey:lastApply.key,payload}),value=await res.json().catch(()=>null);
   if(!isQueuedRequest(res,value)){setStatus(assemblyApplyFailure(value?.error,res.status));return;}
   setStatus('정식 수정 요청을 접수했어요. 게시가 끝나면 이 조립본을 다시 열어 새 리비전을 확인하세요.');
  }catch(e){if(!signal.aborted)setStatus(assemblyApplyFailure(e?.message,e?.status));}
  finally{if(!signal.aborted){busy=false;refresh();}}
 },{signal});
 playPublished.addEventListener('click',async()=>{
  if(!published||busy||!map)return;
  stopPlay();busy=true;refresh();
  try{
   const selectedId=selected?.id,ordinary=published.puzzles.filter(p=>!usesSpirit(p)),reveals=published.puzzles.filter(usesSpirit);
   const original=ordinary.find(p=>p.id===selectedId)??ordinary[0];
   if(!original&&!reveals.length)return;
   const {latest,art,media,decorArt}=await playInputs(published.map.mapId,Promise.all(
    Object.entries(original?.bindings??{}).map(async([role,pin])=>[role,(await pinnedRead(pin)).prop])));
   if(signal.aborted)return;
   const revealConfigs=await Promise.all(reveals.map(async puzzle=>{
    const pin=puzzle.bindings.spirit,{prop}=await pinnedRead(pin);
    const config=buildSpiritRehearsal(latest,art,puzzle.layout.spirit,puzzle.scale?.spirit??100,prop,pin,decorArt);
    return {...config,id:puzzle.id,onReveal:change=>{
     detail.dispatchEvent(new CustomEvent('ngs:prop-changed',{bubbles:true,detail:{type:'prop.changed',assemblyId:published.assemblyId,
      presetId:puzzle.id,asset:pin,role:'spirit',regionId:puzzle.layout.spirit.regionId,...change}}));
     detail.dispatchEvent(new CustomEvent('ngs:puzzle-completed',{bubbles:true,detail:{type:'puzzle.completed',
      assemblyId:published.assemblyId,presetId:puzzle.id,puzzleType:puzzle.type}}));
    }};
   }));
   if(signal.aborted)return;
   if(!original){
    const config={...revealConfigs[0],manifestations:revealConfigs};
    run=new AbortController();mountSpiritManifestation(stage,{signal:run.signal,rehearsal:config});stop.hidden=false;
    setStatus('게시 리비전 '+published.revision+'로 플레이 중이에요.');return;
   }
   const config=buildWellRehearsal({map:latest,backgrounds:art,props,layout:original.layout,attachments:original.attachments,scale:original.scale,bindings:Object.fromEntries(Object.entries(original.bindings).map(([k,v])=>[k,v.propId])),pins:original.bindings,media,portalConditions:original.portalConditions});
   config.manifestations=revealConfigs;config.makeRuntime=await prepareWellPuzzle(original.definition);if(signal.aborted)return;
   config.decorArt=decorArt;config.formal=true;config.onPropChanged=change=>{
    const event={type:'prop.changed',assemblyId:published.assemblyId,presetId:original.id,asset:original.bindings[change.role],...change};
    detail.dispatchEvent(new CustomEvent('ngs:prop-changed',{detail:event,bubbles:true}));
   };
   config.onCompleted=()=>{
    const event={type:'puzzle.completed',assemblyId:published.assemblyId,presetId:original.id,puzzleType:original.type};
    detail.dispatchEvent(new CustomEvent('ngs:puzzle-completed',{detail:event,bubbles:true}));
   };
   run=new AbortController();mountWellPuzzleDemo(stage,{signal:run.signal,rehearsal:config});stop.hidden=false;
   setStatus('게시 리비전 '+published.revision+'로 플레이 중이에요.');
   stage.querySelector('.well-demo-scene')?.focus();
  }catch(e){if(!signal.aborted)setStatus(e.message==='ASSEMBLY_PROP_PIN_INACTIVE'?'연결된 프랍의 게시 버전이 바뀌었어요. 현재 버전을 다시 연결하고 적용해 주세요.':e.message.includes('PUZZLE_CSHARP')?'공용 C# 코어를 불러올 수 없는 환경이라 이 검증 퍼즐을 실행하지 않았어요.':'게시본의 맵과 프랍을 읽지 못했어요.');}
  finally{if(!signal.aborted){busy=false;refresh();}}
 },{signal});
 signal.addEventListener('abort',()=>{if(removeDialog.open)removeDialog.close();cancelDrag();stopPlay();},{once:true});
 await readMap();
}
