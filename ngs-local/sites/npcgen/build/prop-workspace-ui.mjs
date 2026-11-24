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
 const label=lane==='detail'?'디테일':'픽셀',button=node('button',label+' 재생');
 button.type='button';const image=node('span');frame.append(button,image);
 button.addEventListener('click',()=>{
  const img=node('img');img.src=src;img.alt=clip.title+' '+label;image.replaceChildren(img);
 });
 return frame;
}

export async function mountPropWorkspace({items,detail,tools,item,navigate,request,submit,actions=[],signal}){
 const can=action=>typeof submit==='function'&&actions.includes(action);
 const pageStatus=node('p',null,'meta');pageStatus.setAttribute('role','status');
 let selected=null;
 const data=await request(api({}));
 if(signal?.aborted)return;
 if(!Array.isArray(data?.props))throw Error('PROP_WORKSPACE_INVALID');
 if(can('generate')){
  const add=node('button','＋ 프랍 생성');add.type='button';
  add.addEventListener('click',()=>open('generate'));tools.replaceChildren(add);tools.hidden=false;
 }
 const rows=data.props;
 items.replaceChildren(...rows.map(row=>{
  const link=node('a',row.title,'workspace-nav-item');
  link.href=navigate({item:row.propId});if(item===row.propId)link.setAttribute('aria-current','page');
  link.append(node('small',row.propId,'meta'));return link;
 }));
 if(rows.length===0)items.append(node('p','게시된 프랍이 없습니다.','meta'));
 if(!item){
  detail.replaceChildren(node('h3','프랍 설계'),node('p','목록에서 프랍을 선택하면 게시된 디자인과 애니메이션을 볼 수 있습니다.','meta'),pageStatus);
  return;
 }
 if(!propSlug(item)||!rows.some(row=>row.propId===item)){
  detail.replaceChildren(node('h3','프랍 설계'),node('p','선택한 프랍 폴더가 없습니다.','meta'),pageStatus);return;
 }
 const {prop}=await request(api({propId:item}));
 if(signal?.aborted)return;
 if(prop?.propId!==item)throw Error('PROP_WORKSPACE_INVALID');
 selected=prop;
 const bar=node('header',null,'prop-detail-heading');
 const heading=node('div');heading.append(node('h3',prop.title),node('p',item+' · 버전 '+prop.source.revision,'meta'));
 bar.append(heading);
 const buttons=node('div',null,'prop-actions');
 for(const action of ['regenerate','animation'])if(can(action)){
  const b=node('button',actionsLabel[action]);b.type='button';b.addEventListener('click',()=>open(action));buttons.append(b);
 }
 if(buttons.children.length)bar.append(buttons);
 const preview=node('div',null,'prop-preview-pair');
 for(const [lane,label] of [['detail','디테일'],['pixel','픽셀']]){
  const figure=node('figure');figure.append(staticImage(prop.media?.[lane],prop.title+' '+label),node('figcaption',label));preview.append(figure);
 }
 const clips=node('section');clips.append(node('h4','애니메이션'));
 if(!prop.animations.length)clips.append(node('p','게시된 애니메이션이 없습니다.','meta'));
 for(const clip of prop.animations){
  const row=node('article',null,'prop-animation-row');
  row.append(node('strong',clip.title),animationPreview(clip,'detail'),animationPreview(clip,'pixel'));clips.append(row);
 }
 const interaction=node('section');
 if(prop.interaction?.pixelOpen||prop.interaction?.detailTrigger){
  interaction.append(node('h4','상호작용'));
  if(prop.interaction.pixelOpen)interaction.append(node('p','픽셀 보기: 열기'));
  if(prop.interaction.detailTrigger)interaction.append(node('p','디테일 보기: 작동'));
 }
 detail.replaceChildren(bar,pageStatus,preview,interaction,clips);

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
  const footer=node('div',null,'prop-actions'),cancel=node('button','닫기'),send=node('button','요청 보내기');
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
