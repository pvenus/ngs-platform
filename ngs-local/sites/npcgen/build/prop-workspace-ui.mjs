import {mountCatalogRosterEdit} from './catalog-roster-edit.mjs';
import {propPayload,propTypes,propSpiritProfile,propWorkspacePath,propSlug,validPropGenerateReference,validPropPayload} from './prop-workspace-contract.mjs';
import {propPackageMediaLimit} from './prop-package-contract.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const node=(tag,text,className)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;};
const api=fields=>propWorkspacePath+'?'+new URLSearchParams({projectId:'binari',...fields});
const actionsLabel={generate:'프랍 종합 생성 요청',regenerate:'재생성 요청',animation:'애니메이션 생성 요청'};
const errors={
 PROP_WORKSPACE_REFERENCE_STALE:'레퍼런스 프랍이 변경되었거나 삭제됐어요. 페이지를 새로 열어 다시 선택해 주세요.',
 PROP_WORKSPACE_REFERENCE_UNAVAILABLE:'이 프랍의 디테일 이미지는 레퍼런스로 사용할 수 없어요. 다른 프랍을 선택해 주세요.',
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
/** A browser-only copy: change APNG num_plays to zero and update that chunk's checksum. */
export function loopingPropPreview(bytes,frameCount){
 if(bytes.length>propPackageMediaLimit||![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))
  throw Error('PROP_PREVIEW_INVALID');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let at=8;at+12<=bytes.length;){
  const len=view.getUint32(at),end=at+12+len;
  if(end>bytes.length)break;
  const kind=view.getUint32(at+4);
  if(kind===0x6163544c){ // acTL
   if(len!==8||!Number.isInteger(frameCount)||frameCount<2||view.getUint32(at+8)!==frameCount)break;
   const control=Uint8Array.from(bytes.subarray(at,end));
   const chunk=new DataView(control.buffer,control.byteOffset,control.byteLength);
   chunk.setUint32(12,0);
   let crc=0xffffffff;
   for(let i=4;i<16;i++){
    crc^=control[i];
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
   }
   chunk.setUint32(16,(crc^0xffffffff)>>>0);
   return new Blob([bytes.subarray(0,at),control,bytes.subarray(end)],{type:'image/apng'});
  }
  if(kind===0x49444154||kind===0x49454e44)break; // acTL must precede IDAT.
  at=end;
 }
 throw Error('PROP_PREVIEW_INVALID');
}
function animationPreview(clip,lane,signal){
 const frame=node('div',null,'prop-animation-preview'),m=clip.media?.[lane],src=verifiedURL(m);
 if(!src||m.mediaType!=='image/apng')return frame;
 const label=lane==='detail'?'디테일':'픽셀',button=node('button',label+' 재생','prop-control');
 button.type='button';button.setAttribute('aria-pressed','false');
 const image=node('span');frame.append(button,image);
 let played=null;
 function stop(){
  const prev=played;played=null;
  signal?.removeEventListener('abort',stop);
  prev?.controller.abort();
  image.replaceChildren();
  if(prev?.url)URL.revokeObjectURL(prev.url);
  button.textContent=label+' 재생';button.setAttribute('aria-pressed','false');
 }
 function fail(run){
  if(played!==run)return;
  stop();image.append(node('span','미리보기를 읽지 못했습니다.','meta'));
 }
 button.addEventListener('click',async()=>{
  if(played){stop();return;}
  if(signal?.aborted)return;
  const run={controller:new AbortController(),url:null};played=run;
  signal?.addEventListener('abort',stop,{once:true});
  image.replaceChildren();
  button.textContent=label+' 정지';button.setAttribute('aria-pressed','true');
  try{
   const res=await fetch(src,{signal:run.controller.signal,credentials:'same-origin',redirect:'error'});
   if(!res.ok||Number(res.headers.get('content-length'))>propPackageMediaLimit)throw Error('PROP_PREVIEW_READ');
   const bytes=new Uint8Array(await res.arrayBuffer());
   if(played!==run)return;
   run.url=URL.createObjectURL(loopingPropPreview(bytes,m.frameDurationsMs?.length));
   const img=node('img');img.alt=clip.title+' '+label;img.decoding='async';
   img.addEventListener('error',()=>fail(run),{once:true});
   img.src=run.url;image.replaceChildren(img);
  }catch{fail(run);}
 });
 return frame;
}

