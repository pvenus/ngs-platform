import {browserRequestId} from './browser-request-id.mjs';
import {mountCatalogRosterEdit} from './catalog-roster-edit.mjs';
import {cinematicPath,cinematicHash,cinematicId} from './cinematic-contract.mjs';
import {cinematicUpscaleType,cinematicUpscaleSchema,validCinematicUpscale,cinematicSequenceType,cinematicSequenceNamedSchema,nativeCinematicPlayback,
 cinematicCropType,cinematicCropSchema,cinematicCropPresets,validCinematicCrop,cinematicSourceGenerateType,cinematicSourceGenerateSchema,cinematicSequencesRemoveType,cinematicSequencesRemoveSchema,
 backgroundPath,backgroundSourceType,backgroundSourceSchema,backgroundFields,validBackgroundRequest,backgroundPixelType,backgroundPixelSchema,validBackgroundPixelRequest,backgroundAnimationType,backgroundAnimationSchema,backgroundLoopPrompt,validBackgroundAnimation,
 maxSelection,validCinematicSequencePayload,validCinematicSequenceResult,
 validCinematicSourceGenerate,validCinematicSequencesRemove} from './cinematic-sequence-contract.mjs';
import {validCinematicPlayback,backgroundLoopPlayback,validBackgroundLoopPlayback} from './cinematic-timeline.mjs';
import {mountCinematicPlayer} from './cinematic-player.mjs';
import {mountPlayableBackground} from './background-playback.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const make=(tag,text,css)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(css)el.className=css;return el;};
const url=(projectId,values={})=>cinematicPath+'?'+new URLSearchParams({projectId,...values});
const short=id=>id.slice(-10);
const statusLine=()=>{const p=make('p',null,'meta');p.setAttribute('role','status');return p;};
const labeled=(name,input)=>{const l=make('label',name,'prop-form-field');l.append(input);return l;};
const action=(name,onclick,signal,css='prop-control')=>{const b=make('button',name,css);b.type='button';b.addEventListener('click',onclick,{signal});return b;};

function queueAction(submit,requestType){
 let last, key;
 return async payload=>{
  const encoded=JSON.stringify(payload);
  if(last!==encoded){last=encoded;key=browserRequestId();}
  const response=await submit({requestType,idempotencyKey:key,payload}),value=await response.json();
  if(!isQueuedRequest(response,value))throw Error(value?.error==='CINEMATIC_PLAYBACK_REVISION_CONFLICT'
   ?value.error:'CINEMATIC_QUEUE_UNCONFIRMED');
 };
}

function dialog(parent,heading,signal,afterClose){
 const modal=make('dialog',null,'prop-workspace-dialog'),title=make('h3',heading);
 title.id='cinematic-dialog-title';modal.setAttribute('aria-labelledby',title.id);
 modal.append(title);parent.append(modal);
 const close=()=>modal.close();
 signal.addEventListener('abort',close,{once:true});
 modal.addEventListener('close',()=>{
  signal.removeEventListener('abort',close);afterClose?.();modal.remove();
 },{once:true});
 return modal;
}

function requestForm(parent,{caption,send,makePayload,isValid,signal,body,notice,modalClass}){
 const child=new AbortController();
 const modal=dialog(parent,caption,signal,()=>child.abort()),form=make('form'),info=statusLine();
 if(modalClass)modal.classList.add(modalClass);
 const submit=make('button','요청 보내기','prop-control prop-primary-control');
 submit.type='submit';
 const footer=make('div',null,'prop-actions');
 footer.append(action('닫기',()=>modal.close(),child.signal),submit);
 let posting=false;
 function changed(){if(!posting){info.textContent='';submit.disabled=!isValid(makePayload());}}
 body(form,changed,child.signal);
 form.append(info,footer);modal.append(form);
 form.addEventListener('input',changed,{signal:child.signal});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(posting||!modal.open||child.signal.aborted)return;
  const payload=makePayload();
  if(!isValid(payload)){info.textContent='요청 입력과 메타데이터를 확인해 주세요.';return;}
  posting=true;submit.disabled=true;
  try{
   await send(payload);
   if(!signal.aborted){notice.textContent='정식 요청을 접수했어요. 게시 후 목록을 새로고침해 주세요.';if(modal.open)modal.close();}
  }catch{if(!child.signal.aborted)info.textContent='접수를 확인하지 못했어요. 다시 시도해 주세요.';}
  finally{posting=false;if(!child.signal.aborted)submit.disabled=!isValid(makePayload());}
 },{signal:child.signal});
 submit.disabled=!isValid(makePayload());modal.showModal();
}

