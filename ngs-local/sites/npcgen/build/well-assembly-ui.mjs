import {assemblyReachable,validAssemblyRequest} from './assembly-contract.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
import {validMapState} from './map-contract.mjs';
import {wellDemoId,wellDemoTitle,wellAssemblySlots,mountWellPuzzleDemo} from './well-puzzle-demo.mjs';

const slots=Object.entries(wellAssemblySlots);
const suggestions={table:/^ritual-seal-altar-/,bowl:/(?:water-bowl|ritual-seal-ash-catcher-)/,well:/^ritual-seal-well-v/,lid:/^ritual-seal-well-cover-/};
const el=(tag,value,cls)=>{const n=document.createElement(tag);if(value)n.textContent=value;if(cls)n.className=cls;return n;};
const field=(title,input)=>{const row=el('label',title,'prop-form-field');row.append(input);return row;};
const option=(id,title)=>{const n=el('option',title);n.value=id;return n;};
const control=title=>{const n=el('button',title,'prop-control');n.type='button';return n;};
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const safeMedia=url=>typeof url==='string'&&['/api/prop-workspace?','/api/assembly-prop?'].some(p=>url.startsWith(p));
const viewPoint=p=>['x','y'].every(axis=>Number.isInteger(p?.[axis])&&p[axis]>=10&&p[axis]<=90);
const stateKey='ngs:map-rehearsal:v2:';

const attachmentParent={bowl:'altar',lid:'well'};
const roleParent={table:'altar',well:'well'};
const clamp=(n,min,max)=>Math.min(max,Math.max(min,Math.round(n)));
const offsetOk=p=>['x','y'].every(k=>Number.isInteger(p?.[k])&&Math.abs(p[k])<=12);

