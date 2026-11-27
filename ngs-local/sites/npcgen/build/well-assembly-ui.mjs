import {validMapState} from './map-contract.mjs';
import {wellDemoId,wellDemoTitle,wellAssemblySlots,mountWellPuzzleDemo} from './well-puzzle-demo.mjs';

const slots=Object.entries(wellAssemblySlots);
const suggestions={table:/^ritual-seal-altar-/,bowl:/(?:water-bowl|ritual-seal-ash-catcher-)/,well:/^ritual-seal-well-v/,lid:/^ritual-seal-well-cover-/};
const el=(tag,value,cls)=>{const n=document.createElement(tag);if(value)n.textContent=value;if(cls)n.className=cls;return n;};
const field=(title,input)=>{const row=el('label',title,'prop-form-field');row.append(input);return row;};
const option=(id,title)=>{const n=el('option',title);n.value=id;return n;};
const control=title=>{const n=el('button',title,'prop-control');n.type='button';return n;};
const sha=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const safeMedia=url=>typeof url==='string'&&url.startsWith('/api/prop-workspace?');
const viewPoint=p=>['x','y'].every(axis=>Number.isInteger(p?.[axis])&&p[axis]>=10&&p[axis]<=90);
const stateKey='ngs:well-rehearsal:v1:';

export function buildWellRehearsal({map,backgrounds,props,layout,bindings,media}){
 if(!validMapState(map))throw Error('MAP_INVALID');
 if(!['altar','well'].every(key=>viewPoint(layout[key])&&map.graph.regions.some(x=>x.id===layout[key].regionId)))throw Error('PLACEMENT_INVALID');
 const byBackground=new Map(backgrounds.map(x=>[x.backgroundId,x]));
 const regions=map.graph.regions.map(region=>{
  const asset=byBackground.get(region.backgroundId);
  const lane=[asset,asset?.pixel,asset?.cinematic].find(p=>p?.sha256===region.imageSha256);
  if(!lane||!sha(lane.sha256)||!(lane.width>0&&lane.height>0))throw Error('MAP_ART_MISSING');
  return {id:region.id,name:region.name,width:lane.width,height:lane.height,src:'/api/background-workspace?projectId=binari&image='+lane.sha256};
 });
 const art={};
 for(const [role] of slots){
  const row=props.find(p=>p.propId===bindings[role]), result=media[role];
  if(!row||!result||result.propId!==row.propId||result.source?.revision!==row.revision||
    result.source?.sha256!==row.sha256||!safeMedia(result.media?.pixel?.url)||result.media.pixel.mediaType!=='image/png')
   throw Error('PROP_ART_MISSING_OR_STALE');
  art[role]=result.media.pixel.url;
 }
 return {initialRegion:map.graph.startRegionId,regions,connections:map.graph.connections,positions:layout,art};
}

