import {browserRequestId} from './browser-request-id.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const audioRequestType='audio.generate',schemaVersion='ngs.audio-generate.v1';
export const audioSeparationType='audio.separate',audioSeparationSchema='ngs.audio-separate.v1';
const officialAudioId=/^request\.official\.[a-f0-9]{64}$/u;
const audioSha256=/^[a-f0-9]{64}$/u;
export function validAudioSeparationPayload(value){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')==='projectId,schemaVersion,sourceOfficialRequestId,sourceSha256'&&
  value.schemaVersion===audioSeparationSchema&&value.projectId==='binari'&&
  typeof value.sourceOfficialRequestId==='string'&&value.sourceOfficialRequestId.length===81&&officialAudioId.test(value.sourceOfficialRequestId)&&
  typeof value.sourceSha256==='string'&&value.sourceSha256.length===64&&audioSha256.test(value.sourceSha256);
}
export function audioResultTaskKey(meta,id){
 if(!Object.hasOwn(meta,'separation'))return 'audio_generate';
 const source=meta.separation;
 if(!source||typeof source!=='object'||Array.isArray(source)||
   Object.keys(source).sort().join(',')!=='sourceOfficialRequestId,sourceSha256'||
   source.sourceOfficialRequestId===id||
   !validAudioSeparationPayload({schemaVersion:audioSeparationSchema,projectId:'binari',...source}))return null;
 return 'audio_separate';
}
const kinds=[['bgm','BGM'],['effect','효과음'],['tts','TTS']];
const id=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const receiptId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const definite=new Set(['REQUEST_SUBMIT_INVALID','NGS_AUDIO_GENERATE_PAYLOAD_INVALID',
 'NGS_AUDIO_DELETE_PAYLOAD_INVALID','NGS_AUDIO_SEPARATE_PAYLOAD_INVALID','AUDIO_SEPARATION_UNAVAILABLE',
 'AUDIO_SEPARATION_SOURCE_NOT_FOUND','SPACE_QUEUE_WRITE_NOT_GRANTED','AUDIO_WORKSPACE_UNAVAILABLE','OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT','PROJECT_OR_RESOURCE_DENIED',
 'LOCAL_SIGN_IN_REQUIRED','LOCAL_SESSION_EXPIRED_OR_REVOKED','FRONTEND_SESSION_CONTEXT_CHANGED',
 'CSRF_INVALID','ORIGIN_OR_CSRF_REJECTED']);
const limits=Object.freeze({title:120,brief:4000,conceptText:4000,lyrics:4000});
const directConcept='direct',requestBytes=32*1024;
const baseAudioKeys=['brief','conceptId','durationSeconds','kind','projectId','schemaVersion','text','title'];
const optionalAudioKeys=['conceptText','lyricsRequest','targetDurationSeconds'];

const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
function validText(value,max,multiline=true){
 return typeof value==='string'&&value.isWellFormed()&&value===value.trim()&&value!==''&&[...value].length<=max&&
  !control.test(value)&&(multiline||!/[\r\n\t\u2028\u2029]/u.test(value));
}