function mountPropRoster({items,rows,item,sectionUrl,edit,signal}){
 const storageKey='ngs:prop-roster:v1:binari',search=node('input',null,'npc-search');
 search.type='search';search.id='prop-search';search.placeholder='프랍 이름 또는 ID 검색';search.maxLength=120;
 const label=node('label','프랍 검색','npc-search-label');label.htmlFor=search.id;
 let saved;
 try{saved=globalThis.sessionStorage.getItem(storageKey);saved=saved?JSON.parse(saved):null;}catch{}
 search.value=typeof saved?.query==='string'?saved.query.slice(0,120):'';
 items.before(label,search);
 const visible=new Map();
 const normalize=text=>String(text??'').normalize('NFC').toLocaleLowerCase();
 const rowTop=row=>row.getBoundingClientRect().top-items.getBoundingClientRect().top+items.scrollTop;
 function remember(){
  const top=items.scrollTop;
  let anchor='',offset=0;
  for(const [id,row] of visible){
   const y=rowTop(row);
   if(y+row.getBoundingClientRect().height>top){anchor=id;offset=top-y;break;}
  }
  try{globalThis.sessionStorage.setItem(storageKey,JSON.stringify({query:search.value,top,anchor,offset}));}catch{}
 }
 function render(restore){
  const terms=normalize(search.value).trim().split(/\s+/u).filter(Boolean);
  visible.clear();
  const entries=rows.flatMap(row=>{
   const parts=[normalize(row.title),normalize(row.propId)];
   if(!terms.every(term=>parts.some(part=>part.includes(term))))return [];
   const entry=node('li'),link=node('a',null,'request-item npc-roster-entry');
   link.href=sectionUrl(row.propId);
   if(item===row.propId)link.setAttribute('aria-current','page');
   link.append(node('strong',row.title),node('span',row.propId,'meta'));entry.append(link);
   edit?.decorate(entry,row.propId,row.title,{revision:row.revision,sha256:row.sha256});
   visible.set(row.propId,entry);return [entry];
  });
  items.replaceChildren(...(entries.length?entries:[node('li',terms.length?'검색 결과가 없습니다.':'게시된 프랍이 없습니다.','meta')]));
  edit?.refresh();
  const anchor=visible.get(restore?.anchor);
  items.scrollTop=Math.max(0,anchor?rowTop(anchor)+(Number(restore.offset)||0):Number(restore?.top)||0);
 }
 render(saved);
 search.addEventListener('input',()=>{render();remember();},{signal});
 items.addEventListener('scroll',remember,{passive:true,signal});
 globalThis.addEventListener?.('pagehide',remember,{signal});
 signal.addEventListener('abort',()=>{remember();label.remove();search.remove();},{once:true});
}

