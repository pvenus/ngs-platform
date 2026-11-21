const audioRequestType='audio.generate',schemaVersion='ngs.audio-generate.v1';
const kinds=[['bgm','BGM'],['effect','효과음'],['tts','TTS']];
const id=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const receiptId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const definite=new Set(['REQUEST_SUBMIT_INVALID','NGS_AUDIO_GENERATE_PAYLOAD_INVALID',
 'NGS_AUDIO_DELETE_PAYLOAD_INVALID','AUDIO_WORKSPACE_UNAVAILABLE','OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT','PROJECT_OR_RESOURCE_DENIED',
 'LOCAL_SIGN_IN_REQUIRED','LOCAL_SESSION_EXPIRED_OR_REVOKED','FRONTEND_SESSION_CONTEXT_CHANGED',
 'CSRF_INVALID','ORIGIN_OR_CSRF_REJECTED']);
const limits=Object.freeze({title:120,brief:4000});

const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
function validText(value,max,multiline=true){
 return typeof value==='string'&&value.isWellFormed()&&value===value.trim()&&value!==''&&[...value].length<=max&&
  !control.test(value)&&(multiline||!/[\r\n\t\u2028\u2029]/u.test(value));
}

export function validLocalAudioPayload(v){
 return v&&typeof v==='object'&&!Array.isArray(v)&&
  Object.keys(v).sort().join(',')==='brief,conceptId,durationSeconds,kind,projectId,schemaVersion,text,title'&&
  v.schemaVersion===schemaVersion&&v.projectId==='binari'&&v.kind==='bgm'&&
  typeof v.conceptId==='string'&&id.test(v.conceptId)&&validText(v.title,limits.title,false)&&validText(v.brief,limits.brief)&&
  (v.durationSeconds===null?(v.text===''||validText(v.text,512)):
   v.text===''&&Number.isFinite(v.durationSeconds)&&v.durationSeconds>=10&&v.durationSeconds<=30);
}
export function soundConceptOptions(index){
 if(index?.projectId!=='binari'||index.tab!=='concept'||!Array.isArray(index.groups)||!index.groups.some(group=>group?.id==='group.sound')||
    !Array.isArray(index.items))return [];
 const found=new Set();
 return index.items.flatMap(row=>{
  if(row?.groupId!=='group.sound'||row.archived===true||typeof row.id!=='string'||!id.test(row.id)||
     typeof row.label!=='string'||!row.label.trim()||found.has(row.id))return [];
  found.add(row.id);return [{id:row.id,label:row.label}];
 });
}
export function makeAudioPayload({kind,title,conceptId,brief,duration},options){
 const v={schemaVersion,projectId:'binari',kind,title:title.trim(),conceptId,brief:brief.trim(),
  text:'',durationSeconds:duration===null||typeof duration==='string'&&!duration.trim()?null:Number(duration)};
 if(!options.some(row=>row.id===conceptId)||!validLocalAudioPayload(v))throw Error('AUDIO_FORM_INVALID');
 return v;
}

export function createAudioIntake(submit,{uuid=()=>crypto.randomUUID(),requestType=audioRequestType}={}){
 let pending=null,busy=false,receipt=null;
 return {
  get uncertain(){return pending!==null&&!receipt;},
  async send(makePayload){
   if(busy||receipt)return null;
   if(!pending)pending={requestType,idempotencyKey:uuid(),payload:makePayload()};
   busy=true;
   try{
    const response=await submit(pending),value=await response.json();
    if(response.status===201&&value?.status==='registered'&&typeof value.officialRequestId==='string'&&
       receiptId.test(value.officialRequestId)&&Object.keys(value).sort().join(',')==='officialRequestId,status'){
     receipt=value;return value;
    }
    if(response.status>=400&&response.status<500&&definite.has(value?.error)){
     pending=null;throw Object.assign(Error(value.error),{definitive:true});
    }
    throw Error('AUDIO_RECEIPT_UNCONFIRMED');
   }finally{busy=false;}
  },
 };
}