function validLyrics(value){
 return typeof value==='string'&&value.isWellFormed()&&value.trim()!==''&&
  [...value].length<=limits.lyrics&&!control.test(value);
}
export function validLocalAudioPayload(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||
    !baseAudioKeys.every(key=>Object.hasOwn(v,key))||
    !Object.keys(v).every(key=>baseAudioKeys.includes(key)||optionalAudioKeys.includes(key))||
    v.schemaVersion!==schemaVersion||v.projectId!=='binari'||v.kind!=='bgm'||
    typeof v.conceptId!=='string'||!id.test(v.conceptId)||
    !validText(v.title,limits.title,false)||!validText(v.brief,limits.brief))return false;
 const direct=v.conceptId===directConcept,hasConceptText=Object.hasOwn(v,'conceptText');
 if(direct!==hasConceptText||direct&&!validText(v.conceptText,limits.conceptText))return false;
 const requested=Object.hasOwn(v,'lyricsRequest');
 if(requested&&(!validText(v.lyricsRequest,limits.lyrics)||v.text!==''))return false;
 if(Object.hasOwn(v,'targetDurationSeconds')&&(v.durationSeconds!==null||v.targetDurationSeconds!==60))return false;
 return v.durationSeconds===null?(v.text===''||validLyrics(v.text)):
  v.text===''&&!requested&&Number.isFinite(v.durationSeconds)&&v.durationSeconds>=10&&v.durationSeconds<=30;
}
export function soundConceptOptions(index){
 if(index?.projectId!=='binari'||index.tab!=='concept'||!Array.isArray(index.groups)||!index.groups.some(group=>group?.id==='group.sound')||
    !Array.isArray(index.items))return [];
 const found=new Set();
 return index.items.flatMap(row=>{
  if(row?.groupId!=='group.sound'||row.archived===true||row.id===directConcept||typeof row.id!=='string'||!id.test(row.id)||
     typeof row.label!=='string'||!row.label.trim()||found.has(row.id))return [];
  found.add(row.id);return [{id:row.id,label:row.label}];
 });
}
export function makeAudioPayload({kind,title,conceptId,brief,duration,targetFullLength=false,conceptText,lyricsRequest,lyricsText},options){
 const v={schemaVersion,projectId:'binari',kind,title:title.trim(),conceptId,brief:brief.trim(),
  text:lyricsText??'',
  durationSeconds:duration===null||typeof duration==='string'&&!duration.trim()?null:Number(duration)};
 if(lyricsText!==undefined&&!validLyrics(lyricsText))throw Error('AUDIO_FORM_INVALID');
 if(conceptText!==undefined)v.conceptText=conceptText.trim();
 if(lyricsRequest!==undefined)v.lyricsRequest=lyricsRequest.trim();
 if(targetFullLength)v.targetDurationSeconds=60;
 if((conceptId!==directConcept&&!options.some(row=>row.id===conceptId))||!validLocalAudioPayload(v))
  throw Error('AUDIO_FORM_INVALID');
 const bytes=new TextEncoder().encode(JSON.stringify({requestType:audioRequestType,idempotencyKey:'x'.repeat(36),payload:v})).length;
 if(bytes>requestBytes)throw Error('AUDIO_FORM_TOO_LARGE');
 return v;
}