export async function mountWellAssembly({items,detail,request,projectId,signal}){
 const api=(resource,query={})=>'/api/'+resource+'-workspace?'+new URLSearchParams({projectId,...query});
 const [{maps},{props},{backgrounds}]=await Promise.all(['map','prop','background'].map(name=>request(api(name))));
 if(signal.aborted)return;
 if(![maps,props,backgrounds].every(Array.isArray))throw Error('ASSEMBLY_CATALOG_UNAVAILABLE');
 const roster=el('li');roster.append(el('strong','테스트 조립'),el('p','맵 · 퍼즐 · 프랍 연결','meta'));items.replaceChildren(roster);
 const card=el('section',null,'prop-surface well-assembly'),head=el('h3','조립·플레이');
 const note=el('p','게임에 게시하지 않고 현재 브라우저에서 연결과 동작을 시험해요.','meta');
 const feedback=el('p',null,'meta');feedback.setAttribute('role','status');
 const mapSelect=el('select'),puzzle=el('select');
 puzzle.append(option(wellDemoId,wellDemoTitle));
 const inputs=el('div',null,'well-assembly-grid');inputs.append(field('맵',mapSelect),field('퍼즐',puzzle));
 const positionInputs={},propInputs={};
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
  select.value=candidates[0]?.propId??'';
  propInputs[role]=select;bindingFields.append(field(label,select));
 }
 for(const [key,title] of [['altar','제상 위치 · 그릇 자리 포함'],['well','우물 위치 · 뚜껑 포함']]){
  const group=el('fieldset'),legend=el('legend',title),region=el('select'),coords=el('div',null,'well-assembly-grid');
  const number=()=>{const n=el('input');n.type='number';n.required=true;n.min='10';n.max='90';n.step='1';return n;};
  const x=number(),y=number();group.append(legend,field('구역',region),coords);coords.append(field('가로 위치 (%)',x),field('세로 위치 (%)',y));
  positionInputs[key]={region,x,y};placement.append(group);
 }
 const stage=el('section'),play=control('테스트 플레이'),stop=control('테스트 종료');stop.hidden=true;
 const actions=el('div',null,'prop-actions');actions.append(play,stop);
 card.append(head,note,inputs,el('h4','퍼즐에 필요한 프랍'),bindingFields,el('h4','맵 위 배치'),placement,actions,feedback,stage);detail.replaceChildren(card);
 let draft;try{draft=JSON.parse(sessionStorage.getItem(stateKey+projectId)??'null');}catch{}
 let map,run,generation=0,busy=false;
 mapSelect.append(option('','맵 선택'),...maps.map(x=>option(x.mapId,x.title)));
 mapSelect.value=maps.some(x=>x.mapId===draft?.mapId)?draft.mapId:maps[0]?.mapId??'';
 for(const [role,select] of Object.entries(propInputs))if(props.some(x=>x.propId===draft?.bindings?.[role]))select.value=draft.bindings[role];
 const layout=()=>Object.fromEntries(Object.entries(positionInputs).map(([key,v])=>[key,{regionId:v.region.value,x:Number(v.x.value),y:Number(v.y.value)}]));
 const bindings=()=>Object.fromEntries(Object.entries(propInputs).map(([key,v])=>[key,v.value]));
 const setStatus=s=>{feedback.textContent=s;};
 function remember(){try{sessionStorage.setItem(stateKey+projectId,JSON.stringify({mapId:mapSelect.value,layout:layout(),bindings:bindings()}));}catch{}}
 function ready(){return map&&Object.values(bindings()).every(Boolean)&&Object.values(layout()).every(viewPoint);}
 function refresh(){play.disabled=Boolean(busy||!ready());}
 function stopPlay(){run?.abort();run=null;stop.hidden=true;stage.replaceChildren();}
 async function readMap(fromDraft){
  stopPlay();const ticket=++generation;busy=true;map=null;refresh();
  try{
   if(!mapSelect.value){setStatus('게시된 맵을 선택하세요.');return;}
   setStatus('맵 구역을 읽고 있어요.');
   const {map:next}=await request(api('map',{item:mapSelect.value}));
   if(signal.aborted||ticket!==generation)return;
   if(!validMapState(next))throw Error('MAP_INVALID');
   map=next;
   const targets=map.graph.regions;
   for(const [key,entry] of Object.entries(positionInputs)){
    entry.region.replaceChildren(...targets.map(x=>option(x.id,x.name)));
    const custom=fromDraft&&draft?.layout?.[key], defaultId=key==='altar'?(targets.find(x=>x.id==='zone-2')?.id??targets[0].id):(targets.find(x=>x.id==='zone-4')?.id??targets.at(-1).id);
    entry.region.value=targets.some(r=>r.id===custom?.regionId)?custom.regionId:defaultId;
    entry.x.value=viewPoint(custom)?custom.x:(key==='altar'?49:55);entry.y.value=viewPoint(custom)?custom.y:73;
   }
   remember();setStatus('연결할 프랍과 위치를 확인한 뒤 테스트 플레이를 누르세요.');
  }catch{if(!signal.aborted&&ticket===generation)setStatus('선택한 맵을 읽지 못했어요.');}
  finally{if(!signal.aborted&&ticket===generation){busy=false;refresh();}}
 }
 mapSelect.addEventListener('change',()=>{draft=null;void readMap(false);},{signal});
 for(const input of [...Object.values(propInputs),...Object.values(positionInputs).flatMap(x=>Object.values(x))])
  input.addEventListener('change',()=>{if(run){stopPlay();setStatus('연결이 바뀌었어요. 다시 테스트 플레이를 누르세요.');}remember();refresh();},{signal});
 stop.addEventListener('click',()=>{stopPlay();setStatus('테스트를 종료했어요. 연결 값은 그대로예요.');play.focus();},{signal});
 play.addEventListener('click',async()=>{
  if(!ready()||busy)return;
  const which=map, coords=layout(), chosen=bindings(), ticket=++generation;
  stopPlay();busy=true;refresh();setStatus('연결한 프랍과 맵 이미지를 확인하고 있어요.');
  try{
   const entries=await Promise.all(Object.entries(chosen).map(async([role,id])=>[role,(await request(api('prop',{propId:id}))).prop]));
   if(signal.aborted||ticket!==generation)return;
   if(JSON.stringify(chosen)!==JSON.stringify(bindings())||JSON.stringify(coords)!==JSON.stringify(layout())){setStatus('연결이 바뀌었어요. 다시 테스트 플레이를 누르세요.');return;}
   const rehearsal=buildWellRehearsal({map:which,backgrounds,props,layout:coords,bindings:chosen,media:Object.fromEntries(entries)});
   run=new AbortController();mountWellPuzzleDemo(stage,{signal:run.signal,rehearsal});stop.hidden=false;
   setStatus('테스트 중이에요. 구역은 맵 이동 버튼으로 이동하거나, 테스트 구역 바로가기로 골라 볼 수 있어요.');
   stage.querySelector('.well-demo-scene')?.focus();
  }catch{if(!signal.aborted&&ticket===generation)setStatus('맵 이미지나 선택한 프랍 버전을 읽지 못했어요. 새로고침 후 다시 연결해 주세요.');}
  finally{if(!signal.aborted&&ticket===generation){busy=false;refresh();}}
 },{signal});
 signal.addEventListener('abort',stopPlay,{once:true});
 await readMap(true);
}
