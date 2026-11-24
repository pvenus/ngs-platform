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
function select(options){
 const n=node('select');for(const [value,label] of options){const opt=node('option',label);opt.value=value;n.append(opt);}return n;
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
  const img=node('img');img.src=src;img.alt=clip.title+' '+label;image.replaceChildren(img);
 });
 return frame;
}

export async function mountPropWorkspace({items,detail,tools,item,propTab,propAnimation,navigate,request,submit,actions=[],signal}){
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
  const clips=prop.animations;
  if(!clips.length){
   const empty=node('div',null,'prop-surface');
   empty.append(node('p','게시된 애니메이션이 없습니다.','meta'));
   panel.append(empty);return;
  }
  const clip=clips.find(row=>row.id===propAnimation)??clips[0];
  const layout=node('div',null,'npc-planning-layout');
  const menu=node('nav',null,'npc-planning-nav prop-animation-nav');
  menu.setAttribute('aria-label','애니메이션 폴더');
  menu.append(node('h4','애니메이션 폴더'));
  for(const row of clips){
   const folder=node('a',null,'npc-roster-entry');
   folder.href=sectionUrl(item,'animation',row.id);
   folder.append(node('strong',row.title),node('span',row.id,'meta'));
   if(row.id===clip.id)folder.setAttribute('aria-current','page');
   menu.append(folder);
  }
  const player=node('section',null,'npc-planning-page prop-animation-player');
  player.append(node('h4',clip.title));
  const pair=node('div',null,'prop-preview-pair');
  pair.append(animationPreview(clip,'detail'),animationPreview(clip,'pixel'));
  player.append(pair);layout.append(menu,player);panel.append(layout);
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
  const motion=action!=='animation'&&can('animation')?select([['still','정지 프랍'],['subtle','짧은 움직임도 포함']]):null;
  if(id)form.append(field('프랍 폴더 이름',id));
  if(motion)form.append(field('기본 구성',motion));
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
     body.motion=motion?.value??'still';
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