export async function mountPropWorkspace({items,detail,tools,item,propTab,propAnimation,navigate,request,submit,removeAnimations,actions=[],signal,deleteItem}){
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
 const edit=mountCatalogRosterEdit({items,tools,deleteItem,signal});
 const rows=data.props;
 mountPropRoster({items,rows,item,sectionUrl,edit,signal});
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
  const dims=lane=>{
   const media=prop.media?.[lane];
   return validSize(media?.width)&&validSize(media?.height)?media:null;
  };
  const validSize=n=>Number.isSafeInteger(n)&&n>0&&n<=2048;
  const detailSize=dims('detail'),pixelSize=dims('pixel');
  if(detailSize&&pixelSize){
   preview.style.setProperty('--prop-detail-columns',String(detailSize.width)+'fr');
   preview.style.setProperty('--prop-pixel-columns',String(pixelSize.width)+'fr');
  }
  const spiritSize=dims('spirit');
  const figure=(lane,label,size)=>{
   const block=node('figure',null,'npc-portrait-card'),art=node('div',null,'npc-portrait-art');
   block.dataset.lane=lane;
   const caption=node('figcaption',label);
   if(size)caption.append(node('span',size.width+' × '+size.height+' px','prop-preview-dimensions'));
   const image=staticImage(prop.media?.[lane],prop.title+' '+label);
   if(size&&image.tagName==='IMG'){image.width=size.width;image.height=size.height;}
   block.append(caption,art);return {block,art,image,caption};
  };
  const original=figure('detail','큰 원본',detailSize);
  const placement=figure('pixel',spiritSize?'배치 미리보기 · 1/5':'픽셀',pixelSize);
  if(original.image.tagName==='IMG'){
   const enlarge=node('button',null,'npc-media-enlarge-trigger');
   enlarge.type='button';enlarge.setAttribute('aria-label','큰 원본 확대');enlarge.setAttribute('aria-haspopup','dialog');
   enlarge.append(original.image);original.art.append(enlarge);
   enlarge.onclick=()=>openOriginal(prop,enlarge);
  }else original.art.append(original.image);
  placement.art.append(placement.image);
  if(spiritSize&&verifiedURL(prop.media.spirit)&&placement.image.tagName==='IMG'){
   preview.classList.add('prop-spirit-previews');
   const switcher=node('button','서진 능력 사용','prop-control prop-spirit-toggle');
   switcher.type='button';switcher.setAttribute('aria-pressed','false');
   const caption=node('span','능력 OFF · 픽셀','meta prop-spirit-mode');
   const control=node('div',null,'prop-panel-heading prop-spirit-control');
   caption.setAttribute('role','status');control.append(switcher,caption);
   card.append(control);
   let active=false;
   switcher.onclick=()=>{
    active=!active;
    switcher.setAttribute('aria-pressed',String(active));
    switcher.textContent=active?'서진 능력 끄기':'서진 능력 사용';
    caption.textContent=active?'능력 ON · 시네마틱':'능력 OFF · 픽셀';
    placement.block.dataset.lane=active?'spirit':'pixel';
    placement.image.src=verifiedURL(active?prop.media.spirit:prop.media.pixel);
    placement.image.alt=prop.title+(active?' 시네마틱 배치 미리보기':' 픽셀 배치 미리보기');
   };
  }
  preview.append(original.block,placement.block);
  card.append(preview);panel.append(card);
  if(prop.interaction?.pixelOpen||prop.interaction?.detailTrigger){
   const interaction=node('section',null,'prop-surface prop-interaction');
   interaction.append(node('h4','상호작용','npc-media-heading'));
   if(prop.interaction.pixelOpen)interaction.append(node('p','픽셀 보기: 열기','meta'));
   if(prop.interaction.detailTrigger)interaction.append(node('p','디테일 보기: 작동','meta'));
   panel.append(interaction);
  }
 }
 function openOriginal(prop,returnTo){
  if(signal?.aborted||!verifiedURL(prop.media?.detail))return;
  const dialog=node('dialog',null,'prop-workspace-dialog background-media-dialog');
  const header=node('div',null,'prop-panel-heading'),title=node('h3',prop.title+' · 큰 원본');
  const close=node('button','닫기','prop-control');close.type='button';
  title.id='prop-original-'+crypto.randomUUID();dialog.setAttribute('aria-labelledby',title.id);header.append(title,close);
  const stage=node('div',null,'npc-media-enlarge-stage'),img=staticImage(prop.media.detail,prop.title+' 큰 원본');
  const {width,height}=prop.media.detail;img.width=width;img.height=height;img.loading='eager';
  stage.append(img);dialog.append(header,stage,node('p',width+' × '+height+' px','meta'));
  const abort=()=>dialog.close();signal?.addEventListener('abort',abort,{once:true});
  dialog.addEventListener('close',()=>{signal?.removeEventListener('abort',abort);dialog.remove();if(!signal?.aborted)returnTo.focus({preventScroll:true});},{once:true});
  close.onclick=abort;document.body.append(dialog);dialog.showModal();close.focus();
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
   pair.append(animationPreview(clip,'detail',signal),animationPreview(clip,'pixel',signal));
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
  let referenceSelect,referenceOptions;
  if(id){
   form.append(field('프랍 폴더 이름',id));
   referenceSelect=node('select');
   const noReference=node('option','레퍼런스 없음');noReference.value='';referenceSelect.append(noReference);
   referenceOptions=new Map();
   for(const row of rows){
    if(!row)continue;
    const {propId,revision,sha256}=row,pin={propId,revision,sha256};
    if(!validPropGenerateReference(pin)||referenceOptions.has(propId))continue;
    referenceOptions.set(propId,pin);
    const option=node('option',row.title+' · '+propId+' · v'+revision);option.value=propId;
    referenceSelect.append(option);
   }
   form.append(field('레퍼런스 프랍 (선택)',referenceSelect));
   if(referenceOptions.size)form.append(node('p','선택한 프랍의 디테일 이미지를 기준으로 새 프랍을 만들어요. 유지할 부분과 바꿀 부분을 요청에 적어 주세요.','meta'));
  }
  if(action==='regenerate')form.append(node('p','완성된 새 프랍으로 교체합니다. 이전 버전은 보존되며, 기존 애니메이션은 새 버전에 자동으로 가져오지 않습니다.','meta'));
  if(action!=='animation')form.append(node('p','시네마틱 원본과 1/5 시네마틱·픽셀 배치 이미지가 함께 생성됩니다.','meta'));
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
    else if(referenceSelect.value){
     const chosen=referenceOptions.get(referenceSelect.value);
     if(!chosen)throw Error('PROP_WORKSPACE_REFERENCE_STALE');
     if(chosen.propId===propId){info.textContent='레퍼런스와 다른 새 프랍 폴더 이름을 입력해 주세요.';return;}
     body.reference=chosen;
    }
    if(action==='animation')Object.assign(body,{motionId:motionId.value.trim(),prompt:intent.value.trim()});
    else {
     body.intent=intent.value.trim();
     body.motion='still';
     body.presentationProfile=propSpiritProfile;
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