export async function readAudioSoundConcepts({post,request,signal}){
 const scope='binari/concept',comparison=await post('compare',{scope});
 if(signal.aborted)return [];
 if(comparison.unavailable?.includes(''))throw Error('AUDIO_SOUND_CONCEPTS_UNAVAILABLE');
 if(comparison.groups.some(row=>row.folder===''))await post('refresh',{scope,folder:''});
 if(signal.aborted)return [];
 return soundConceptOptions(await request('/api/project-workspace?projectId=binari&tab=concept'));
}

function node(tag,className='',label){
 const child=document.createElement(tag);
 if(className)child.className=className;
 if(label!==undefined)child.textContent=label;
 return child;
}
function field(label,tag,options){
 const wrapper=node('label','',label),input=Object.assign(node(tag),options);wrapper.append(input);return {wrapper,input};
}
const audioIndex='/api/audio-workspace?projectId=binari';
const formatter=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2});
const playlists=new WeakMap();
function makePlaylist(container,signal,{submitDelete,onDeleteAccepted=()=>{}}={}){
 const list=node('ol','audio-results-list'),empty=node('p','meta','아직 게시된 BGM이 없습니다.');
 const actions=node('div','audio-playlist-actions'),playSelected=node('button','concept-category-trigger','선택 재생');
 playSelected.type='button';playSelected.disabled=true;actions.append(playSelected);actions.hidden=true;
 const head=node('div','audio-playlist-columns');
 head.setAttribute('aria-hidden','true');
 head.append(node('span'),node('span'),node('span','','제목'),node('span','','BPM'),node('span','','총길이'));
 const now=node('div','audio-now-playing'),label=node('p','audio-now-title'),player=node('audio'),error=node('p','meta error');
 player.controls=true;player.preload='none';now.hidden=true;list.hidden=true;head.hidden=true;
 error.setAttribute('role','status');now.append(label,player,error);
 container.replaceChildren(actions,head,list,empty,now);
 const checked=new Set();
 let selected=null,activeButtons=new Map(),queued=[],playAttempt=0,deleting=false;
 const deletions=new Map(),deleteButton=node('button','concept-category-trigger audio-delete','선택 삭제 요청'),
  deleteSummary=node('p','meta'),dialog=node('dialog','npc-one-stop-dialog audio-dialog'),
  heading=node('h2','','선택한 BGM 삭제'),description=node('p'),targets=node('ul'),
  footer=node('div','audio-delete-actions'),cancel=node('button','','취소'),confirm=node('button','audio-delete','삭제 요청');
 const candidates=()=>{
  const seen=new Set();
  return [...activeButtons.values()].filter(({row,audioId})=>{
   if(!audioId||!checked.has(row.url)||seen.has(audioId)||deletions.get(audioId)?.state==='registered')return false;
   seen.add(audioId);return true;
  });
 };
 const updateSelection=()=>{
  playSelected.disabled=checked.size===0;
  deleteButton.disabled=deleting||candidates().length===0;
 };
 if(submitDelete){
  let confirmed=[];
  deleteButton.type=cancel.type=confirm.type='button';deleteButton.disabled=true;
  heading.id='bgm-delete-title';description.id='bgm-delete-description';
  dialog.setAttribute('aria-labelledby',heading.id);dialog.setAttribute('aria-describedby',description.id);
  deleteSummary.setAttribute('role','status');deleteSummary.hidden=true;
  footer.append(cancel,confirm);dialog.append(heading,description,targets,footer);
  actions.append(deleteButton);container.append(deleteSummary,dialog);
  deleteButton.addEventListener('click',()=>{
   if(dialog.open||signal?.aborted||deleting)return;
   confirmed=candidates();
   if(!confirmed.length)return;
   description.textContent='선택한 '+confirmed.length+'곡의 삭제를 요청할까요?';
   targets.replaceChildren(...confirmed.map(({row})=>node('li','',row.title)));
   dialog.showModal();cancel.focus();
  });
  cancel.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{if(!signal?.aborted&&!deleteButton.disabled)deleteButton.focus();});
  signal?.addEventListener('abort',()=>{if(dialog.open)dialog.close();},{once:true});
  confirm.addEventListener('click',async()=>{
   if(!dialog.open||signal?.aborted||deleting)return;
   const batch=confirmed.filter(({row})=>activeButtons.has(row.url));
   if(!batch.length){dialog.close();return;}
   deleting=true;updateSelection();dialog.close();
   const stats={registered:0,rejected:0,uncertain:0},accepted=[];
   deleteSummary.hidden=false;deleteSummary.textContent=batch.length+'곡의 삭제 요청을 접수 중입니다.';
   for(const {row,audioId} of batch){
    if(signal?.aborted)break;
    let operation=deletions.get(audioId);
    if(!operation){operation={state:'queued',intake:createAudioIntake(submitDelete,{requestType:'audio.delete'})};deletions.set(audioId,operation);}
    try{
     const receipt=await operation.intake.send(()=>({schemaVersion:'ngs.audio-delete.v1',projectId:'binari',officialRequestId:audioId}));
     if(!receipt)continue;
     operation.state='registered';checked.delete(row.url);stats.registered++;accepted.push(audioId);
    }catch(error){
     operation.state=error.definitive?'rejected':'uncertain';stats[operation.state]++;
    }
    if(!signal?.aborted)paint();
   }
   deleting=false;
   if(signal?.aborted)return;
   deleteSummary.textContent=['접수 '+stats.registered+'곡',stats.rejected?'접수 실패 '+stats.rejected+'곡':'',
    stats.uncertain?'접수 확인 필요 '+stats.uncertain+'곡':''].filter(Boolean).join(' · ')+
    (stats.registered?' · 파일 동기화 후 목록에서 사라집니다.':'');
   updateSelection();
   if(!deleteButton.disabled)deleteButton.focus();
   else if(!playSelected.disabled)playSelected.focus();
   else activeButtons.values().next().value?.button.focus();
   if(accepted.length)onDeleteAccepted(accepted);
  });
 }
 playSelected.addEventListener('click',()=>{
  queued=[...activeButtons.keys()].filter(url=>checked.has(url));
  playNext();
 });
 function playNext(){
  if(signal?.aborted)return;
  while(queued.length){
   const row=activeButtons.get(queued.shift())?.row;
   if(row){select(row,true);return;}
  }
 }
 function paint(){
  for(const [url,{button,item,title,audioId,deleteStatus,check}] of activeButtons){
   const current=selected===url,playing=current&&!player.paused&&!player.ended;
   item.classList.toggle('audio-result-current',current);
   button.textContent=playing?'❚❚':'▶';
   button.setAttribute('aria-label',title+(playing?' 일시 정지':' 재생'));
   button.setAttribute('aria-pressed',String(current));
   const deletion=deletions.get(audioId)?.state;
   if(deleteStatus){
    deleteStatus.textContent={registered:'삭제 접수됨',rejected:'삭제 접수 실패',uncertain:'접수 확인 필요'}[deletion]??'';
    deleteStatus.hidden=!deleteStatus.textContent;
   }
   check.checked=checked.has(url);
  }
 }
 for(const event of ['playing','play','pause'])player.addEventListener(event,paint);
 player.addEventListener('ended',()=>{paint();playNext();});
 player.addEventListener('error',()=>{if(selected)error.textContent='이 곡을 재생하지 못했습니다.';});
 function select(row,fromQueue=false){
  if(signal?.aborted)return;
  const attempt=++playAttempt;
  error.textContent='';
  if(!fromQueue)queued=[];
  if(selected===row.url&&!player.paused&&!player.ended&&!fromQueue){player.pause();return;}
  if(fromQueue&&selected===row.url)player.currentTime=0;
  if(selected!==row.url){
   player.pause();selected=row.url;player.src=row.url;
   label.textContent=row.title;player.setAttribute('aria-label',row.title+' 재생 컨트롤');now.hidden=false;
  }
  paint();
  void player.play().catch(cause=>{
   if(attempt===playAttempt&&cause?.name!=='AbortError')error.textContent='이 곡을 재생하지 못했습니다.';
  });
 }
 function releasePlayer(){
  ++playAttempt;selected=null;player.pause();player.removeAttribute('src');player.load();now.hidden=true;error.textContent='';
 }
 signal?.addEventListener('abort',()=>{queued=[];releasePlayer();},{once:true});
 return results=>{
  if(signal?.aborted)return;
  if(!Array.isArray(results)){empty.textContent='게시된 BGM을 읽고 있습니다.';return;}
  const nextButtons=new Map(),entries=[];
  for(const row of results){
   if(typeof row?.title!=='string'||typeof row.url!=='string'||!row.url.startsWith(audioIndex+'&id=')||
      !Number.isFinite(row.durationSeconds)||row.durationSeconds<=0||nextButtons.has(row.url))continue;
   const item=node('li','audio-result'),button=node('button','audio-play', '▶'),check=node('input','audio-select');
   check.type='checkbox';check.checked=checked.has(row.url);check.setAttribute('aria-label',row.title+' 선택');
   check.addEventListener('change',()=>{if(check.checked)checked.add(row.url);else checked.delete(row.url);updateSelection();});
   button.type='button';button.addEventListener('click',()=>select(row));
   const title=node('button','audio-track-title',row.title);
   title.type='button';title.addEventListener('click',()=>select(row));
   const modeled=Number.isInteger(row.bpm)&&row.bpm>=30&&row.bpm<=300&&row.bpmBasis==='model';
   const bpm=node('span','audio-bpm',modeled?formatter.format(row.bpm):'—');
   bpm.setAttribute('aria-label',modeled?bpm.textContent+' BPM (모델 추정)':'BPM 미제공');
   if(modeled)bpm.title='모델 추정 BPM';
   const duration=node('span','audio-duration',formatter.format(row.durationSeconds)+'초');
   duration.setAttribute('aria-label','총길이 '+duration.textContent);
   const audioId=publishedAudioId(row),deleteStatus=submitDelete?node('span','audio-delete-status'):null;
   let song=title;
   if(deleteStatus){song=node('span','audio-track-song');song.append(title,deleteStatus);}
   item.append(check,button,song,bpm,duration);
   nextButtons.set(row.url,{button,item,title:row.title,row,audioId,deleteStatus,check});entries.push(item);
  }
  activeButtons=nextButtons;
  list.replaceChildren(...entries);
  for(const url of checked)if(!activeButtons.has(url))checked.delete(url);
  updateSelection();
  list.hidden=head.hidden=actions.hidden=entries.length===0;
  empty.hidden=entries.length!==0;empty.textContent='아직 게시된 BGM이 없습니다.';
  if(selected&&!activeButtons.has(selected)){queued=[];releasePlayer();}
  paint();
 };
}
export function showAudioResults(container,results,signal,options){
 let display=playlists.get(container);
 if(!display){display=makePlaylist(container,signal,options);playlists.set(container,display);}
 display(results);
}
export async function refreshAudioResults({post,request,signal,display}){
 const scope='binari/audio',read=()=>request(audioIndex);let available=false;
 try{const initial=await read();if(!signal.aborted){display(initial.results);available=true;}}catch{/* Try refreshing the exact audio scope. */}
 if(signal.aborted)return;
 const comparison=await post('compare',{scope});
 if(signal.aborted)return;
 let applied=false,failed=!!comparison.unavailable?.length;
 for(const {folder} of comparison.groups){
  if(signal.aborted)return;
  try{await post('refresh',{scope,folder});applied=true;}catch{failed=true;}
 }
 if(!signal.aborted&&(applied||!available)){const next=await read();if(!signal.aborted)display(next.results);}
 if(failed)throw Error('AUDIO_RESULT_SYNC_UNAVAILABLE');
}

