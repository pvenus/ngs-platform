import {cinematicPath,cinematicHash,cinematicId} from './cinematic-contract.mjs';
import {cinematicSequenceType,cinematicSequenceSchema,cinematicPlaybackUpdateType,cinematicPlaybackUpdateSchema,
 cinematicSourceGenerateType,cinematicSourceGenerateSchema,cinematicSequencesRemoveType,cinematicSequencesRemoveSchema,
 maxSelection,validCinematicSequencePayload,validCinematicSequenceResult,validCinematicPlaybackUpdate,
 validCinematicSourceGenerate,validCinematicSequencesRemove} from './cinematic-sequence-contract.mjs';
import {defaultCinematicPlayback,validCinematicPlayback} from './cinematic-timeline.mjs';
import {mountCinematicPlayer,layoutTimelineControls} from './cinematic-player.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const make=(tag,text,css)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(css)el.className=css;return el;};
const url=(projectId,values={})=>cinematicPath+'?'+new URLSearchParams({projectId,...values});
const short=id=>id.slice(-10);
const statusLine=()=>{const p=make('p',null,'meta');p.setAttribute('role','status');return p;};
const labeled=(name,input)=>{const l=make('label',name);l.append(input);return l;};
const action=(name,onclick,signal)=>{const b=make('button',name);b.type='button';b.addEventListener('click',onclick,{signal});return b;};

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

function requestForm(parent,{caption,send,makePayload,isValid,signal,body}){
 const form=make('form',null,'workspace-detail-form'), submit=make('button',caption),notice=statusLine();
 submit.type='submit';
 let posting=false,sent=false;
 function changed(){if(!posting){sent=false;notice.textContent='';submit.disabled=!isValid(makePayload());}}
 body(form,changed);
 form.append(submit,notice);parent.append(form);
 form.addEventListener('input',changed,{signal});
 form.addEventListener('submit',async event=>{
  event.preventDefault(); if(posting||sent)return;
  const payload=makePayload();
  if(!isValid(payload)){notice.textContent='요청 입력과 메타데이터를 확인해 주세요.';return;}
  posting=true;submit.disabled=true;
  try{
   await send(payload);
   if(!signal.aborted){sent=true;notice.textContent='정식 요청을 접수했어요. 반영 후 목록을 새로고침해 주세요.';}
  }catch{if(!signal.aborted)notice.textContent='접수를 확인하지 못했어요. 다시 시도해 주세요.';}
  finally{posting=false;if(!signal.aborted)submit.disabled=sent||!isValid(makePayload());}
 },{signal});
 submit.disabled=!isValid(makePayload());
}