function mapRehearsalRegions(map,backgrounds){
 const byBackground=new Map(backgrounds.map(x=>[x.backgroundId,x]));
 return map.graph.regions.map(region=>{
  const asset=byBackground.get(region.backgroundId);
  const lane=[asset,asset?.pixel,asset?.cinematic].find(p=>p?.sha256===region.imageSha256);
  if(!lane||!sha(lane.sha256)||!(lane.width>0&&lane.height>0))throw Error('MAP_ART_MISSING');
  return {id:region.id,name:region.name,width:lane.width,height:lane.height,src:'/api/background-workspace?projectId=binari&image='+lane.sha256};
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

export function buildWellRehearsal({map,backgrounds,props,layout,attachments,bindings,media,pins}){
 if(!validMapState(map))throw Error('MAP_INVALID');
 if(!['altar','well'].every(key=>viewPoint(layout[key])&&map.graph.regions.some(x=>x.id===layout[key].regionId)))throw Error('PLACEMENT_INVALID');
 if(attachments&&!['bowl','lid'].every(key=>offsetOk(attachments[key])))throw Error('ATTACHMENT_INVALID');
 const regions=mapRehearsalRegions(map,backgrounds);
 const art={};
 for(const [role] of slots){
  const row=pins?.[role]??props.find(p=>p.propId===bindings[role]), result=media[role];
  if(!row||!result||result.propId!==row.propId||result.source?.revision!==row.revision||
    result.source?.sha256!==row.sha256||!safeMedia(result.media?.pixel?.url)||result.media.pixel.mediaType!=='image/png')
   throw Error('PROP_ART_MISSING_OR_STALE');
  art[role]=result.media.pixel.url;
 }
 return {initialRegion:map.graph.startRegionId,regions,connections:map.graph.connections,positions:layout,attachments,art};
}

export async function mountWellAssembly({items,detail,request,projectId,signal,published,submit}){
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
 puzzle.append(option(wellDemoId,wellDemoTitle));
 const inputs=el('div',null,'well-assembly-grid');inputs.append(field('맵',mapSelect));
 const positionInputs={},propInputs={},offsetInputs={};
 const placement=el('div',null,'well-assembly-grid');
 const bindingFields=el('div',null,'well-assembly-grid');
 for(const [role,label] of slots){
  const pattern=suggestions[role];
  const select=el('select');select.append(option('','프랍 선택'));
  const candidates=props.filter(row=>pattern.test(row.propId));
  const other=props.filter(row=>!pattern.test(row.propId));
  for(const row of [...candidates,...other]){
   const alias=role==='bowl'&&row.propId.startsWith('ritual-seal-ash-catcher-')?' (물그릇 임시 대역)':'';
   select.append(option(row.propId,row.title+alias));
  }
  select.value='';
  propInputs[role]=select;bindingFields.append(field(label,select));
 }
 for(const [key,title] of [['altar','제상 위치 · 그릇 자리 포함'],['well','우물 위치 · 뚜껑 포함']]){
  const group=el('fieldset'),legend=el('legend',title),region=el('select'),coords=el('div',null,'well-assembly-grid');
  const number=()=>{const n=el('input');n.type='number';n.required=true;n.min='10';n.max='90';n.step='1';return n;};
  const x=number(),y=number();group.append(legend,field('구역',region),coords);coords.append(field('가로 위치 (%)',x),field('세로 위치 (%)',y));
  positionInputs[key]={region,x,y};placement.append(group);
 }
 for(const [key,title] of [['bowl','물그릇 위치 · 제상 기준'],['lid','뚜껑 위치 · 우물 기준']]){
  const group=el('fieldset'),coords=el('div',null,'well-assembly-grid');
  const number=()=>{const n=el('input');n.type='number';n.required=true;n.min='-12';n.max='12';n.step='1';return n;};
  const x=number(),y=number();group.append(el('legend',title),coords);
  coords.append(field('가로 오프셋 (%)',x),field('세로 오프셋 (%)',y));offsetInputs[key]={x,y};placement.append(group);
 }
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
 inspector.append(inspectorTitle,bindingFields,fine,actions,remove);inspector.hidden=true;
 shell.append(boardSide,sidebar);
 card.append(head,note,inputs);if(published){const buttons=el('div',null,'prop-actions');buttons.append(apply,playPublished);card.append(buttons);}
 card.append(shell,feedback,stage,removeDialog);detail.replaceChildren(card);
 let drafts,previous;try{drafts=JSON.parse(sessionStorage.getItem(draftKey)??'null');previous=JSON.parse(sessionStorage.getItem('ngs:well-rehearsal:v1:'+projectId)??'null');}catch{}
 if(!drafts||typeof drafts!=='object'||Array.isArray(drafts))drafts={};
 let map,run,generation=0,busy=false,instances=[],selected=null,removing=null;
 const overlays=new Map(),pins=new Map(),artCache=new Map();let dragging=null;
 const lastMap=(()=>{try{return sessionStorage.getItem(stateKey+projectId+':active');}catch{return null;}})();
 mapSelect.append(option('','맵 선택'),...maps.map(x=>option(x.mapId,x.title)));
 if(published&&!maps.some(x=>x.mapId===published.map.mapId))mapSelect.append(option(published.map.mapId,'기존 게시 맵'));
 mapSelect.value=published?.map.mapId??(maps.some(x=>x.mapId===lastMap)?lastMap:maps[0]?.mapId??'');mapSelect.disabled=Boolean(published);
 const layout=()=>Object.fromEntries(Object.entries(positionInputs).map(([key,v])=>[key,{regionId:v.region.value,x:Number(v.x.value),y:Number(v.y.value)}]));
 const attachments=()=>Object.fromEntries(Object.entries(offsetInputs).map(([key,v])=>[key,{x:Number(v.x.value),y:Number(v.y.value)}]));
 const bindings=()=>Object.fromEntries(Object.entries(propInputs).map(([key,v])=>[key,v.value]));
 const setStatus=s=>{feedback.textContent=s;};
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
 }
 function newPreset(){
  const regions=map.graph.regions,shift=(instances.length%5)*5;
  return {id:crypto.randomUUID(),type:wellDemoId,
   layout:{altar:{regionId:regions.find(x=>x.id==='zone-2')?.id??regions[0].id,x:43+shift,y:70},
           well:{regionId:regions.find(x=>x.id==='zone-4')?.id??regions.at(-1).id,x:53+shift,y:70}},
   attachments:{bowl:{x:5,y:-10},lid:{x:5,y:-10}},bindings:Object.fromEntries(slots.map(([key])=>[key,'']))};
 }
 function presetName(preset){return wellDemoTitle+' '+(instances.indexOf(preset)+1);}
 function showList(){
  const term=search.value.trim().normalize('NFC').toLocaleLowerCase();
  list.replaceChildren(...instances.filter(p=>presetName(p).normalize('NFC').toLocaleLowerCase().includes(term)).map(preset=>{
   const li=el('li'),label=control(presetName(preset)),count=Object.values(preset.bindings).filter(Boolean).length;
   label.dataset.preset=preset.id;label.setAttribute('aria-pressed',String(selected===preset&&!inspector.hidden));
   label.classList.add('request-item','npc-roster-entry');li.append(label,el('small',count+'/'+slots.length+' 연결','meta'));return li;
  }));
  if(term&&!list.children.length)list.append(el('li','검색 결과가 없습니다.','meta'));
 }
 search.addEventListener('input',showList,{signal});
 function selectPreset(preset,focusRole){
  if(!preset)return;
  if(selected!==preset){stopPlay();selected=preset;}
  inspector.hidden=false;inspectorTitle.textContent=presetName(preset)+' 수정';
  for(const [key,entry] of Object.entries(positionInputs)){
   const point=preset.layout[key];entry.region.value=point.regionId;entry.x.value=point.x;entry.y.value=point.y;
  }
  for(const [key,entry] of Object.entries(offsetInputs)){
   entry.x.value=preset.attachments[key].x;entry.y.value=preset.attachments[key].y;
  }
  for(const [key,entry] of Object.entries(propInputs)){
   const id=preset.bindings[key]??'';
   if(id&&!Array.from(entry.options).some(o=>o.value===id))entry.append(option(id,id+' (게시본 참조)'));
   entry.value=id;
  }
  for(const pin of pins.values())pin.classList.toggle('active',pin.dataset.instance===preset.id);
  showList();refresh();if(focusRole)propInputs[focusRole].focus({preventScroll:true});
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
 function ready(){return map&&selected&&Object.values(bindings()).every(Boolean)&&Object.values(layout()).every(viewPoint)&&Object.values(attachments()).every(offsetOk);}
 function refresh(){play.disabled=Boolean(busy||!ready());add.disabled=busy||!map;remove.disabled=busy||!selected;
  apply.disabled=busy||!submit||!map;
  playPublished.disabled=busy||!map||!published?.puzzles.length;
 }
 function stopPlay(){run?.abort();run=null;stop.hidden=true;stage.replaceChildren();}
 function movePin(preset,role){
  const pin=pins.get(preset.id+':'+role);
  if(!pin)return;
  const parent=attachmentParent[role],point=preset.layout[parent??roleParent[role]],delta=parent?preset.attachments[role]:{x:0,y:0};
  if(!viewPoint(point)||!offsetOk(delta))return;
  const layer=overlays.get(point.regionId);
  if(!layer)return;
  if(pin.parentNode!==layer)layer.append(pin);
  pin.style.left=(point.x+delta.x)+'%';pin.style.top=(point.y+delta.y)+'%';
 }
 function pinnedRead(pin){return request('/api/assembly-prop?'+new URLSearchParams({projectId,assemblyId:published.assemblyId,propId:pin.propId,revision:pin.revision,sha256:pin.sha256}));}
 function loadProp(preset,role,id){const pin=preset?.pinned?.[role];return published&&pin?.propId===id?pinnedRead(pin):request(api('prop',{propId:id}));}
 async function paintArt(preset,role){
  const key=preset.id+':'+role,pin=pins.get(key),id=preset.bindings[role];
  if(!pin)return;
  pin.classList.toggle('unbound',!id);
  const img=pin.querySelector('img');
  img.removeAttribute('src');img.hidden=true;
  if(!id)return;
  const row=preset.pinned?.[role]??props.find(p=>p.propId===id);
  if(!row)return;
  const requestKey=id+':'+row.revision+':'+row.sha256;
  if(!artCache.has(requestKey)){
   const job=loadProp(preset,role,id).then(({prop})=>prop?.source?.revision===row.revision&&prop?.source?.sha256===row.sha256&&
    prop.media?.pixel?.mediaType==='image/png'&&safeMedia(prop.media.pixel.url)?prop.media.pixel.url:null).catch(()=>null);
   artCache.set(requestKey,job);
  }
  const src=await artCache.get(requestKey);
  if(!src){artCache.delete(requestKey);return;}
  if(!signal.aborted&&pins.get(key)===pin&&preset.bindings[role]===id){img.src=src;img.hidden=false;}
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
   layer.style.aspectRatio=String(region.width/region.height);layer.dataset.regionId=region.id;
   layer.append(image);tile.append(el('h5',region.name),layer);overview.append(tile);overlays.set(region.id,layer);
  }
  renderPins();
 }
 function renderPins(){
  for(const pin of pins.values())pin.remove();pins.clear();
  for(const preset of instances)for(const [role,title] of slots){
   const pin=control('');pin.className='well-assembly-pin';pin.dataset.role=role;pin.dataset.instance=preset.id;
   pin.classList.toggle('active',selected===preset);pin.classList.toggle('unbound',!preset.bindings[role]);
   pin.setAttribute('aria-label',presetName(preset)+' · '+title+' 위치 조정');pin.title=pin.getAttribute('aria-label');
   const img=el('img');img.hidden=true;img.alt='';img.draggable=false;
   const tag=el('span',(instances.indexOf(preset)+1)+' '+title);
   pin.append(img,tag);pins.set(preset.id+':'+role,pin);movePin(preset,role);void paintArt(preset,role);
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
  const ghost=el('span',wellAssemblySlots[pin.dataset.role],'well-assembly-ghost');
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
  stopPlay();for(const [key] of slots)movePin(preset,key);selectPreset(preset);remember();setStatus(wellAssemblySlots[role]+' 위치를 바꿨어요.');
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
   const {map:next}=await request(api('map',{item:mapSelect.value,...(published?{revision:published.map.revision}:{})}));
   if(signal.aborted||ticket!==generation)return;
   if(!validMapState(next)||published&&next.officialRequestId!==published.map.officialRequestId)throw Error('MAP_INVALID');
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
    instances=saved.slice(0,16).filter(p=>typeof p?.id==='string'&&p.type===wellDemoId&&['altar','well'].every(k=>viewPoint(p.layout?.[k])&&targets.some(r=>r.id===p.layout[k].regionId))&&
     ['bowl','lid'].every(k=>offsetOk(p.attachments?.[k]))&&p.bindings&&typeof p.bindings==='object');
    for(const preset of instances)for(const [role] of slots)if(!preset.pinned?.[role]&&!props.some(row=>row.propId===preset.bindings[role]))preset.bindings[role]='';
   }
   renderBoard();showList();remember();setStatus(instances.length?'목록이나 맵의 프랍 자리를 눌러 수정하세요.':'퍼즐을 추가하면 필요한 빈 프랍 자리가 맵에 표시돼요.');
  }catch{if(!signal.aborted&&ticket===generation)setStatus('선택한 맵을 읽지 못했어요.');}
  finally{if(!signal.aborted&&ticket===generation){busy=false;refresh();}}
 }
 zoom.addEventListener('change',()=>{renderBoard();boardNotice.textContent=markMode()==='상세 배치'?'확대 보기 · 놓을 위치로 프랍을 드래그하세요.':'전체 구역 · 제상과 우물을 다른 구역으로도 옮길 수 있어요.';},{signal});
 mapSelect.addEventListener('change',()=>void readMap(),{signal});
 for(const input of [...Object.values(propInputs),...[...Object.values(positionInputs),...Object.values(offsetInputs)].flatMap(x=>Object.values(x))])
  input.addEventListener('change',()=>{if(run){stopPlay();setStatus('연결이 바뀌었어요. 다시 테스트 플레이를 누르세요.');}snapshotSelected();if(selected)for(const [role] of slots)movePin(selected,role);showList();remember();refresh();},{signal});
 for(const [role,input] of Object.entries(propInputs))input.addEventListener('change',()=>{if(selected)void paintArt(selected,role);},{signal});
 stop.addEventListener('click',()=>{stopPlay();setStatus('테스트를 종료했어요. 연결 값은 그대로예요.');play.focus();},{signal});
 play.addEventListener('click',async()=>{
  if(!ready()||busy)return;
  const which=map, instance=selected, coords=layout(), offsets=attachments(), chosen=bindings(), ticket=++generation;
  stopPlay();busy=true;refresh();setStatus('연결한 프랍과 맵 이미지를 확인하고 있어요.');
  try{
   const entries=await Promise.all(Object.entries(chosen).map(async([role,id])=>[role,(await loadProp(instance,role,id)).prop]));
   if(signal.aborted||ticket!==generation)return;
   if(selected!==instance||JSON.stringify(chosen)!==JSON.stringify(bindings())||JSON.stringify(coords)!==JSON.stringify(layout())||JSON.stringify(offsets)!==JSON.stringify(attachments())){setStatus('연결이 바뀌었어요. 다시 테스트 플레이를 누르세요.');return;}
   const rehearsal=buildWellRehearsal({map:which,backgrounds,props,layout:coords,attachments:offsets,bindings:chosen,media:Object.fromEntries(entries),pins:instance.pinned});
   run=new AbortController();mountWellPuzzleDemo(stage,{signal:run.signal,rehearsal});stop.hidden=false;
   setStatus('테스트 중이에요. 구역은 맵 이동 버튼으로 이동하거나, 테스트 구역 바로가기로 골라 볼 수 있어요.');
   stage.querySelector('.well-demo-scene')?.focus();
  }catch{if(!signal.aborted&&ticket===generation)setStatus('맵 이미지나 선택한 프랍 버전을 읽지 못했어요. 새로고침 후 다시 연결해 주세요.');}
  finally{if(!signal.aborted&&ticket===generation){busy=false;refresh();}}
 },{signal});
 let lastApply;
 apply.addEventListener('click',async()=>{
  if(!published||!submit||busy||!map)return;
  if(selected&&(!Object.values(layout()).every(viewPoint)||!Object.values(attachments()).every(offsetOk))){setStatus('선택한 퍼즐의 좌표 범위를 확인하세요.');return;}
  snapshotSelected();
  const puzzles=instances.map(p=>({id:p.id,type:p.type,layout:p.layout,attachments:p.attachments,
   bindings:Object.fromEntries(slots.map(([role])=>{
    const row=p.pinned?.[role]??props.find(x=>x.propId===p.bindings[role]);
    return [role,row?{propId:row.propId,revision:row.revision,sha256:row.sha256}:null];
   }))}));
  const payload={schemaVersion:'ngs.assembly-update.v1',projectId,assemblyId:published.assemblyId,expectedRevision:published.revision,puzzles};
  if(!validAssemblyRequest(payload,'assembly.update')){setStatus('모든 퍼즐의 필수 프랍 연결과 좌표를 확인하세요.');return;}
  if(!assemblyReachable(map.graph,puzzles)){setStatus('제상에서 우물까지 갔다가 돌아오는 맵 연결이 필요해요. 맵 연결을 확인하거나 두 프랍을 같은 구역에 놓으세요.');return;}
  const fingerprint=JSON.stringify(payload);
  if(!lastApply||lastApply.body!==fingerprint)lastApply={body:fingerprint,key:crypto.randomUUID()};
  busy=true;refresh();
  try{
   const res=await submit({requestType:'assembly.update',idempotencyKey:lastApply.key,payload}),value=await res.json();
   if(!isQueuedRequest(res,value))throw Error(value?.error??'QUEUE_FAILED');
   setStatus('정식 수정 요청을 접수했어요. 게시가 끝나면 이 조립본을 다시 열어 새 리비전을 확인하세요.');
  }catch(e){setStatus(e.message==='ASSEMBLY_REVISION_CONFLICT'?'다른 편집에서 먼저 변경했어요. 조립본을 다시 열고 확인해 주세요.':'수정 요청을 접수하지 못했어요.');}
  finally{if(!signal.aborted){busy=false;refresh();}}
 },{signal});
 playPublished.addEventListener('click',async()=>{
  if(!published||busy||!map)return;
  stopPlay();busy=true;refresh();
  try{
   const selectedId=selected?.id,original=published.puzzles.find(p=>p.id===selectedId)??published.puzzles[0];
   if(!original)return;
   const entries=await Promise.all(Object.entries(original.bindings).map(async([role,pin])=>[role,(await pinnedRead(pin)).prop]));
   if(signal.aborted)return;
   const config=buildWellRehearsal({map,backgrounds,props,layout:original.layout,attachments:original.attachments,bindings:Object.fromEntries(Object.entries(original.bindings).map(([k,v])=>[k,v.propId])),pins:original.bindings,media:Object.fromEntries(entries)});
   config.formal=true;config.onPropChanged=change=>{
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
  }catch{if(!signal.aborted)setStatus('게시본의 맵과 프랍을 읽지 못했어요.');}
  finally{if(!signal.aborted){busy=false;refresh();}}
 },{signal});
 signal.addEventListener('abort',()=>{if(removeDialog.open)removeDialog.close();cancelDrag();stopPlay();},{once:true});
 await readMap();
}