const refreshDelay=60_000,maxAcceptedChecks=10;
const officialAudioId=/^request\.official\.[a-f0-9]{64}$/;
function untilNextAudioCheck(signal,ms){
 if(signal.aborted)return Promise.resolve(false);
 return new Promise(resolve=>{
  const completed=ready=>{
   clearTimeout(timer);signal.removeEventListener('abort',aborted);resolve(ready);
  };
  const aborted=()=>completed(false),timer=setTimeout(()=>completed(true),ms);
  signal.addEventListener('abort',aborted,{once:true});
 });
}
function publishedAudioId(row){
 if(typeof row?.url!=='string'||!row.url.startsWith(audioIndex+'&id='))return null;
 const parts=row.url.slice((audioIndex+'&id=').length).split('&sha256=');
 return parts.length===2&&officialAudioId.test(parts[0])&&/^[a-f0-9]{64}$/.test(parts[1])?parts[0]:null;
}
function acceptedAudioPresent(rows,id){return Array.isArray(rows)&&rows.some(row=>publishedAudioId(row)===id);}
export async function followDeletedAudioResults({ids,post,request,signal,display,wait=untilNextAudioCheck}){
 const pending=new Set(ids.filter(id=>typeof id==='string'&&officialAudioId.test(id)));
 for(let check=0;pending.size&&check<maxAcceptedChecks;check++){
  if(!await wait(signal,check===0?5000:refreshDelay)||signal.aborted)return false;
  // Compare from the existing parent: the target directory itself no longer
  // exists remotely. Apply only groups corresponding to submitted tracks.
  try{
   const scope='binari/audio',comparison=await post('compare',{scope});
   for(const group of comparison.groups){
    if(signal.aborted)return false;
    if(pending.has(group.folder))await post('refresh',{scope,folder:group.folder});
   }
  }catch{/* The official receipt does not imply source deletion or replica refresh. */}
  if(signal.aborted)return false;
  try{
   const {results}=await request(audioIndex);
   if(signal.aborted)return false;
   if(!Array.isArray(results))continue;
   display(results);
   for(const id of pending)if(!acceptedAudioPresent(results,id))pending.delete(id);
  }catch{/* Keep the existing playlist when a sync read fails. */}
 }
 return !pending.size;
}
export async function followAcceptedAudioResult({id,post,request,signal,display,visible=()=>null,wait=untilNextAudioCheck}){
 if(typeof id!=='string'||!officialAudioId.test(id)||signal.aborted)return false;
 if(acceptedAudioPresent(visible(),id))return true;
 const scope='binari/audio/'+id;
 async function showIfPresent(){
  try{
   const {results}=await request(audioIndex);
   if(!signal.aborted&&acceptedAudioPresent(results,id)){display(results);return true;}
  }catch{/* Keep the published view as-is while the exact result is not verifiable. */}
  return false;
 }
 for(let check=0;check<maxAcceptedChecks;check++){
  if(!await wait(signal,refreshDelay)||signal.aborted)return false;
  if(acceptedAudioPresent(visible(),id)||await showIfPresent())return true;
  if(signal.aborted)return false;
  try{
   const comparison=await post('compare',{scope});
   if(signal.aborted)return false;
   // This result directory has only the metadata and WAV at its root.
   if(comparison.groups.some(row=>row.folder==='')){
    await post('refresh',{scope,folder:''});
    if(!signal.aborted&&await showIfPresent())return true;
   }
  }catch{/* A transient sync error does not change the official receipt or imply failure. */}
 }
 return false;
}

