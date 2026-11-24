import {propPayload,propTypes,propWorkspacePath,propSlug,validPropPayload} from './prop-workspace-contract.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
const api=fields=>propWorkspacePath+'?'+new URLSearchParams({projectId:'binari',...fields});
const actionsLabel={generate:'프랍 종합 생성 요청',regenerate:'재생성 요청',animation:'애니메이션 생성 요청'};
const errors={
 PROP_WORKSPACE_SOURCE_STALE:'게시 버전이 바뀌었습니다. 목록에서 프랍을 다시 열어 주세요.',
 PROP_WORKSPACE_TARGET_EXISTS:'해당 폴더 이름은 이미 사용 중입니다.',
 PROP_WORKSPACE_MOTION_EXISTS:'같은 이름의 애니메이션이 이미 있습니다.',
 PROP_DESIGN_PIN_STALE:'설계 기준이 바뀌었습니다. 내용을 확인해 다시 요청해 주세요.',
 PROP_WORKSPACE_ACTION_UNAVAILABLE:'이 요청은 현재 접수할 수 없습니다.',
};
function field(label,input){
 const wrap=node('label',label,'prop-form-field');wrap.append(input);return wrap;
}
function input(text,max){
 const n=node('input');n.required=true;n.maxLength=max;if(text)n.placeholder=text;return n;
}
function textarea(label,max){
 const n=node('textarea');n.required=true;n.maxLength=max;n.rows=5;n.placeholder=label;return n;
}
function verifiedURL(m){
 if(typeof m?.url!=='string'||!m.url.startsWith(propWorkspacePath+'?')||!['image/png','image/apng'].includes(m.mediaType))return null;
 return m.url;
}
function staticImage(media,label){
 const src=verifiedURL(media);
 if(!src||media.mediaType!=='image/png')return node('p','이미지 미게시','meta');
 const img=node('img');img.src=src;img.alt=label;img.loading='lazy';img.decoding='async';return img;
}
function animationPreview(clip,lane){
 const frame=node('div',null,'prop-animation-preview'),m=clip.media?.[lane],src=verifiedURL(m);
 if(!src||m.mediaType!=='image/apng')return frame;
 const label=lane==='detail'?'디테일':'픽셀',button=node('button',label+' 재생','prop-control');
 button.type='button';const image=node('span');frame.append(button,image);
 button.addEventListener('click',()=>{
  const img=node('img');img.src=src;img.alt=clip.title+' '+label;img.decoding='async';image.replaceChildren(img);
 });
 return frame;
}

