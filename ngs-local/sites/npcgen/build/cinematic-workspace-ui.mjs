import {cinematicPath,cinematicSchema,cinematicType,cinematicHash,cinematicId,validCinematicPayload} from './cinematic-contract.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const make=(tag,text,css)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(css)el.className=css;return el;};
const url=(projectId,values={})=>cinematicPath+'?'+new URLSearchParams({projectId,...values});
const short=id=>id.slice(-10);
export async function mountCinematicWorkspace({items,detail,request,submit,projectId,item,navigate,signal,enabled}){
 const data=await request(url(projectId));
 if(signal.aborted)return;
 if(!Array.isArray(data.sources)||!data.sources.every(cinematicHash)||!Array.isArray(data.clips)||!data.clips.every(cinematicId))throw Error('CINEMATIC_INDEX_INVALID');
 const rows=data.clips.map(id=>{
  const a=make('a','시네마틱 '+short(id),'workspace-nav-item');a.href=navigate({item:id});
  if(id===item)a.setAttribute('aria-current','page');return a;
 });
 items.replaceChildren(...(rows.length?rows:[make('p','아직 게시된 영상이 없습니다.','meta')]));
 detail.replaceChildren(make('h3','시네마틱 영상'),make('p','시놉시스 이미지 한 장에서 무음 MP4 한 편을 생성합니다. 배경 제거는 하지 않습니다.','meta'));
 const refresh=make('a','영상 목록 새로고침');refresh.href=navigate(item?{item}:{});detail.append(refresh);
 if(data.clips.includes(item)){
  const {clip}=await request(url(projectId,{clip:item}));
  if(signal.aborted)return;
  const video=make('video');video.controls=true;video.playsInline=true;video.preload='metadata';
  video.style.maxWidth='100%';video.src=url(projectId,{clip:item,video:'1'});video.setAttribute('aria-label','시네마틱 '+short(item));
  const link=make('a','MP4 다운로드');link.href=video.src;link.download='cinematic-'+short(item)+'.mp4';
  detail.append(video,link,make('p',Math.round(100*clip.frameCount/clip.fps)/100+'초 · '+clip.width+'×'+clip.height,'meta'));
 }
 if(!enabled||typeof submit!=='function'){
  detail.append(make('p','영상 생성 요청은 아직 이 환경에서 활성화되지 않았어요.','meta'));return;
 }
 if(!data.sources.length){
  detail.append(make('p','프로젝트에 등록된 시놉시스 PNG가 없습니다.','meta'));return;
 }
 const form=make('form',null,'workspace-detail-form'),label=make('label','시놉시스 이미지'),select=make('select'),
  image=make('img'),motionLabel=make('label','영상 연출 지시'),motion=make('textarea'),button=make('button','영상 생성 요청'),status=make('p',null,'meta');
 for(const id of data.sources){const o=make('option','원본 '+short(id));o.value=id;select.append(o);}
 image.alt='시놉시스 원본';image.loading='lazy';image.style.maxWidth='min(100%, 360px)';
 motion.required=true;motion.rows=4;motion.maxLength=1000;motion.placeholder='예: 저고리가 천천히 펼쳐지고 방의 먹선이 흐려진다.';
 status.setAttribute('role','status');button.type='submit';label.append(select);motionLabel.append(motion);
 const preview=()=>{image.src=url(projectId,{source:select.value});};select.addEventListener('change',preview,{signal});preview();
 form.append(label,image,motionLabel,button,status);detail.append(form);
 let key,sent=false;
 form.addEventListener('input',()=>{key=undefined;sent=false;button.disabled=false;status.textContent='';},{signal});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||sent)return;
  const payload={schemaVersion:cinematicSchema,projectId,sourceSha256:select.value,motionPrompt:motion.value.trim()};
  if(!validCinematicPayload(payload)){status.textContent='이미지와 연출 지시를 확인해 주세요.';return;}
  key??=crypto.randomUUID();button.disabled=true;select.disabled=true;motion.disabled=true;
  try{
   const response=await submit({requestType:cinematicType,idempotencyKey:key,payload});
   if(!isQueuedRequest(response,await response.json()))throw Error('CINEMATIC_QUEUE_UNCONFIRMED');
   if(signal.aborted)return;sent=true;
   status.textContent='요청을 대기열에 넣었어요. 게시가 끝나면 목록을 새로고침해 확인할 수 있습니다.';
  }catch{if(!signal.aborted)status.textContent='접수를 확인하지 못했어요. 다시 시도해 주세요.';}
  finally{if(!signal.aborted){button.disabled=sent;select.disabled=false;motion.disabled=false;}}
 },{signal});
}