export function createAudioIntake(submit,{uuid=()=>browserRequestId(),requestType=audioRequestType}={}){
 let pending=null,busy=false,receipt=null;
 return {
  get uncertain(){return pending!==null&&!receipt;},
  async send(makePayload){
   if(busy||receipt)return null;
   if(!pending)pending={requestType,idempotencyKey:uuid(),payload:makePayload()};
   busy=true;
   try{
    const response=await submit(pending),value=await response.json();
    if(isQueuedRequest(response,value)){receipt=value;return value;}
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
function separationIcon(){
 const ns='http://www.w3.org/2000/svg';
 const svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
 for(const [name,value] of Object.entries({class:'audio-separate-icon',viewBox:'0 0 24 24','aria-hidden':'true',
  fill:'none',stroke:'currentColor','stroke-width':'2','stroke-linecap':'round','stroke-linejoin':'round'}))svg.setAttribute(name,value);
 path.setAttribute('d','M4 12h5c5 0 4-6 9-6h2m-4-3 4 3-4 3M9 12c5 0 4 6 9 6h2m-4-3 4 3-4 3');
 svg.append(path);return svg;
}
function field(label,tag,options){
 const wrapper=node('label','',label),input=Object.assign(node(tag),options);wrapper.append(input);return {wrapper,input};
}
export const audioIndex='/api/audio-workspace?projectId=binari';
const formatter=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:2});
const playlists=new WeakMap(),audioPageSize=30;
function makePlaylist(container,signal,{request,refresh,submitDelete,onDeleteAccepted=()=>{},submitSeparation,onSeparationAccepted=()=>{}}={}){
 const list=node('ol','audio-results-list'),empty=node('p','meta','아직 게시된 BGM이 없습니다.');
 const actions=node('div','audio-playlist-actions'),playSelected=node('button','concept-category-trigger','선택 재생');
 const selectAll=node('button','concept-category-trigger','현재 페이지 전체 선택'),selectionCount=node('span','meta');
 const nav=node('nav','audio-playlist-pages'),previous=node('button','concept-category-trigger','이전'),
  pageStatus=node('span','meta'),next=node('button','concept-category-trigger','다음');
 for(const button of [playSelected,selectAll,previous,next])button.type='button';
 playSelected.disabled=true;actions.append(playSelected,selectAll,selectionCount);actions.hidden=true;
 if(refresh){
  const reload=node('button','concept-category-trigger','목록 새로고침');
  reload.type='button';reload.addEventListener('click',async()=>{
   if(signal?.aborted||reload.disabled)return;
   reload.disabled=true;try{await refresh();}finally{reload.disabled=false;}
  });
  actions.append(reload);
 }
 selectionCount.setAttribute('role','status');nav.setAttribute('aria-label','BGM 목록 페이지');
 pageStatus.setAttribute('role','status');nav.append(previous,pageStatus,next);nav.hidden=true;
 const head=node('div','audio-playlist-columns'+(submitSeparation?' audio-with-separation':''));
 head.setAttribute('aria-hidden','true');
 head.append(node('span'),node('span'),node('span','','제목'),node('span','','BPM'),node('span','','총길이'));
 if(submitSeparation)head.append(node('span'));
 const now=node('div','audio-now-playing'),label=node('p','audio-now-title'),player=node('audio'),error=node('p','meta error');
 player.controls=true;player.preload='none';now.hidden=true;list.hidden=true;head.hidden=true;
 error.setAttribute('role','status');now.append(label,player,error);
 container.replaceChildren(now,actions,head,list,nav,empty);
 const checked=new Set();
 let selected=null,allRows=new Map(),activeButtons=new Map(),page=0,queued=[],playAttempt=0,deleting=false;
 const separations=new Map();
 let pages=[],epoch=0,loading=false,firstSignature=null,pageError='';
 const deletions=new Map(),deleteButton=node('button','concept-category-trigger audio-delete','선택 삭제 요청'),
  deleteSummary=node('p','meta'),dialog=node('dialog','npc-one-stop-dialog audio-dialog'),
  heading=node('h2','','선택한 BGM 삭제'),description=node('p'),targets=node('ul'),
  footer=node('div','audio-delete-actions'),cancel=node('button','','취소'),confirm=node('button','audio-delete','삭제 요청');
 const candidates=()=>{
  const seen=new Set();
  return [...allRows.values()].filter(({row,audioId})=>{
   if(!audioId||!checked.has(row.url)||seen.has(audioId)||deletions.get(audioId)?.state==='registered')return false;
   seen.add(audioId);return true;
  });
 };
 const updateSelection=()=>{
  playSelected.disabled=checked.size===0;
  const current=pages[page]?.rows??[];
  selectAll.disabled=!current.length;
  selectAll.textContent=current.length&&current.every(({row})=>checked.has(row.url))?'현재 페이지 선택 해제':'현재 페이지 전체 선택';
  selectionCount.textContent=checked.size+'곡 선택';
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
   const batch=confirmed.filter(({row})=>allRows.has(row.url));
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
   deleteSummary.textContent=['삭제 요청 저장 '+stats.registered+'곡',stats.rejected?'접수 실패 '+stats.rejected+'곡':'',
    stats.uncertain?'접수 확인 필요 '+stats.uncertain+'곡':''].filter(Boolean).join(' · ')+
    (stats.registered?' · 파일 동기화 후 목록에서 사라집니다.':'');
   updateSelection();
   if(!deleteButton.disabled)deleteButton.focus();
   else if(!playSelected.disabled)playSelected.focus();
   else if(!selectAll.disabled)selectAll.focus();
   if(accepted.length)onDeleteAccepted(accepted);
  });
 }
 playSelected.addEventListener('click',()=>{
  queued=[...allRows.keys()].filter(url=>checked.has(url));
  playNext();
 });
 selectAll.addEventListener('click',()=>{
  if(signal?.aborted)return;
  const current=pages[page]?.rows??[];
  const clear=current.every(({row})=>checked.has(row.url));
  for(const {row} of current){if(clear)checked.delete(row.url);else checked.add(row.url);}
  updateSelection();paint();
 });
 previous.addEventListener('click',()=>{if(!signal?.aborted&&page>0){++epoch;loading=false;pageError='';--page;renderPage();}});
 next.addEventListener('click',async()=>{
  if(signal?.aborted||loading)return;
  if(pages[page+1]){pageError='';++page;renderPage();return;}
  const cursor=pages[page]?.nextCursor;
  if(!cursor||typeof request!=='function')return;
  const attempt=++epoch;
  loading=true;pageError='';renderPage();
  try{
   const nextPage=normalizeAudioPage(await request(audioIndex+'&cursor='+encodeURIComponent(cursor)));
   if(signal?.aborted||epoch!==attempt)return;
   if(nextPage.nextCursor===cursor)throw Error('AUDIO_PAGE_INVALID');
   if(nextPage.rows.length){
    pages.push(nextPage);
    for(const item of nextPage.rows)allRows.set(item.row.url,item);
    ++page;
   }else pages[page]={...pages[page],nextCursor:null};
  }catch{
   if(!signal?.aborted&&epoch===attempt)pageError='다음 페이지를 불러오지 못했습니다.';
  }finally{
   if(!signal?.aborted&&epoch===attempt){loading=false;renderPage();}
  }
 });
 function playNext(){
  if(signal?.aborted)return;
  while(queued.length){
   const row=allRows.get(queued.shift())?.row;
   if(row){select(row,true);return;}
  }
 }
 function paint(){
  for(const [url,{button,item,title,audioId,deleteStatus,separate,separateStatus,check}] of activeButtons){
   const current=selected===url,playing=current&&!player.paused&&!player.ended;
   item.classList.toggle('audio-result-current',current);
   button.textContent=playing?'❚❚':'▶';
   button.setAttribute('aria-label',title+(playing?' 일시 정지':' 재생'));
   button.setAttribute('aria-pressed',String(current));
   const deletion=deletions.get(audioId)?.state;
   if(deleteStatus){
    deleteStatus.textContent={registered:'삭제 요청 저장됨',rejected:'삭제 접수 실패',uncertain:'접수 확인 필요'}[deletion]??'';
    deleteStatus.hidden=!deleteStatus.textContent;
   }
   if(separate){
    const state=separations.get(url)?.state;
    separate.disabled=state==='pending'||state==='queued';
    const action=state==='uncertain'?'같은 접수 다시 확인':'보컬 분리 요청';
    separate.title=action;separate.setAttribute('aria-label',title+' '+action);
    separateStatus.textContent={pending:'반주 요청 접수 중…',queued:'반주 요청 저장됨',rejected:'반주 요청을 접수하지 못했습니다.',
     uncertain:'접수 확인 필요'}[state]??'';
    separateStatus.hidden=!separateStatus.textContent;
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
 function renderPage(){
  const start=page*audioPageSize,rows=pages[page]?.rows??[];
  const nextButtons=new Map(),entries=[];
  for(const {row,audioId} of rows){
   const item=node('li','audio-result'+(submitSeparation?' audio-with-separation':'')),button=node('button','audio-play', '▶'),check=node('input','audio-select');
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
   const deleteStatus=submitDelete?node('span','audio-delete-status'):null;
   const source=submitSeparation&&row.separated!==true?audioSeparationSource(row):null;
   const separate=source?node('button','audio-separate'):null;
   const separateStatus=separate?node('span','audio-separate-status'):null;
   const separateSlot=submitSeparation?node('span','audio-separate-slot'):null;
   if(separate){
    separate.type='button';
    separate.append(separationIcon());separateSlot.append(separate);
    separateStatus.setAttribute('role','status');separateStatus.hidden=true;
    separate.addEventListener('click',async()=>{
     if(signal?.aborted||!allRows.has(row.url))return;
     let op=separations.get(row.url);
     if(op?.state==='pending'||op?.state==='queued')return;
     if(!op){op={intake:createAudioIntake(submitSeparation,{requestType:audioSeparationType})};separations.set(row.url,op);}
     op.state='pending';paint();
     let receipt;
     try {receipt=await op.intake.send(()=>source);op.state='queued';}
     catch(error){op.state=error.definitive?'rejected':'uncertain';}
     if(signal?.aborted)return;
     paint();
     if(receipt)onSeparationAccepted(receipt);
    });
   }
   let song=title;
   if(deleteStatus||separate){
    song=node('span','audio-track-song'+(separate?' audio-track-separable':''));song.append(title);
    if(deleteStatus)song.append(deleteStatus);
    if(separateStatus)song.append(separateStatus);
   }
   item.append(check,button,song,bpm,duration);
   if(separateSlot)item.append(separateSlot);
   nextButtons.set(row.url,{button,item,title:row.title,row,audioId,deleteStatus,separate,separateStatus,check});entries.push(item);
  }
  activeButtons=nextButtons;
  list.replaceChildren(...entries);
  updateSelection();
  list.hidden=head.hidden=entries.length===0;actions.hidden=entries.length===0&&!refresh;
  empty.hidden=entries.length!==0;empty.textContent='아직 게시된 BGM이 없습니다.';
  const more=!!pages[page+1]||!!pages[page]?.nextCursor;
  nav.hidden=page===0&&!more&&!pageError;previous.disabled=page===0;next.disabled=loading||!more;
  pageStatus.textContent=loading?'다음 페이지를 읽고 있습니다.':pageError||
   (entries.length?(page+1)+' 페이지 · '+(start+1)+'–'+(start+entries.length)+'곡':'');
  paint();
 }
 return (data,{force=false,removed=[]}={})=>{
  if(signal?.aborted)return;
  if(data===null){empty.textContent='게시된 BGM을 읽고 있습니다.';return;}
  const first=normalizeAudioPage(data),signature=JSON.stringify(data);
  if(!force&&firstSignature===signature)return;
  firstSignature=signature;++epoch;loading=false;pageError='';page=0;pages=[first];
  allRows=new Map(first.rows.map(item=>[item.row.url,item]));
  for(const url of checked)if(!allRows.has(url))checked.delete(url);
  queued=queued.filter(url=>allRows.has(url));
  if(selected&&(removed.includes(publishedAudioId({url:selected}))||first.nextCursor===null&&!allRows.has(selected)))releasePlayer();
  renderPage();
 };
}
function normalizeAudioPage(data){
 if(data?.projectId!=='binari'||!Array.isArray(data.results)||data.results.length>audioPageSize||
    !(data.nextCursor===null||typeof data.nextCursor==='string'&&data.nextCursor.startsWith('a1')&&data.nextCursor.length<=2048))
  throw Error('AUDIO_PAGE_INVALID');
 const rows=new Map();
 for(const row of data.results){
  if(typeof row?.title!=='string'||typeof row.url!=='string'||!row.url.startsWith(audioIndex+'&id=')||
     !Number.isFinite(row.durationSeconds)||row.durationSeconds<=0||rows.has(row.url))continue;
  rows.set(row.url,{row,audioId:publishedAudioId(row)});
 }
 return {rows:[...rows.values()],nextCursor:data.nextCursor};
}
export function showAudioResults(container,data,signal,options,refreshOptions){
 let display=playlists.get(container);
 if(!display){display=makePlaylist(container,signal,options);playlists.set(container,display);}
 display(data,refreshOptions);
}

export async function refreshAudioResults({post,request,signal,display}){
 const scope='binari/audio',read=()=>request(audioIndex);let available=false;
 try{const initial=await read();if(!signal.aborted){display(initial);available=true;}}catch{/* Try refreshing the exact audio scope. */}
 if(signal.aborted)return;
 const comparison=await post('compare',{scope});
 if(signal.aborted)return;
 let applied=false,failed=!!comparison.unavailable?.length;
 for(const {folder} of comparison.groups){
  if(signal.aborted)return;
  try{await post('refresh',{scope,folder});applied=true;}catch{failed=true;}
 }
 if(!signal.aborted&&(applied||!available)){const next=await read();if(!signal.aborted)display(next);}
 if(failed)throw Error('AUDIO_RESULT_SYNC_UNAVAILABLE');
}

const refreshDelay=60_000,maxAcceptedChecks=10;
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
function audioSeparationSource(row){
 if(typeof row?.url!=='string'||!row.url.startsWith(audioIndex+'&id='))return null;
 const [sourceOfficialRequestId,sourceSha256,...extra]=row.url.slice((audioIndex+'&id=').length).split('&sha256=');
 const payload={schemaVersion:audioSeparationSchema,projectId:'binari',sourceOfficialRequestId,sourceSha256};
 return !extra.length&&validAudioSeparationPayload(payload)?payload:null;
}
const publishedAudioId=row=>audioSeparationSource(row)?.sourceOfficialRequestId??null;
async function exactPublishedAudio(request,id){
 const value=await request(audioIndex+'&resultId='+encodeURIComponent(id));
 if(value?.projectId!=='binari'||!(value.result===null||publishedAudioId(value.result)===id))
  throw Error('AUDIO_RESULT_INVALID');
 return value.result;
}
export async function followDeletedAudioResults({ids,post,request,signal,onChanged,wait=untilNextAudioCheck}){
 const pending=new Set(ids.filter(id=>typeof id==='string'&&officialAudioId.test(id)));
 for(let check=0;pending.size&&check<maxAcceptedChecks;check++){
  if(!await wait(signal,check===0?5000:refreshDelay)||signal.aborted)return false;
  try{
   const scope='binari/audio',comparison=await post('compare',{scope});
   for(const group of comparison.groups){
    if(signal.aborted)return false;
    if(pending.has(group.folder))await post('refresh',{scope,folder:group.folder});
   }
  }catch{/* A receipt does not guarantee publication. */}
  const removed=[];
  for(const id of pending){
   if(signal.aborted)return false;
   try{if(await exactPublishedAudio(request,id)===null&&!signal.aborted){pending.delete(id);removed.push(id);}}
   catch{/* A failed exact read is not evidence of deletion. */}
  }
  if(removed.length&&!signal.aborted)try{await onChanged(removed);}catch{for(const id of removed)pending.add(id);}
 }
 return !pending.size;
}
export async function followAcceptedAudioResult({id,post,request,signal,onChanged,wait=untilNextAudioCheck}){
 if(typeof id!=='string'||!officialAudioId.test(id)||signal.aborted)return false;
 const scope='binari/audio/'+id;
 async function found(){
  try{
   const row=await exactPublishedAudio(request,id);
   if(!signal.aborted&&row){await onChanged();return true;}
  }catch{/* Keep the published view until the exact result is available. */}
  return false;
 }
 for(let check=0;check<maxAcceptedChecks;check++){
  if(!await wait(signal,refreshDelay)||signal.aborted)return false;
  if(await found())return true;
  try{
   const comparison=await post('compare',{scope});
   if(signal.aborted)return false;
   if(comparison.groups.some(row=>row.folder==='')){
    await post('refresh',{scope,folder:''});
    if(!signal.aborted&&await found())return true;
   }
  }catch{/* A transient sync error does not change the official receipt. */}
 }
 return false;
}

export function mountAudioWorkspace({items,detail,concepts=[],loadConcepts,signal,submit,allowFullLength=true,onAccepted=()=>{}}){
 let working=false,intake=createAudioIntake(submit);
 const resultList=node('section','audio-results');
 resultList.setAttribute('aria-label','게시된 BGM');
 const toolbar=node('div','audio-playlist-toolbar'),title=node('h3','','BGM');
 const open=node('button','concept-category-trigger audio-add','+');open.type='button';
 open.setAttribute('aria-label','BGM 생성 요청');open.setAttribute('aria-haspopup','dialog');open.title='BGM 생성 요청';
 open.disabled=typeof submit!=='function';toolbar.append(title,open);
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
 const empty=node('option','','카테고리를 선택하세요');empty.value='';
 const direct=node('option','','직접 입력');direct.value=directConcept;
 function setConceptOptions(){
  const selected=concept.input.value;
  const choices=concepts.filter(row=>row.id!==directConcept);
  concept.input.replaceChildren(empty,...choices.map(row=>Object.assign(node('option','',row.label),{value:row.id})),direct);
  concept.input.value=selected===directConcept||choices.some(row=>row.id===selected)?selected:'';
 }
 setConceptOptions();
 const conceptText=field('사운드 컨셉 직접 입력','textarea',{maxLength:limits.conceptText});
 const brief=field('제작 설명','textarea',{required:true,maxLength:limits.brief});
 const duration=field('길이 (초, 선택)','input',{type:'number',min:10,max:30,step:'any',placeholder:'비우면 모델이 결정'});
 const full=allowFullLength?field('완곡 (60초 이상 목표)','input',{type:'checkbox'}):null;
 const vocals=field('가사 입력','input',{type:'checkbox',checked:false});
 const directLyrics=field('가사 직접 입력','input',{type:'checkbox',checked:false});
 const lyricsRequest=field('가사 제작 요청','textarea',{maxLength:limits.lyrics});
 const lyrics=field('가사 원문','textarea',{maxLength:limits.lyrics});
 function toggle(field,enabled){
  field.wrapper.hidden=!enabled;field.input.disabled=!enabled;field.input.required=enabled;
 }
 function updateModes(){
  const vocal=vocals.input.checked,verbatim=directLyrics.input.checked;
  toggle(conceptText,concept.input.value===directConcept);
  directLyrics.wrapper.hidden=!vocal;directLyrics.input.disabled=!vocal;
  toggle(lyricsRequest,vocal&&!verbatim);toggle(lyrics,vocal&&verbatim);
  duration.input.disabled=vocal||full?.input.checked===true;
 }
 fields.append(name.wrapper,concept.wrapper,conceptText.wrapper,brief.wrapper,vocals.wrapper,directLyrics.wrapper,
  lyricsRequest.wrapper,lyrics.wrapper,duration.wrapper);
 if(full){
  full.input.title='60초 이상인 완곡을 목표로 하며, 정확한 길이는 작곡 모델이 정합니다.';
  full.input.addEventListener('change',()=>{
   if(full.input.checked)duration.input.value='';
   updateModes();
  });
  fields.append(full.wrapper);
 }
 for(const input of [concept.input,vocals.input,directLyrics.input])input.addEventListener('change',updateModes);
 updateModes();
 inputs.append(fields);
 const send=node('button','concept-category-trigger','BGM 생성 요청');send.type='submit';form.append(inputs,send);
 const error=node('p','meta error'),notice=node('p','meta'),loading=node('p','meta');
 error.setAttribute('role','alert');notice.setAttribute('role','status');loading.setAttribute('role','status');
 dialog.append(header,loading,form,error);
 detail.append(notice,resultList,dialog);
 let conceptLookup=null;
 open.addEventListener('click',async()=>{
  if(dialog.open||signal.aborted)return;
  dialog.showModal();name.input.focus();
  if(!loadConcepts||concepts.length)return;
  error.textContent='';loading.textContent='저장된 사운드 컨셉을 읽고 있습니다.';
  const lookup=conceptLookup??=Promise.resolve().then(loadConcepts);
  try{
   const rows=await lookup;
   if(signal.aborted||!dialog.open)return;
   concepts=rows;
   setConceptOptions();updateModes();
  }catch{
   if(!signal.aborted&&dialog.open)
    error.textContent='저장된 사운드 컨셉을 확인하지 못했습니다. 직접 입력하거나 창을 닫고 다시 열어 주세요.';
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
   const vocal=vocals.input.checked,verbatim=directLyrics.input.checked,directSound=concept.input.value===directConcept;
   const result=await intake.send(()=>makeAudioPayload({kind:'bgm',title:name.input.value,conceptId:concept.input.value,
    brief:brief.input.value,duration:vocal||full?.input.checked===true?null:duration.input.value,
    targetFullLength:full?.input.checked===true,conceptText:directSound?conceptText.input.value:undefined,
    ...(vocal?(verbatim?{lyricsText:lyrics.input.value}:{lyricsRequest:lyricsRequest.input.value}):{})},concepts));
   if(result&&!signal.aborted){
    intake=createAudioIntake(submit);
    for(const f of [name,concept,conceptText,brief,duration,lyricsRequest,lyrics])f.input.value='';
    vocals.input.checked=directLyrics.input.checked=false;
    if(full)full.input.checked=false;
    updateModes();dialog.close();notice.textContent=result.status==='queued'?'NGS 대기열에 저장했습니다.':'요청을 접수했습니다. 요청 ID: '+result.officialRequestId;
    if(result.officialRequestId)onAccepted(result.officialRequestId);
   }
  }catch(cause){
   if(!signal.aborted)error.textContent=cause.message==='AUDIO_FORM_TOO_LARGE'?'요청 내용이 너무 깁니다. 입력 분량을 줄여 주세요.':intake.uncertain?'접수 결과를 확인하지 못했습니다. 같은 요청만 다시 확인할 수 있습니다.':
    cause.definitive?'요청을 접수하지 못했습니다. 입력과 접수 권한을 확인해 주세요.':'입력 내용과 선택한 사운드 컨셉을 확인해 주세요.';
  }finally{working=false;update();}
 });
 update();
 return resultList;
}
