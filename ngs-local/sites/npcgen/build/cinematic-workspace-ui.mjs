import {mountCatalogRosterEdit} from './catalog-roster-edit.mjs';
import {cinematicPath,cinematicHash,cinematicId} from './cinematic-contract.mjs';
import {cinematicSequenceType,cinematicSequenceSchema,cinematicPlaybackUpdateType,cinematicPlaybackUpdateSchema,
 cinematicSourceGenerateType,cinematicSourceGenerateSchema,cinematicSequencesRemoveType,cinematicSequencesRemoveSchema,
 backgroundPath,backgroundSourceType,backgroundSourceSchema,backgroundFields,validBackgroundRequest,backgroundPixelType,backgroundPixelSchema,validBackgroundPixelRequest,backgroundAnimationType,backgroundAnimationSchema,backgroundLoopPrompt,validBackgroundAnimation,
 maxSelection,validCinematicSequencePayload,validCinematicSequenceResult,validCinematicPlaybackUpdate,
 validCinematicSourceGenerate,validCinematicSequencesRemove} from './cinematic-sequence-contract.mjs';
import {defaultCinematicPlayback,validCinematicPlayback,backgroundLoopPlayback,validBackgroundLoopPlayback} from './cinematic-timeline.mjs';
import {mountCinematicPlayer,layoutTimelineControls} from './cinematic-player.mjs';
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
  if(last!==encoded){last=encoded;key=crypto.randomUUID();}
  const response=await submit({requestType,idempotencyKey:key,payload}),value=await response.json();
  if(!isQueuedRequest(response,value))throw Error(value?.error==='CINEMATIC_PLAYBACK_REVISION_CONFLICT'
   ?value.error:'CINEMATIC_QUEUE_UNCONFIRMED');
 };
}

function dialog(parent,heading,signal,afterClose){
 const modal=make('dialog',null,'prop-workspace-dialog'),title=make('h3',heading);
 title.id='cinematic-dialog-'+crypto.randomUUID();modal.setAttribute('aria-labelledby',title.id);
 modal.append(title);parent.append(modal);
 const close=()=>modal.close();
 signal.addEventListener('abort',close,{once:true});
 modal.addEventListener('close',()=>{
  signal.removeEventListener('abort',close);afterClose?.();modal.remove();
 },{once:true});
 return modal;
}