export async function mountPropWorkspace({items,detail,tools,item,propTab,propAnimation,navigate,request,submit,removeAnimations,actions=[],signal}){
 const can=action=>typeof submit==='function'&&actions.includes(action);
 const tab=propTab==='animation'?'animation':'basic';
 const sectionUrl=(id,key=tab,clip)=>navigate({item:id,propTab:key==='animation'?'animation':'',propAnimation:key==='animation'&&clip?clip:''});
 items.parentElement.classList.add('npc-roster-list','prop-roster');
 detail.classList.add('npc-detail','prop-detail');
 const pageStatus=node('p',null,'meta prop-request-status');pageStatus.setAttribute('role','status');
 let selected=null;
 const data=await request(api({}));
 if(signal?.aborted)return;
 if(!Array.isArray(data?.props))throw Error('PROP_WORKSPACE_INVALID');
 if(can('generate')){
  const add=node('button','+','npc-one-stop-trigger');add.type='button';
  add.setAttribute('aria-label','프랍 생성');add.title='프랍 생성';
  add.addEventListener('click',()=>open('generate'));tools.replaceChildren(add);tools.hidden=false;
 }
 const rows=data.props;
 items.replaceChildren(...rows.map(row=>{
  const entry=node('li'),link=node('a',null,'request-item npc-roster-entry');
  link.href=sectionUrl(row.propId);if(item===row.propId)link.setAttribute('aria-current','page');
  link.append(node('strong',row.title),node('span',row.propId,'meta'));entry.append(link);return entry;
 }));
 if(rows.length===0)items.append(node('li','게시된 프랍이 없습니다.','meta'));
 if(!item||!propSlug(item)||!rows.some(row=>row.propId===item)){
  const header=node('header',null,'npc-detail-heading');
  header.append(node('h3','프랍 설계'));
  const body=node('section',null,'npc-tab-panel');
  body.append(node('p',item?'선택한 프랍 폴더가 없습니다.':'왼쪽 목록에서 프랍을 선택하세요.','meta'),pageStatus);
  detail.replaceChildren(header,body);
  return;
 }
 const {prop}=await request(api({propId:item}));
 if(signal?.aborted)return;
 if(prop?.propId!==item)throw Error('PROP_WORKSPACE_INVALID');
 selected=prop;
 const bar=node('header',null,'npc-detail-heading prop-detail-heading');
 const heading=node('div',null,'prop-identity'),badges=node('div',null,'npc-character-badges');
 badges.append(node('span',item),node('span','버전 '+prop.source.revision));
 heading.append(node('h3',prop.title),badges);bar.append(heading);
 if(tab==='basic'&&can('regenerate'))bar.append(actionButton('regenerate'));
 const tabs=node('nav',null,'npc-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','프랍 상세 영역');
 const links=[['basic','기본 정보'],['animation','애니메이션']].map(([key,label],i,choices)=>{
  const link=node('a',label);link.id='prop-tab-'+key;link.href=sectionUrl(item,key);
  link.setAttribute('role','tab');link.setAttribute('aria-selected',String(key===tab));
  link.setAttribute('aria-controls','prop-tab-panel');link.tabIndex=key===tab?0:-1;
  link.addEventListener('keydown',event=>{
   const next=event.key==='ArrowRight'?(i+1)%choices.length:event.key==='ArrowLeft'?(i+choices.length-1)%choices.length
    :event.key==='Home'?0:event.key==='End'?choices.length-1:null;
   if(next!==null){event.preventDefault();links[next].click();}
  });
  return link;
 });
 tabs.append(...links);
 const panel=node('section',null,'npc-tab-panel prop-tab-panel');
 panel.id='prop-tab-panel';panel.tabIndex=0;
 panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby','prop-tab-'+tab);
 detail.replaceChildren(bar,tabs,panel);
 panel.append(pageStatus);
 if(tab==='basic')showBasic(panel,prop);
 else showAnimations(panel,prop);

 function actionButton(action){
  const button=node('button',actionsLabel[action],'prop-control');button.type='button';
  button.addEventListener('click',()=>open(action));return button;
 }
 function showBasic(panel,prop){
  const card=node('section',null,'prop-surface');
  card.append(node('h4','프랍 이미지','npc-media-heading'));
  const preview=node('div',null,'prop-preview-pair');
  for(const [lane,label] of [['detail','디테일'],['pixel','픽셀']]){
   const figure=node('figure',null,'npc-portrait-card'),art=node('div',null,'npc-portrait-art');
   art.append(staticImage(prop.media?.[lane],prop.title+' '+label));
   figure.append(art,node('figcaption',label));preview.append(figure);
  }
  card.append(preview);panel.append(card);
  if(prop.interaction?.pixelOpen||prop.interaction?.detailTrigger){
   const interaction=node('section',null,'prop-surface prop-interaction');
   interaction.append(node('h4','상호작용','npc-media-heading'));
   if(prop.interaction.pixelOpen)interaction.append(node('p','픽셀 보기: 열기','meta'));
   if(prop.interaction.detailTrigger)interaction.append(node('p','디테일 보기: 작동','meta'));
   panel.append(interaction);
  }
 }
 function showAnimations(panel,prop){
  const heading=node('div',null,'prop-panel-heading');
  heading.append(node('h4','애니메이션','npc-media-heading'));
  if(can('animation'))heading.append(actionButton('animation'));
  panel.append(heading);
  const seen=new Set();
  const clips=(Array.isArray(prop.animations)?prop.animations:[]).filter(clip=>{
   if(!propSlug(clip?.id)||seen.has(clip.id)||typeof clip.title!=='string'||!clip.title.trim()||
      !['detail','pixel'].every(lane=>clip.media?.[lane]?.mediaType==='image/apng'&&verifiedURL(clip.media[lane])))return false;
   seen.add(clip.id);return true;
  });
  if(!clips.length){
   const empty=node('div',null,'prop-surface');
   empty.append(node('p','게시된 애니메이션이 없습니다.','meta'));
   panel.append(empty);return;
  }
  const active=clips.find(row=>row.id===propAnimation)??clips[0];
  const list=node('ul',null,'prop-animation-list'),controls=node('div',null,'prop-animation-selection');
  list.setAttribute('aria-label','프랍 애니메이션 목록');
  const all=node('button','전체 선택','prop-control'),remove=node('button','선택 삭제 요청','prop-control prop-animation-delete');
  const count=node('span',null,'meta');count.setAttribute('role','status');
  all.type=remove.type='button';
  controls.append(all,remove,count);panel.append(controls,list);
  const checked=new Set(),queued=new Set(),rows=new Map();
  const removable=typeof removeAnimations==='function';
  let deleting=false;
  function update(){
   const selectable=clips.filter(x=>!queued.has(x.id));
   all.disabled=deleting||selectable.length===0;
   all.textContent=selectable.length&&selectable.every(x=>checked.has(x.id))?'전체 선택 해제':'전체 선택';
   remove.disabled=!removable||deleting||checked.size===0||checked.size>30;
   count.textContent=checked.size+'개 선택'+(checked.size>30?' · 한 번에 30개까지 제거할 수 있습니다.':'');
   for(const [id,{check,badge}] of rows){
    check.checked=checked.has(id);check.disabled=deleting||queued.has(id);
    badge.hidden=!queued.has(id);
   }
  }
  if(!removable)remove.title='현재 삭제 요청을 접수할 수 없습니다.';
  for(const clip of clips){
   const row=node('li',null,'prop-animation-row'),check=node('input'),link=node('a',null,'prop-animation-row-title');
   check.type='checkbox';check.setAttribute('aria-label',clip.title+' 선택');
   check.addEventListener('change',()=>{
    if(deleting||queued.has(clip.id)||signal?.aborted)return;
    if(check.checked)checked.add(clip.id);else checked.delete(clip.id);
    update();
   });
   link.href=sectionUrl(item,'animation',clip.id);
   link.append(node('strong',clip.title),node('span',clip.id,'meta'));
   if(clip.id===active.id){row.className+=' prop-animation-row-current';link.setAttribute('aria-current','page');}
   const badge=node('span','삭제 요청됨','meta');
   badge.hidden=true;link.append(badge);
   const pair=node('div',null,'prop-preview-pair prop-animation-row-preview');
   pair.append(animationPreview(clip,'detail'),animationPreview(clip,'pixel'));
   row.append(check,link,pair);list.append(row);rows.set(clip.id,{check,badge});
  }
  all.addEventListener('click',()=>{
   if(signal?.aborted||all.disabled)return;
   const active=clips.filter(x=>!queued.has(x.id)),clear=active.every(x=>checked.has(x.id));
   for(const {id} of active){if(clear)checked.delete(id);else checked.add(id);}
   update();
  });
  update();
  if(!removable)return;

  const modal=node('dialog',null,'prop-workspace-dialog'),title=node('h3','선택한 애니메이션 삭제'),
   message=node('p'),names=node('ul'),footer=node('div',null,'prop-actions'),
   cancel=node('button','취소','prop-control'),confirm=node('button','삭제 요청','prop-control prop-animation-delete');
  title.id='prop-animation-removal-title';modal.setAttribute('aria-labelledby',title.id);
  cancel.type=confirm.type='button';footer.append(cancel,confirm);modal.append(title,message,names,footer);
  panel.append(modal);
  let confirmed=[];
  remove.addEventListener('click',()=>{
   if(remove.disabled||modal.open||signal?.aborted)return;
   confirmed=clips.filter(x=>checked.has(x.id)&&!queued.has(x.id));
   if(!confirmed.length)return;
   message.textContent='선택한 '+confirmed.length+'개 애니메이션의 삭제를 요청할까요?';
   names.replaceChildren(...confirmed.map(x=>node('li',x.title)));
   modal.showModal();cancel.focus();
  });
  cancel.addEventListener('click',()=>modal.close());
  modal.addEventListener('close',()=>{if(!signal?.aborted&&!remove.disabled)remove.focus();});
  signal?.addEventListener('abort',()=>{if(modal.open)modal.close();},{once:true});
  confirm.addEventListener('click',async()=>{
   if(!modal.open||deleting||signal?.aborted||!confirmed.length)return;
   const animationIds=confirmed.map(x=>x.id);
   deleting=true;update();modal.close();pageStatus.textContent='삭제 요청을 확인 중입니다.';
   try{
    const result=await removeAnimations({propId:prop.propId,source:{revision:prop.source.revision,sha256:prop.source.sha256},animationIds},{signal});
    if(signal?.aborted)return;
    if(result?.accepted!==true)throw Error('PROP_ANIMATION_DELETE_NOT_CONFIRMED');
    for(const id of animationIds){queued.add(id);checked.delete(id);}
    pageStatus.textContent=animationIds.length+'개 삭제 요청을 접수했습니다. 파일 동기화 후 목록에 반영됩니다.';
   }catch{
    if(!signal?.aborted)pageStatus.textContent='삭제 요청 접수를 확인하지 못했습니다. 애니메이션 목록은 그대로입니다.';
   }finally{
    deleting=false;
    if(!signal?.aborted){update();if(!remove.disabled)remove.focus();else if(!all.disabled)all.focus();}
   }
  });
 }

 function open(action){
  if(!can(action)||action!=='generate'&&!selected)return;
  const original=selected;
  const modal=node('dialog',null,'prop-workspace-dialog'),form=node('form');
  const heading=node('h3',actionsLabel[action]);const ariaId='prop-action-'+crypto.randomUUID();
  heading.id=ariaId;modal.setAttribute('aria-labelledby',ariaId);form.append(heading);
  if(original&&action!=='generate')form.append(node('p',original.title+' · 버전 '+original.source.revision,'meta'));
  const id=action==='generate'?input('예: paper-collar-candle',80):null;
  const motionId=action==='animation'?input('예: candle-flicker',80):null;
  const intent=textarea(action==='animation'?'어떻게 움직이는지 적어 주세요.':'용도, 형태, 상태 또는 바꿀 내용을 적어 주세요.',action==='animation'?2000:4000);
  if(id)form.append(field('프랍 폴더 이름',id));
  if(action==='regenerate')form.append(node('p','완성된 새 프랍으로 교체합니다. 이전 버전은 보존되며, 기존 애니메이션은 새 버전에 자동으로 가져오지 않습니다.','meta'));
  if(motionId)form.append(field('애니메이션 이름',motionId));
  form.append(field(action==='animation'?'움직임 프롬프트':'요청 내용',intent));
  const info=node('p',null,'meta');info.setAttribute('role','status');
  const footer=node('div',null,'prop-actions'),cancel=node('button','닫기','prop-control'),send=node('button','요청 보내기','prop-control prop-primary-control');
  cancel.type='button';send.type='submit';footer.append(cancel,send);form.append(info,footer);modal.append(form);
  const abort=()=>modal.close();
  signal?.addEventListener('abort',abort,{once:true});
  modal.addEventListener('close',()=>{signal?.removeEventListener('abort',abort);modal.remove();},{once:true});
  cancel.addEventListener('click',()=>modal.close());
  document.body.append(modal);modal.showModal();(id??motionId??intent).focus();
  let pending;
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(send.disabled)return;
   send.disabled=true;info.textContent='요청을 확인 중입니다.';
   try{
    const propId=id?id.value.trim():original.propId;
    const type=propTypes[action],body={propId};
    if(action!=='generate')body.source=original.source;
    if(action==='animation')Object.assign(body,{motionId:motionId.value.trim(),prompt:intent.value.trim()});
    else {
     body.intent=intent.value.trim();
     body.motion='still';
     body.designContextSha256=(await request(api({view:'design'}))).designContextSha256;
    }
    if(signal?.aborted||!modal.open)return;
    const payload=propPayload(action,body);
    if(!validPropPayload(type,payload)){info.textContent='이름과 요청 내용을 확인해 주세요. 이름은 영문 소문자·숫자와 구분자를 사용하세요.';return;}
    const fingerprint=JSON.stringify(payload);
    if(!pending||pending.fingerprint!==fingerprint)pending={fingerprint,key:crypto.randomUUID()};
    const response=await submit({requestType:type,idempotencyKey:pending.key,payload});
    const result=await response.json().catch(()=>null);
    if(signal?.aborted)return;
    if(!isQueuedRequest(response,result)){info.textContent=errors[result?.error]??'접수를 확인하지 못했습니다.';return;}
    pageStatus.textContent='대기열에 추가했습니다. 게시 완료는 아닙니다.';
    modal.close();
   }catch{if(!signal?.aborted)info.textContent='원본을 확인하거나 요청을 접수하지 못했습니다.';}
   finally{send.disabled=false;}
  });
 }
}