export async function mountCinematicWorkspace({items,detail,request,submit,projectId,item,source,panel,navigate,signal,
 enabled,playbackEnabled=false,sourceEnabled=false,removeEnabled=false}){
 const data=await request(url(projectId));
 if(signal.aborted)return;
 const {sources,clips,sequences=[]}=data;
 if(!Array.isArray(sources)||!sources.every(cinematicHash)||!Array.isArray(clips)||!clips.every(cinematicId)||
    !Array.isArray(sequences)||!sequences.every(cinematicId))throw Error('CINEMATIC_INDEX_INVALID');
 const tab=panel==='animations'||[...sequences,...clips].includes(item)?'animations':'source';
 const currentSource=sources.includes(source)?source:sources[0];
 const tabs=make('nav',null,'detail-file-nav');tabs.setAttribute('aria-label','시네마틱 탭');
 for(const [key,name] of [['source','원본 이미지'],['animations','애니메이션']]){
  const a=make('a',name);
  a.href=navigate({cineTab:key,cineSource:currentSource});if(tab===key)a.setAttribute('aria-current','page');tabs.append(a);
 }
 const refresh=make('a','목록 새로고침');refresh.href=navigate({cineTab:tab,cineSource:currentSource,...(item?{item}:{})});
 detail.replaceChildren(make('h3',tab==='source'?'원본 이미지':'시네마틱 애니메이션'),tabs,refresh);
 items.replaceChildren(...(sources.length?sources.map(id=>{
  const a=make('a','원본 '+short(id),'workspace-nav-item');
  a.href=navigate({cineTab:'source',cineSource:id});
  if(id===currentSource&&tab==='source')a.setAttribute('aria-current','page');return a;
 }):[make('p','아직 등록된 원본이 없습니다.','meta')]));
 if(tab==='source'){
  if(currentSource){
   const {title}=await request(url(projectId,{source:currentSource,sourceInfo:'1'}));
   if(signal.aborted)return;
   const img=make('img');img.src=url(projectId,{source:currentSource});img.alt=title??'시놉시스 원본';
   img.style.maxWidth='100%';
   const next=make('a','이 원본의 애니메이션 요청으로');next.href=navigate({cineTab:'animations',cineSource:currentSource});
   detail.append(make('h4',title??'시놉시스 원본'),img,next);
  }
  detail.append(make('p','이미지 생성과 애니메이션 생성은 별도 요청이에요. 원본을 확인한 뒤 연출을 결정하세요.','meta'));
  if(sourceEnabled&&typeof submit==='function'){
   const name=make('input'),prompt=make('textarea');
   name.maxLength=120;prompt.maxLength=1000;prompt.rows=4;
   requestForm(detail,{caption:'원본 이미지 생성 요청',signal,send:queueAction(submit,cinematicSourceGenerateType),
    isValid:validCinematicSourceGenerate,makePayload:()=>({schemaVersion:cinematicSourceGenerateSchema,projectId,title:name.value.trim(),prompt:prompt.value.trim()}),
    body:form=>form.append(labeled('장면 이름',name),labeled('이미지 연출 지시',prompt))});
  }else detail.append(make('p','원본 이미지 생성은 이 환경에서 아직 준비되지 않았어요.','meta'));
  return;
 }
 const rows=make('section',null,'cinematic-versions'),edit=make('section'),checks=new Map(),picked=new Set(),notice=statusLine();
 const selectAll=make('input');selectAll.type='checkbox';
 const canRemove=removeEnabled&&typeof submit==='function';
 const archive=action('선택 버전 제거',async()=>{
  if(!picked.size||picked.size>maxSelection)return;
  if(!window.confirm('선택한 '+picked.size+'개 버전을 목록에서 제거할까요? 원본 파일은 보존됩니다.'))return;
  const payload={schemaVersion:cinematicSequencesRemoveSchema,projectId,sequenceIds:[...picked].sort()};
  if(!validCinematicSequencesRemove(payload))return;
  removing=true;selection();
  try{
   await remove(payload);
   if(!signal.aborted){accepted=true;notice.textContent='정식 제거 요청을 접수했어요. 완료 후 새로고침해 주세요.';}
  }catch{if(!signal.aborted)notice.textContent='제거 요청 접수를 확인하지 못했어요.';}
  finally{removing=false;if(!signal.aborted)selection();}
 },signal);
 const remove=canRemove?queueAction(submit,cinematicSequencesRemoveType):null;
 let removing=false,accepted=false;
 function selection(){
  archive.disabled=removing||accepted||!picked.size||picked.size>maxSelection;
  selectAll.disabled=removing||accepted||checks.size===0||checks.size>maxSelection;
  selectAll.checked=checks.size>0&&picked.size===checks.size;selectAll.indeterminate=picked.size>0&&picked.size<checks.size;
  for(const c of checks.values())c.disabled=removing||accepted;
 }
 if(canRemove){
  selectAll.addEventListener('change',()=>{
   picked.clear();
   for(const [id,c] of checks){c.checked=selectAll.checked;if(c.checked)picked.add(id);}
   selection();
  },{signal});
  detail.append(labeled('모두 선택',selectAll),archive,notice);
 }
 detail.append(rows,edit);
 if(!sequences.length&&!clips.length)rows.append(make('p','아직 생성된 애니메이션이 없습니다.','meta'));
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
   if(!validCinematicSequenceResult(sequence)||sequence.officialRequestId!==id||!validCinematicPlayback(playback)||
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
  const row=make('article',null,'cinematic-version'),line=make('div',null,'cinematic-version-line'),player=make('div',null,'cinematic-inline-player');
  if(canRemove){
   const c=make('input');c.type='checkbox';c.setAttribute('aria-label','버전 '+short(id)+' 선택');checks.set(id,c);
   c.addEventListener('change',()=>{if(c.checked)picked.add(id);else picked.delete(id);selection();},{signal});line.append(c);
  }
  const still=make('img');still.alt='버전 '+short(id)+' 첫 프레임';still.src=url(projectId,{sequence:id,frame:0});still.loading='lazy';
  const permalink=make('a','PNG '+short(id));permalink.href=navigate({cineTab:'animations',cineSource:currentSource,item:id});
  line.append(still,permalink,action('바로 재생',()=>void openNative(id,player,{autoplay:true}),signal),action('메타 편집',()=>void openNative(id,edit,{editMode:true}),signal));
  row.append(line,player);rows.append(row);
  if(id===item)void openNative(id,player);
 }
 // Historical MP4s stay visible and playable without exposing a new encode lane.
 for(const id of clips){
  const line=make('div',null,'cinematic-version-line'),label=make('span','기존 MP4 '+short(id)),video=make('video');
  video.controls=true;video.playsInline=true;video.preload='none';video.src=url(projectId,{clip:id,video:'1'});
  video.setAttribute('aria-label','기존 MP4 '+short(id));
  line.append(label,video);rows.append(line);
 }
 selection();
 if(!enabled||typeof submit!=='function'){
  detail.append(make('p','PNG 시네마틱 생성은 이 환경에서 아직 준비되지 않았어요.','meta'));return;
 }
 if(!sources.length){detail.append(make('p','등록된 원본 이미지가 필요해요.','meta'));return;}
 const select=make('select'),motion=make('textarea');motion.rows=4;motion.maxLength=1000;
 for(const id of sources){const o=make('option','원본 '+short(id));o.value=id;select.append(o);}
 if(currentSource)select.value=currentSource;
 let playback;
 requestForm(detail,{caption:'이 원본으로 애니메이션 생성 요청',signal,send:queueAction(submit,cinematicSequenceType),
  isValid:validCinematicSequencePayload,makePayload:()=>({schemaVersion:cinematicSequenceSchema,projectId,sourceSha256:select.value,motionPrompt:motion.value.trim(),playback}),
  body:(form,changed)=>{
   form.append(labeled('출발 원본',select),labeled('움직임·연출 지시',motion));
   layoutTimelineControls(form,defaultCinematicPlayback(),value=>{playback=value;changed();},{signal,allowDownload:false});
  }});
}