export function mountAudioWorkspace({items,detail,concepts=[],loadConcepts,signal,submit,onAccepted=()=>{}}){
 let working=false,intake=createAudioIntake(submit);
 const resultList=node('section','audio-results');
 resultList.setAttribute('aria-label','게시된 BGM');
 const toolbar=node('div','audio-playlist-toolbar'),title=node('h3','','BGM');
 const open=node('button','concept-category-trigger audio-add','+');open.type='button';
 open.setAttribute('aria-label','BGM 생성 요청');open.setAttribute('aria-haspopup','dialog');open.title='BGM 생성 요청';
 open.disabled=!loadConcepts&&!concepts.length;toolbar.append(title,open);
 detail.replaceChildren(toolbar);
 const controls=kinds.map(([kind,label])=>{
  const entry=node('li'),button=node('button','request-item audio-kind',label);button.type='button';
  button.disabled=kind!=='bgm';button.setAttribute('aria-pressed',String(kind==='bgm'));
  if(kind!=='bgm')button.title='아직 지원하지 않습니다.';
  entry.append(button);return entry;
 });
 items.replaceChildren(...controls);
 if(open.disabled){detail.append(resultList);return resultList;}
 const dialog=node('dialog','npc-one-stop-dialog audio-dialog'),header=node('header'),heading=node('h2','','BGM 생성 요청');
 heading.id='bgm-create-title';dialog.setAttribute('aria-labelledby',heading.id);
 const close=node('button','','닫기');close.type='button';header.append(heading,close);
 const form=node('form','one-stop-intake audio-intake'),inputs=node('fieldset');
 inputs.append(node('legend','','BGM 생성 조건'));
 const fields=node('div','concept-category-fields');
 const name=field('제목','input',{required:true,maxLength:limits.title,autocomplete:'off'});
 const concept=field('사운드 컨셉','select',{required:true});
 const empty=node('option','','카테고리를 선택하세요');empty.value='';concept.input.append(empty);
 function setConceptOptions(){
  concept.input.replaceChildren(empty,...concepts.map(row=>Object.assign(node('option','',row.label),{value:row.id})));
 }
 setConceptOptions();
 const brief=field('제작 설명','textarea',{required:true,maxLength:limits.brief});
 const duration=field('길이 (초, 선택)','input',{type:'number',min:10,max:30,step:'any',placeholder:'비우면 모델이 결정'});
 fields.append(name.wrapper,concept.wrapper,brief.wrapper,duration.wrapper);inputs.append(fields);
 const send=node('button','concept-category-trigger','BGM 생성 요청');send.type='submit';form.append(inputs,send);
 const error=node('p','meta error'),notice=node('p','meta'),loading=node('p','meta');
 error.setAttribute('role','alert');notice.setAttribute('role','status');loading.setAttribute('role','status');
 dialog.append(header,loading,form,error);
 detail.append(notice,resultList,dialog);
 let conceptLookup=null;
 open.addEventListener('click',async()=>{
  if(dialog.open||signal.aborted)return;
  dialog.showModal();
  if(!loadConcepts||concepts.length){name.input.focus();return;}
  form.hidden=true;error.textContent='';loading.textContent='사운드 컨셉을 읽고 있습니다.';
  const lookup=conceptLookup??=Promise.resolve().then(loadConcepts);
  try{
   const rows=await lookup;
   if(signal.aborted||!dialog.open)return;
   concepts=rows;
   setConceptOptions();form.hidden=!concepts.length;
   if(concepts.length)name.input.focus();
   else error.textContent='선택할 수 있는 활성 사운드 컨셉이 없습니다.';
  }catch{
   if(!signal.aborted&&dialog.open)error.textContent='활성 사운드 컨셉을 확인하지 못했습니다. 창을 닫고 다시 열어 주세요.';
  }finally{
   if(lookup===conceptLookup)conceptLookup=null;
   if(dialog.open)loading.textContent='';
  }
 });
 close.addEventListener('click',()=>{if(!working)dialog.close();});
 dialog.addEventListener('cancel',event=>{if(working)event.preventDefault();});
 dialog.addEventListener('close',()=>{if(!signal.aborted)open.focus();});
 signal.addEventListener('abort',()=>{if(dialog.open)dialog.close();},{once:true});
 function update(){
  inputs.disabled=working||intake.uncertain;
  close.disabled=send.disabled=working;
  send.textContent=working?'접수 중…':intake.uncertain?'같은 접수 다시 확인':'BGM 생성 요청';
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(working||!dialog.open||signal.aborted)return;
  working=true;error.textContent='';update();
  try{
   const result=await intake.send(()=>makeAudioPayload({kind:'bgm',title:name.input.value,conceptId:concept.input.value,
    brief:brief.input.value,duration:duration.input.value},concepts));
   if(result&&!signal.aborted){
    intake=createAudioIntake(submit);name.input.value='';concept.input.value='';brief.input.value='';duration.input.value='';
    dialog.close();notice.textContent='요청을 접수했습니다. 요청 ID: '+result.officialRequestId;
    onAccepted(result.officialRequestId);
   }
  }catch(cause){
   if(!signal.aborted)error.textContent=intake.uncertain?'접수 결과를 확인하지 못했습니다. 같은 요청만 다시 확인할 수 있습니다.':
    cause.definitive?'요청을 접수하지 못했습니다. 입력과 접수 권한을 확인해 주세요.':'입력 내용과 선택한 사운드 컨셉을 확인해 주세요.';
  }finally{working=false;update();}
 });
 update();
 return resultList;
}