const sceneLabel=s=>s.displayTitle??s.title??'시놉시스 원본 '+short(s.sourceSha256);
const normalizeSearch=value=>value.normalize('NFC').trim().toLocaleLowerCase();
function mountSourceRoster({items,scenes,selected,go,projectId,signal,area='cinematic',edit=null,legacyDeleteEnabled=false}){
 const background=area==='background';
 const keyOf=s=>background?s.sha256:s.sourceSha256;
 const storageKey='ngs:'+area+'-roster:v1:'+projectId;
 const get=()=>{try{return JSON.parse(globalThis.sessionStorage.getItem(storageKey))??{};}catch{return {};}};
 const saved=get(),query=make('input',null,'npc-search cinematic-search');
 query.id=area+'-search';query.type='search';query.maxLength=120;query.placeholder=background?'배경 이름 검색':'장면 이름 검색';
 let previousSearch='';
 if(background&&typeof saved.query!=='string')try{previousSearch=globalThis.sessionStorage.getItem('ngs.background.search:'+projectId)??'';}catch{}
 query.value=(typeof saved.query==='string'?saved.query:previousSearch).slice(0,120);
 const label=make('label',background?'배경 검색':'장면 검색','npc-search-label');label.htmlFor=query.id;
 items.before(label,query);
 const rows=new Map();
 const y=node=>node.getBoundingClientRect().top-items.getBoundingClientRect().top+items.scrollTop;
 function state(){
  const top=Number(items.scrollTop)||0;
  let anchor='',offset=0;
  if(typeof items.getBoundingClientRect==='function'){
   for(const [id,row] of rows){
    const sy=y(row);
    if(sy+row.getBoundingClientRect().height>top){anchor=id;offset=top-sy;break;}
   }
  }
  return {query:query.value,top,anchor,offset};
 }
 function remember(){try{globalThis.sessionStorage.setItem(storageKey,JSON.stringify(state()));}catch{/* storage disabled */}}
 function render(restore){
  const filter=normalizeSearch(query.value).split(/\s+/u).filter(Boolean);
  rows.clear();
  const nodes=scenes.flatMap(scene=>{
   const title=sceneLabel(scene);
   if(!filter.every(term=>normalizeSearch(title).includes(term)))return [];
   const li=make('li'),link=make('a',null,'request-item npc-roster-entry');
   const id=keyOf(scene);link.href=go(background?{item:id}:{cineSource:id,item:''});
   if(scene===selected)link.setAttribute('aria-current','page');
   link.append(make('strong',title));
   if(!background)link.append(make('span','애니메이션 '+(scene.sequences.length+scene.clips.length)+'개','meta'));
   li.append(link);if(background||scene.sceneFolder===true||legacyDeleteEnabled)edit?.decorate(li,id,title,background?{sourceRequestId:scene.officialRequestId}:undefined);rows.set(id,li);return [li];
  });
  items.replaceChildren(...(nodes.length?nodes:[make('li',filter.length?'검색 결과가 없습니다.':background?'게시된 배경이 없습니다.':'게시된 시네마틱이 없습니다.','meta')]));
  edit?.refresh();
  const anchor=rows.get(restore?.anchor);
  const top=anchor&&typeof items.getBoundingClientRect==='function'?y(anchor)+(Number(restore.offset)||0):Number(restore?.top)||0;
  items.scrollTop=Math.max(0,top);
 }
 render(saved);
 query.addEventListener('input',()=>{render();remember();},{signal});
 items.addEventListener('scroll',remember,{passive:true,signal});
 globalThis.addEventListener?.('pagehide',remember,{signal});
 signal.addEventListener('abort',()=>{remember();label.remove();query.remove();},{once:true});
}
export async function mountCinematicWorkspace({items,detail,tools,request,submit,projectId,item,source,panel,navigate,signal,
 enabled,upscaleEnabled=false,sourceEnabled=false,cropEnabled=false,deleteItem,deleteAnimation,legacyDeleteEnabled=false}){
 const {scenes}=await request(url(projectId,{grouped:'2'}));
 if(signal.aborted)return;
 if(!Array.isArray(scenes)||!scenes.every(s=>s&&cinematicHash(s.sourceSha256)&&(s.title===null||typeof s.title==='string')&&
  [s.sequences,s.clips].every(v=>Array.isArray(v)&&v.every(cinematicId))))throw Error('CINEMATIC_INDEX_INVALID');
 const selected=source?scenes.find(s=>s.sourceSha256===source):
  scenes.find(s=>s.sequences.includes(item)||s.clips.includes(item));
 const enhanced=new Set(selected?.upscaledSequences??[]);
 const sequences=selected?.sequences??[],clips=selected?.clips??[], currentSource=selected?.sourceSha256;
 const tab=panel==='animations'||sequences.includes(item)||clips.includes(item)?'animations':'source';
 const go=(options={})=>navigate({cineSource:currentSource,cineTab:tab,...options});
 items.parentElement.classList.add('npc-roster-list','prop-roster');
 detail.classList.add('npc-detail','prop-detail','cinematic-detail');
 const notice=statusLine();notice.classList.add('prop-request-status');
 if(sourceEnabled&&typeof submit==='function'){
  const send=queueAction(submit,cinematicSourceGenerateType);
  const add=action('+',()=>{
   const title=make('input'),prompt=make('textarea');title.maxLength=120;prompt.maxLength=1000;prompt.rows=5;
   requestForm(detail,{caption:'새 시네마틱 원본 생성',signal,send,notice,isValid:validCinematicSourceGenerate,
    makePayload:()=>({schemaVersion:cinematicSourceGenerateSchema,projectId,title:title.value.trim(),prompt:prompt.value.trim()}),
    body:form=>form.append(make('p','새 장면을 2:1로 요청해요. 다른 비율로 나오면 원본을 보존하고, 자르기 후처리를 별도로 요청할 수 있어요.','meta'),
     labeled('장면 이름',title),labeled('이미지 연출 지시',prompt))});
   title.focus();
  },signal,'npc-one-stop-trigger');
  add.setAttribute('aria-label','시네마틱 원본 생성');add.title='시네마틱 원본 생성';
  tools.replaceChildren(add);tools.hidden=false;
 }
 const edit=mountCatalogRosterEdit({items,tools,deleteItem,signal});
 mountSourceRoster({items,scenes,selected,go,projectId,signal,edit,legacyDeleteEnabled});
 const heading=make('header',null,'npc-detail-heading prop-detail-heading');
 const title=make('div',null,'prop-identity'),actions=make('div',null,'prop-actions');
 heading.append(title,actions);
 const refresh=make('a','목록 새로고침','prop-control cinematic-refresh');
 refresh.href=go(selected&&item?{item}:{});actions.append(refresh);
 const body=make('section',null,'npc-tab-panel prop-tab-panel');
 body.append(notice);
 if(!selected){
  title.append(make('h3','시네마틱 설계'));
  body.append(make('p',source||item?'선택한 장면이 현재 목록에 없습니다.':'왼쪽 목록에서 장면을 선택하거나 +로 원본을 생성하세요.','meta'));
  detail.replaceChildren(heading,body);return;
 }
 const badges=make('div',null,'npc-character-badges');badges.append(make('span','원본 1장'),make('span','애니메이션 '+(sequences.length+clips.length)+'개'));
 title.append(make('h3',sceneLabel(selected)),badges);
 const tabs=make('nav',null,'npc-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','시네마틱 상세 영역');
 const options=[['source','원본 이미지'],['animations','애니메이션']];
 const links=options.map(([key,name],i)=>{
  const a=make('a',name);a.id='cinematic-tab-'+key;a.href=go({cineTab:key});
  a.setAttribute('role','tab');a.setAttribute('aria-controls','cinematic-tab-panel');a.setAttribute('aria-selected',String(key===tab));a.tabIndex=key===tab?0:-1;
  a.addEventListener('keydown',event=>{
   const next=event.key==='ArrowRight'||event.key==='ArrowLeft'?1-i:event.key==='Home'?0:event.key==='End'?1:null;
   if(next!==null){event.preventDefault();links[next].click();}
  },{signal});
  return a;
 });
 tabs.append(...links);
 body.id='cinematic-tab-panel';body.tabIndex=0;body.setAttribute('role','tabpanel');body.setAttribute('aria-labelledby','cinematic-tab-'+tab);
 detail.replaceChildren(heading,tabs,body);
 if(tab==='source'){
  const card=make('section',null,'prop-surface');
  const img=make('img',null,'cinematic-source-image');img.src=url(projectId,{source:currentSource});img.alt=sceneLabel(selected);
  card.append(img);
  if(cropEnabled&&typeof submit==='function')void request(url(projectId,{source:currentSource,sourceInfo:'2'})).then(info=>{
   if(signal.aborted||info?.sourceSha256!==currentSource)return;
   const presets=cinematicCropPresets(info.width,info.height);
   if(!presets.length)return;
   const cropButton=action('2:1 자르기',()=>{
    let payload;
    const rawTitle=sceneLabel(selected).trim();
    const title=[...rawTitle].slice(0,108).join('')+' · 2:1';
    requestForm(detail,{caption:'시네마틱 원본 2:1 자르기',modalClass:'cinematic-crop-dialog',send:queueAction(submit,cinematicCropType),notice,signal,
     makePayload:()=>payload,isValid:validCinematicCrop,body:(form,changed,formSignal)=>{
      const viewport=make('div',null,'cinematic-crop-viewport');
      viewport.tabIndex=0;viewport.setAttribute('role','region');viewport.setAttribute('aria-label','원본 크기 자르기 미리보기');
      const frame=make('div',null,'cinematic-crop-frame');frame.style.width=info.width+'px';
      const preview=make('img');preview.src=img.src;preview.alt='자르기 전 원본';preview.width=info.width;preview.height=info.height;
      const overlay=make('div');overlay.style.cssText='position:absolute;inset:0;pointer-events:none';overlay.setAttribute('aria-hidden','true');
      frame.append(preview,overlay);viewport.append(frame);
      const line=make('p','프리셋을 선택하면 잘리는 경계가 빨간색으로 표시돼요.','meta');
      const choices=make('div',null,'prop-actions'),buttons=[];
      for(const {label,...box} of presets){
       const button=action(label,()=>{
        for(const b of buttons)b.setAttribute('aria-pressed',String(b===button));
        payload={schemaVersion:cinematicCropSchema,projectId,title,sourceSha256:currentSource,...box};
        overlay.replaceChildren();
        for(const [edge,at,extent] of [['x',box.left,box.width],['x',box.right,box.width],['y',box.top,box.height],['y',box.bottom,box.height]]){
         if(at<=0||at>=extent)continue;
         const red=make('span');red.style.cssText=edge==='x'?'position:absolute;top:0;bottom:0;border-left:2px solid #ff3434;left:'+100*at/extent+'%':
          'position:absolute;left:0;right:0;border-top:2px solid #ff3434;top:'+100*at/extent+'%';
         overlay.append(red);
        }
        line.textContent='남는 이미지: '+(box.right-box.left)+' × '+(box.bottom-box.top)+(box.width%2&&box.width<2*box.height?' · 정확한 2:1을 위해 오른쪽 1px도 잘라요.':'');
        changed();
       },formSignal);
       button.setAttribute('aria-pressed','false');buttons.push(button);choices.append(button);
      }
      form.append(choices,line,viewport);
     }});
   },signal,'prop-control cinematic-crop-action');
   cropButton.style.cssText='background:#087f86;color:#fff;border:1px solid #3ccfd1;font-weight:700;align-self:flex-start;margin:.25rem 0 .5rem';
   const placement=make('div',null,'prop-actions');
   placement.append(cropButton);img.before(placement);
  }).catch(()=>{});
  body.append(card);return;
 }
 const split=make('section',null,'cinematic-animation-split'),list=make('section',null,'prop-surface cinematic-animation-list'),
  viewer=make('section',null,'prop-surface cinematic-animation-preview');
 const bar=make('div',null,'prop-panel-heading'),listTools=make('div',null,'prop-actions'),playerTools=make('div',null,'prop-actions'),
  playerHeading=make('h4','재생 미리보기','npc-media-heading'),player=make('div',null,'cinematic-inline-player'),
  playerBar=make('div',null,'prop-panel-heading');
 bar.append(make('h4','애니메이션','npc-media-heading'),listTools);list.append(bar);
 playerBar.append(playerHeading,playerTools);viewer.append(playerBar,player);
 split.append(list,viewer);body.append(split);
 if(enabled&&typeof submit==='function'){
  const add=action('+',()=>{
   const name=make('input'),motion=make('textarea');name.maxLength=120;name.required=true;motion.rows=5;motion.maxLength=1000;
   requestForm(detail,{caption:'애니메이션 추가',signal,send:queueAction(submit,cinematicSequenceType),notice,isValid:validCinematicSequencePayload,
    makePayload:()=>({schemaVersion:cinematicSequenceNamedSchema,projectId,sourceSha256:currentSource,title:name.value.trim(),motionPrompt:motion.value.trim()}),
    body:form=>form.append(make('p',sceneLabel(selected)+' · 생성된 PNG 프레임을 원래 순서대로 재생해요.','meta'),
     labeled('애니메이션 제목',name),labeled('움직임·연출 지시',motion))});
   name.focus();
  },signal,'npc-one-stop-trigger');
  add.setAttribute('aria-label','애니메이션 추가');add.title='애니메이션 추가';listTools.append(add);
 }
 const rows=make('ul',null,'prop-animation-list cinematic-versions');list.append(rows);
 if(!sequences.length&&!clips.length)rows.append(make('li','아직 생성된 애니메이션이 없습니다.','meta'));
 const titles=selected?.animationTitles??{},folders=new Map(Object.entries(selected?.animationFolders??{}).filter(([id,kind])=>sequences.includes(id)&&typeof kind==='boolean'));
 let activeAbort;
 const rowLinks=new Map();
 const labelFor=(id,legacy=false)=>typeof titles[id]==='string'&&titles[id].trim()?titles[id]:
  (legacy?'기존 MP4 ':'PNG ')+short(id);
 const editAnimations=mountCatalogRosterEdit({items:rows,tools:listTools,modalOwner:detail,signal,
  deleteItem:typeof deleteAnimation==='function'&&folders.size?row=>deleteAnimation({...row,sourceSha256:currentSource}):undefined,
  deleteMessage:'선택한 애니메이션 폴더만 삭제해요. 장면 원본과 선택하지 않은 버전은 그대로예요.'});
 function select(id,legacy=false,autoplay=false){
  activeAbort?.abort();
  const ac=new AbortController();activeAbort=ac;if(signal.aborted)ac.abort();
  for(const [itemId,link] of rowLinks)link.setAttribute('aria-current',String(id===itemId));
  playerHeading.textContent=labelFor(id,legacy);playerTools.replaceChildren();
  player.replaceChildren(make('p','재생할 프레임을 확인하고 있어요.','meta'));
  if(legacy){
   const video=make('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.src=url(projectId,{clip:id,video:'1'});
   video.setAttribute('aria-label',labelFor(id,true));player.replaceChildren(video);return;
  }
  void openFrames(id,ac,autoplay);
 }
 signal.addEventListener('abort',()=>activeAbort?.abort(),{once:true});
 async function openFrames(id,ac,autoplay){
  try{
   const {sequence,revision,playback}=await request(url(projectId,{sequence:id}));
   if(ac.signal.aborted)return;
   if(!validCinematicSequenceResult(sequence)||sequence.officialRequestId!==id||sequence.sourceSha256!==currentSource||sequence.group)
    throw Error('CINEMATIC_SEQUENCE_INVALID');
   if(upscaleEnabled&&!sequence.upscale&&typeof submit==='function'&&Number.isSafeInteger(revision)&&validCinematicPlayback(playback)){
    const payload={schemaVersion:cinematicUpscaleSchema,projectId,sequenceId:id,sourceSha256:currentSource,expectedRevision:revision,playback};
    if(validCinematicUpscale(payload))playerTools.append(action('업스케일링',()=>{
     if(ac.signal.aborted)return;
     requestForm(detail,{caption:'시네마틱 2× 업스케일링',signal:ac.signal,send:queueAction(submit,cinematicUpscaleType),notice,
      isValid:validCinematicUpscale,makePayload:()=>payload,
      body:form=>form.append(make('p','선택한 프레임으로 2× 버전을 만들어요. 원본은 바꾸지 않아요.','meta'))});
    },ac.signal));
   }
   player.replaceChildren();
   await mountCinematicPlayer(player,{manifest:{...sequence,playback:nativeCinematicPlayback(sequence.frameCount)},
    frameUrl:i=>url(projectId,{sequence:id,frame:i}),signal:ac.signal,edit:false,autoplay});
  }catch{if(!ac.signal.aborted)player.replaceChildren(make('p','이 버전을 재생할 수 없어요. 사본 상태를 확인해 주세요.','meta error'));}
 }
 for(const [id,legacy] of [...sequences.map(id=>[id,false]),...clips.map(id=>[id,true])]){
  const row=make('li',null,'cinematic-version'),link=make('a',null,'cinematic-animation-select'),label=labelFor(id,legacy);
  link.href=go({cineTab:'animations',item:id});link.setAttribute('aria-current','false');rowLinks.set(id,link);
  const text=make('span',null,'cinematic-row-label');text.append(make('strong',label),make('span',legacy?'기존 MP4':enhanced.has(id)?'2× 업스케일':'PNG 프레임','meta'));
  link.append(text);link.addEventListener('click',event=>{
   if(event.button!==undefined&&event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
   event.preventDefault?.();select(id,legacy,true);
  },{signal});
  row.append(link);rows.append(row);
  if(!legacy&&folders.has(id))editAnimations?.decorate(row,id,label,{sourceSha256:currentSource,sceneFolder:folders.get(id)});
 }
 if(sequences.includes(item)||clips.includes(item))select(item,clips.includes(item));
 else player.append(make('p','왼쪽 목록에서 애니메이션을 선택하세요.','meta'));
}

export async function mountBackgroundWorkspace({items,detail,tools,request,submit,projectId,item,panel,navigate,signal,enabled,pixelEnabled,animationEnabled,deleteItem}){
 const url=values=>backgroundPath+'?'+new URLSearchParams({projectId,...values});
 const notice=statusLine();
 items.parentElement?.classList.add('npc-roster-list','prop-roster');
 if((enabled||pixelEnabled)&&submit){
  function trigger(pixel){
   const caption=pixel?'배경 원본 + 픽셀 제작 요청':'배경 생성 요청';
   const add=action('+',()=>{
   const inputs={},examples={title:'예: 의식 전의 한옥 안채',timeOfDay:'예: 해가 진 직후',season:'예: 늦가을',
    mood:'예: 고요하지만 불길한 기운',color:'예: 먹색, 바랜 목재색, 옅은 등불색',
    location:'예: 한옥 안채에서 마당을 바라보는 구도',requirements:'예: 마루와 문턱이 분명하고 가운데에 이동 공간 확보',
    additionalNotes:'예: 바닥에 비친 부드러운 그림자'};
   requestForm(detail,{caption,signal,notice,send:queueAction(submit,pixel?backgroundPixelType:backgroundSourceType),
    makePayload:()=>({schemaVersion:pixel?backgroundPixelSchema:backgroundSourceSchema,projectId,...Object.fromEntries(
     backgroundFields.map(([field])=>[field,inputs[field]?.value.trim()??'']))}),isValid:pixel?validBackgroundPixelRequest:validBackgroundRequest,
    body(form){
     for(const [field,label,maximum] of backgroundFields){
      const input=make(maximum>500?'textarea':'input');
      input.name=field;input.maxLength=pixel&&field==='title'?105:maximum;input.required=field!=='additionalNotes';input.placeholder=examples[field];
      if(maximum>500)input.rows=3;
      inputs[field]=input;form.append(labeled(label,input));
     }
    }});
  },signal,'npc-one-stop-trigger');
   add.setAttribute('aria-label',caption);add.title=caption;return add;
  }
  tools.replaceChildren(trigger(Boolean(pixelEnabled)));tools.hidden=false;
 }
 const payload=await request(url({}));if(signal.aborted)return;
 const rows=Array.isArray(payload.backgrounds)?payload.backgrounds:[];
 const selected=rows.find(x=>x.sha256===item||x.cinematic?.sha256===item||x.draftAlias===item);
 const edit=mountCatalogRosterEdit({items,tools,deleteItem:deleteItem&& (async row=>{
  const entry=rows.find(x=>x.sha256===row.id);
  if(entry?.cinematic)await deleteItem({id:entry.cinematic.sha256,expected:{sourceRequestId:entry.cinematic.officialRequestId}});
  await deleteItem(row);
 }),signal});
 mountSourceRoster({items,scenes:rows,selected,go:options=>navigate({cineTab:panel==='animations'?'animations':'source',...options}),projectId,signal,area:'background',edit});
 if(!selected){
  detail.replaceChildren(make('h3','배경 설계'),notice,make('p',(enabled||pixelEnabled)?'배경을 고르거나 +로 새 배경을 요청하세요.':'배경을 고르세요. 생성 기능이 아직 연결되지 않았습니다.','meta'));
  return;
 }
 const pages=[['source','원본 이미지'],['animations','애니메이션']];
 const active=pages.some(([key])=>panel===key)?panel:'source',go=key=>navigate({item:selected.sha256,cineTab:key});
 const header=make('header',null,'npc-detail-heading prop-detail-heading');
 header.append(make('h3',selected.displayTitle??selected.title));
 const tabs=make('nav',null,'npc-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','배경 상세 영역');
 const tabLinks=pages.map(([key,title],index)=>{
  const link=make('a',title);link.href=go(key);link.id='background-tab-'+key;link.setAttribute('role','tab');
  link.setAttribute('aria-controls','background-tab-panel');
  link.setAttribute('aria-selected',String(key===active));link.tabIndex=key===active?0:-1;
  link.addEventListener('keydown',event=>{
   const last=pages.length-1;
   const target=event.key==='Home'?0:event.key==='End'?last:event.key==='ArrowLeft'?(index+last)%pages.length:
     event.key==='ArrowRight'?(index+1)%pages.length:null;
   if(target!==null){event.preventDefault();tabLinks[target].click();}
  },{signal});return link;
 });
 tabs.append(...tabLinks);
 const section=make('section',null,'npc-tab-panel prop-tab-panel');section.id='background-tab-panel';section.tabIndex=0;
 section.setAttribute('role','tabpanel');section.setAttribute('aria-labelledby','background-tab-'+active);section.append(notice);
 detail.replaceChildren(header,tabs,section);
 const labels={cinematic:'시네마틱 스타일 원본',pixel:'픽셀 보정본'};
 const variants=selected.pixel?{cinematic:selected.cinematic,pixel:selected.pixel}:{cinematic:selected,pixel:null};
 const available=Object.entries(variants).filter(([,v])=>v);
 if(active==='source'){
  if(variants.pixel&&variants.cinematic){
   const title=selected.displayTitle??selected.title;
   const still=source=>({url:url({image:source.sha256}),width:source.width,height:source.height});
   mountPlayableBackground(section,{signal,stills:{normal:still(variants.pixel),spirit:still(variants.cinematic),title},
    onEnlarge:enabled=>openStill(enabled?'cinematic':'pixel',enabled?variants.cinematic:variants.pixel)});
   return;
  }
  const grid=backgroundComparison();section.append(grid);
  for(const [variant,source] of Object.entries(variants)){
   const card=make('section',null,'prop-surface');card.append(make('h4',labels[variant],'npc-media-heading'));
   if(source){
    const img=make('img',null,'cinematic-source-image');img.src=url({image:source.sha256});img.alt=labels[variant]+': '+(selected.displayTitle??selected.title);
    const enlarge=action('',()=>openStill(variant,source),signal,'npc-media-enlarge-trigger background-still-enlarge');
    enlarge.setAttribute('aria-label',labels[variant]+' 확대');enlarge.setAttribute('aria-haspopup','dialog');
    enlarge.append(img);card.append(enlarge,make('p',source.width+' × '+source.height+' · PNG','meta'));
   }else card.append(make('p','게시된 이미지가 없습니다.','meta'));
   grid.append(card);
  }
  return;
 }
 function openStill(variant,source){
  const title=labels[variant]+': '+(selected.displayTitle??selected.title);
  const {body}=backgroundMediaDialog(detail,title,variant,signal);
  const stage=make('div',null,'npc-media-enlarge-stage'),full=make('img');
  full.alt=title;full.src=url({image:source.sha256});
  stage.append(full);body.append(stage,make('p',source.width+' × '+source.height+' · PNG','meta'));
 }
 const urlForCine=values=>cinematicPath+'?'+new URLSearchParams({projectId,...values});
 async function loadTrack(group,[variant,result]){
  const {sequence,playback}=await request(urlForCine({sequence:result.id}));
  const proof=sequence?.group;
  if(!validCinematicSequenceResult(sequence)||!validBackgroundLoopPlayback(playback)||sequence.officialRequestId!==result.id||
     sequence.sourceSha256!==result.sourceSha256||proof?.requestId!==group.requestId||proof?.variant!==variant||
     proof?.backgroundSha256!==selected.sha256)throw Error('BACKGROUND_ANIMATION_INVALID');
  return {label:labels[variant],manifest:{...sequence,playback},frameUrl:i=>urlForCine({sequence:result.id,frame:i})};
 }
 const publishedResults=group=>Object.entries(group.variants??{}).filter(([variant,value])=>
  variants[variant]?.sha256===value?.sourceSha256&&cinematicId(value?.id));
 const card=make('section',null,'prop-surface'),bar=make('div',null,'prop-panel-heading');
 bar.append(make('h4','애니메이션','npc-media-heading'));card.append(bar);section.append(card);
 if(animationEnabled&&submit&&available.length){
  const add=action('+',()=>{
   const motion=make('textarea');motion.maxLength=650;motion.rows=5;motion.required=true;
   const choices=new Map();const playback=backgroundLoopPlayback();
   requestForm(detail,{caption:'배경 애니메이션 생성',signal,notice,send:queueAction(submit,backgroundAnimationType),
    makePayload:()=>({schemaVersion:backgroundAnimationSchema,projectId,backgroundSha256:selected.sha256,
     references:Object.fromEntries(available.filter(([variant])=>choices.get(variant)?.checked).map(([variant,source])=>[variant,source.sha256])),
     motionPrompt:motion.value.trim()?backgroundLoopPrompt(motion.value):'',playback}),isValid:validBackgroundAnimation,
    body(form){
     const fields=make('fieldset');fields.append(make('legend','애니메이션에 사용할 원본'));
     for(const [variant] of available){
      const check=make('input');check.type='checkbox';check.checked=true;choices.set(variant,check);
      fields.append(labeled(labels[variant],check));
     }
     form.append(fields,make('p','배경은 멈추지 않는 루프만 생성해요. 두 원본을 고르면 같은 움직임으로 한 번에 요청할 수 있어요.','meta'),
      labeled('반복해서 움직일 요소와 방식',motion));
    }});
   motion.focus();
  },signal,'npc-one-stop-trigger');
  add.setAttribute('aria-label','배경 애니메이션 추가');add.title='배경 애니메이션 추가';bar.append(add);
 }
 let response;
 try{response=await request(url({groups:selected.sha256}));}catch{
  if(!signal.aborted)card.append(make('p','애니메이션 목록을 읽지 못했어요.','meta error'));return;
 }
 if(signal.aborted)return;
 const groups=Array.isArray(response.groups)?response.groups:[];
 if(!groups.length){card.append(make('p','생성된 애니메이션이 없습니다.','meta'));return;}
 let running;
 signal.addEventListener('abort',()=>running?.abort(),{once:true});
 const entries=make('ul',null,'prop-animation-list cinematic-versions');
 for(const group of groups){
  const results=publishedResults(group);
  if(!results.length||!cinematicId(group.requestId))continue;
  const row=make('li',null,'cinematic-version'),line=make('div',null,'prop-panel-heading'),view=make('div');
  const count=results.length;
  line.append(make('strong','요청 '+short(group.requestId)+' · '+results.map(([key])=>labels[key]).join(' / ')));
  for(const entry of results){
   const [variant]=entry;
   const enlarge=action(labels[variant]+' 확대',async()=>{
    const popup=backgroundMediaDialog(detail,labels[variant]+' 애니메이션',variant,signal);
    popup.body.append(make('p','PNG 프레임을 읽고 있어요.','meta'));
    try{
     const {manifest,frameUrl}=await loadTrack(group,entry);
     popup.signal.throwIfAborted();
     popup.body.replaceChildren(make('p',manifest.width+' × '+manifest.height+' · PNG 프레임'+(manifest.upscale?' · 2× 업스케일':'')+(manifest.upscale?.pixelCorrection?.downscale===2?' · ½ 크기 픽셀 보정':manifest.upscale?.pixelCorrection?' · 픽셀 보정':''),'meta'));
     await mountCinematicPlayer(popup.body,{manifest,frameUrl,signal:popup.signal,edit:false,autoplay:true,inspectFrames:true,loop:true});
    }catch{if(!popup.signal.aborted)popup.body.replaceChildren(make('p','이 애니메이션을 재생할 수 없어요.','meta error'));}
   },signal);
   enlarge.setAttribute('aria-haspopup','dialog');line.append(enlarge);
  }
  line.append(action(count===2?'두 영상 함께 재생':'재생',async()=>{
   running?.abort();const controller=new AbortController();running=controller;
   for(const host of entries.querySelectorAll('.background-pair-player'))host.replaceChildren();
   view.append(make('p','PNG 프레임을 읽고 있어요.','meta'));
   try{
    const data=await Promise.all(results.map(entry=>loadTrack(group,entry)));
    controller.signal.throwIfAborted();
    view.replaceChildren();
    await mountBackgroundAnimationPair(view,data,{signal:controller.signal,autoplay:true});
   }catch{if(!controller.signal.aborted)view.replaceChildren(make('p','이 요청의 애니메이션을 재생할 수 없어요.','meta error'));}
  },signal));
  view.className='background-pair-player';row.append(line,view);entries.append(row);
 }
 card.append(entries);
}
function backgroundMediaDialog(owner,title,variant,signal){
 const controller=new AbortController();
 const modal=dialog(owner,title,signal,()=>controller.abort());
 modal.className='npc-media-enlarge background-media-dialog';
 if(variant==='pixel')modal.dataset.pixel='true';
 const titleNode=modal.firstElementChild,header=make('header');
 const close=action('닫기',()=>modal.close(),controller.signal,'npc-media-enlarge-close');
 close.setAttribute('autofocus','');header.append(titleNode,close);
 const body=make('div',null,'background-media-body');
 modal.append(header,body);
 modal.addEventListener('click',event=>{
  if(event.target!==modal)return;
  const {left,right,top,bottom}=modal.getBoundingClientRect();
  if(event.clientX<left||event.clientX>right||event.clientY<top||event.clientY>bottom)modal.close();
 },{signal:controller.signal});
 modal.showModal();
 return {body,signal:controller.signal};
}

function backgroundComparison(){
 const grid=make('div',null,'background-comparison');
 grid.style.display='grid';grid.style.gridTemplateColumns='repeat(auto-fit,minmax(min(100%, 14rem),1fr))';grid.style.gap='1rem';
 return grid;
}
async function mountBackgroundAnimationPair(parent,tracks,{signal,autoplay}){
 const grid=backgroundComparison(),toggle=make('button','재생','prop-control'),scrub=make('input'),clock=make('span',null,'meta');
 toggle.type='button';toggle.disabled=true;scrub.type='range';scrub.min='0';scrub.step='1';scrub.disabled=true;scrub.setAttribute('aria-label','두 영상 공통 재생 위치');
 parent.append(grid,toggle,scrub,clock);
 const painters=await Promise.all(tracks.map(({label,manifest,frameUrl})=>{
  const pane=make('section');pane.append(make('h5',label));grid.append(pane);
  return mountCinematicPlayer(pane,{manifest,frameUrl,signal,edit:false,externalClock:true,loop:true});
 }));
 signal.throwIfAborted();
 const end=Math.max(...tracks.map(t=>t.manifest.playback.durationFrames))-1;
 let position=0,timer=null,origin=null,base=0;
 const paint=frame=>{position=frame;painters.forEach(p=>p(frame));scrub.value=String(frame);clock.textContent=(frame/24).toFixed(2)+'초';};
 const pause=()=>{if(timer!==null)cancelAnimationFrame(timer);timer=null;origin=null;toggle.textContent='재생';};
 function step(now){
  if(signal.aborted)return pause();
  origin??=now;paint((base+Math.floor((now-origin)*24/1000))%(end+1));
  timer=requestAnimationFrame(step);
 }
 function play(){base=position;toggle.textContent='일시 정지';timer=requestAnimationFrame(step);}
 scrub.max=String(end);scrub.disabled=false;toggle.disabled=false;paint(0);
 toggle.addEventListener('click',()=>timer===null?play():pause(),{signal});
 scrub.addEventListener('input',()=>{pause();paint(Number(scrub.value));},{signal});
 signal.addEventListener('abort',pause,{once:true});
 if(autoplay)play();
}