function requestForm(parent,{caption,send,makePayload,isValid,signal,body,notice}){
 const child=new AbortController();
 const modal=dialog(parent,caption,signal,()=>child.abort()),form=make('form'),info=statusLine();
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
 enabled,playbackEnabled=false,sourceEnabled=false,removeEnabled=false,deleteItem,legacyDeleteEnabled=false}){
 const {scenes}=await request(url(projectId,{grouped:'1'}));
 if(signal.aborted)return;
 if(!Array.isArray(scenes)||!scenes.every(s=>s&&cinematicHash(s.sourceSha256)&&(s.title===null||typeof s.title==='string')&&
  [s.sequences,s.clips].every(v=>Array.isArray(v)&&v.every(cinematicId))))throw Error('CINEMATIC_INDEX_INVALID');
 const selected=source?scenes.find(s=>s.sourceSha256===source):
  scenes.find(s=>s.sequences.includes(item)||s.clips.includes(item));
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
    body:form=>form.append(make('p','새 장면의 원본 이미지 한 장만 생성해요. 애니메이션은 게시 후 별도로 추가할 수 있어요.','meta'),
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
  const next=make('a','애니메이션 보기','prop-control cinematic-refresh');next.href=go({cineTab:'animations'});
  card.append(make('h4','원본 이미지','npc-media-heading'),img,
   make('p','이 장면에서는 게시된 원본 한 장을 그대로 사용해 애니메이션을 추가해요.','meta'),next);
  body.append(card);return;
 }
 const card=make('section',null,'prop-surface'),bar=make('div',null,'prop-panel-heading');
 bar.append(make('h4','애니메이션','npc-media-heading'));card.append(bar);body.append(card);
 if(enabled&&typeof submit==='function'){
  const add=action('+',()=>{
   const send=queueAction(submit,cinematicSequenceType);
   const motion=make('textarea');motion.rows=5;motion.maxLength=1000;
   let playback;
   requestForm(detail,{caption:'애니메이션 추가',signal,send,notice,isValid:validCinematicSequencePayload,
    makePayload:()=>({schemaVersion:cinematicSequenceSchema,projectId,sourceSha256:currentSource,motionPrompt:motion.value.trim(),playback}),
    body:(form,changed,formSignal)=>{
     form.append(make('p',sceneLabel(selected)+' · 같은 원본 사용','meta'),labeled('움직임·연출 지시',motion));
     const settings=make('details',null,'cinematic-request-settings');
     settings.append(make('summary','속도·카메라 설정'));form.append(settings);
     layoutTimelineControls(settings,defaultCinematicPlayback(),value=>{playback=value;changed();},{signal:formSignal,allowDownload:false});
    }});
   motion.focus();
  },signal,'npc-one-stop-trigger');
  add.setAttribute('aria-label','애니메이션 추가');add.title='애니메이션 추가';bar.append(add);
 }else bar.append(make('span','이 환경에서는 애니메이션 추가가 준비되지 않았어요.','meta'));
 const rows=make('ul',null,'prop-animation-list cinematic-versions'),checks=new Map(),picked=new Set();
 const selectAll=make('button','전체 선택','prop-control');selectAll.type='button';
 const canRemove=removeEnabled&&typeof submit==='function';
 const archive=action('선택 버전 제거',async()=>{
  if(archive.disabled||!picked.size||picked.size>maxSelection)return;
  const ids=[...picked].sort();
  const confirm=dialog(detail,'선택한 애니메이션 삭제',signal);
  const footer=make('div',null,'prop-actions');
  footer.append(action('취소',()=>confirm.close(),signal),action('삭제 요청',()=>{
   confirm.close();void removeSelection(ids);
  },signal,'prop-control prop-animation-delete'));
  confirm.append(make('p','선택한 '+ids.length+'개 버전을 목록에서 제거할까요? 원본 파일은 보존됩니다.'),footer);
  confirm.showModal();
 },signal,'prop-control prop-animation-delete');
 async function removeSelection(ids){
  const payload={schemaVersion:cinematicSequencesRemoveSchema,projectId,sequenceIds:ids};
  if(!validCinematicSequencesRemove(payload))return;
  removing=true;selection();
  try{
   await remove(payload);
   if(!signal.aborted){accepted=true;notice.textContent='정식 제거 요청을 접수했어요. 완료 후 새로고침해 주세요.';}
  }catch{if(!signal.aborted)notice.textContent='제거 요청 접수를 확인하지 못했어요.';}
  finally{removing=false;if(!signal.aborted)selection();}
 }
 const remove=canRemove?queueAction(submit,cinematicSequencesRemoveType):null;
 let removing=false,accepted=false;
 function selection(){
  archive.disabled=removing||accepted||!picked.size||picked.size>maxSelection;
  selectAll.disabled=removing||accepted||checks.size===0||checks.size>maxSelection;
  selectAll.textContent=checks.size>0&&picked.size===checks.size?'전체 선택 해제':'전체 선택';
  for(const c of checks.values())c.disabled=removing||accepted;
 }
 if(canRemove){
  selectAll.addEventListener('click',()=>{
   const uncheck=picked.size===checks.size;picked.clear();
   for(const [id,c] of checks){c.checked=!uncheck;if(c.checked)picked.add(id);}
   selection();
  },{signal});
  const controls=make('div',null,'prop-animation-selection');
  controls.append(selectAll,archive);card.append(controls);
 }
 card.append(rows);
 if(!sequences.length&&!clips.length)rows.append(make('li','아직 생성된 애니메이션이 없습니다.','meta'));
 let inline=null,editor=null;
 const startChild=(prior)=>{
  prior?.abort();const child=new AbortController();if(signal.aborted)child.abort();return child;
 };
 signal.addEventListener('abort',()=>{inline?.abort();editor?.abort();},{once:true});
 async function openNative(id,host,{editMode=false,autoplay=false}={}){
  const abort=editMode?(editor=startChild(editor)):(inline=startChild(inline));
  if(!editMode)for(const node of rows.querySelectorAll('.cinematic-inline-player'))if(node!==host)node.replaceChildren();
  if(editMode)host.replaceChildren();
  const feedback=statusLine();feedback.textContent='PNG 재생 정보를 읽고 있어요.';host.replaceChildren(feedback);
  try{
   const {sequence,revision,playback}=await request(url(projectId,{sequence:id}));
   if(abort.signal.aborted)return;
   if(!validCinematicSequenceResult(sequence)||sequence.officialRequestId!==id||sequence.sourceSha256!==currentSource||!validCinematicPlayback(playback)||
      !Number.isSafeInteger(revision)||revision<0)throw Error('CINEMATIC_SEQUENCE_INVALID');
   if(editMode)host.replaceChildren(make('h4','속도·카메라 편집 · '+short(id)),make('p','게시 메타 버전 '+revision,'meta'));
   else host.replaceChildren();
   const send=queueAction(submit,cinematicPlaybackUpdateType);
   await mountCinematicPlayer(host,{manifest:{...sequence,playback},frameUrl:i=>url(projectId,{sequence:id,frame:i}),signal:abort.signal,
    edit:editMode,autoplay,...((editMode&&playbackEnabled&&typeof submit==='function')?{onSaveRequest:async next=>{
     const payload={schemaVersion:cinematicPlaybackUpdateSchema,projectId,sequenceId:id,expectedRevision:revision,playback:next};
     if(!validCinematicPlaybackUpdate(payload))throw Error('NGS_CINEMATIC_PAYLOAD_INVALID');
     await send(payload);
    }}:{})});
  }catch{if(!abort.signal.aborted)host.replaceChildren(make('p','이 버전을 재생할 수 없어요. 사본 상태를 확인해 주세요.','meta error'));}
 }
 for(const id of sequences){
  const row=make('li',null,'cinematic-version'+(id===item?' prop-animation-row-current':'')),line=make('div',null,'cinematic-version-line'),player=make('div',null,'cinematic-inline-player');
  if(canRemove){
   const c=make('input');c.type='checkbox';c.setAttribute('aria-label','버전 '+short(id)+' 선택');checks.set(id,c);
   c.addEventListener('change',()=>{if(c.checked)picked.add(id);else picked.delete(id);selection();},{signal});line.append(c);
  }
  const still=make('img');still.alt='버전 '+short(id)+' 첫 프레임';still.src=url(projectId,{sequence:id,frame:0});still.loading='lazy';
  const permalink=make('a','PNG '+short(id));permalink.href=navigate({cineTab:'animations',cineSource:currentSource,item:id});
  const info=make('div',null,'cinematic-row-label'),controls=make('div',null,'prop-actions cinematic-row-actions');
  info.append(permalink,make('span','PNG 프레임','meta'));
  controls.append(action('재생',()=>void openNative(id,player,{autoplay:true}),signal));
  if(playbackEnabled&&typeof submit==='function')controls.append(action('수정',()=>{
   const pane=dialog(detail,'애니메이션 수정',signal,()=>editor?.abort()),content=make('div');
   const footer=make('div',null,'prop-actions');
   footer.append(action('닫기',()=>pane.close(),signal));pane.append(content,footer);pane.showModal();
   void openNative(id,content,{editMode:true});
  },signal));
  line.append(still,info,controls);
  row.append(line,player);rows.append(row);
  if(id===item)void openNative(id,player);
 }
 // Historical MP4s stay visible and playable without exposing a new encode lane.
 for(const id of clips){
  const row=make('li',null,'cinematic-version'),line=make('div',null,'cinematic-version-line cinematic-legacy-line'),label=make('span','기존 MP4 '+short(id)),video=make('video');
  video.controls=true;video.playsInline=true;video.preload='none';video.src=url(projectId,{clip:id,video:'1'});
  video.setAttribute('aria-label','기존 MP4 '+short(id));
  line.append(label,video);row.append(line);rows.append(row);
 }
 selection();
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
