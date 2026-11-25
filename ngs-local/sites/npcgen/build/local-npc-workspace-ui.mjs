import {createNpcPlanningEditor,editableNpcPlanningDocument,npcPlanningSelection,renderNpcPlanningDocument} from './local-npc-planning-ui.mjs';
import {createNpcOneStopIntake,mountNpcOneStop,readOneStopMotionPresets} from './local-npc-one-stop-ui.mjs';
import {animationRegenerateType,motionSelectionOf,npcAnimationRegenerateRequest,
 npcPublishedMotionLabel,validNpcAnimationTarget,portraitRegenerateType,portraitRegenerateSchema,validNpcPortraitRegeneration} from './npc-motion-selection.mjs';

/* Only the typed NPC read model is used here; no generic files or legacy transport. */
function nodeOf(tag,className,text){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=text;
 return node;
}
function navigation(values){
 const params=new URLSearchParams();
 for(const [key,value] of Object.entries(values))if(value)params.set(key,value);
 return params.size?'/?'+params:'/';
}

const npcPanels=[['portraits','포트레이트'],['traits','성향'],['planning','기획'],['animations','애니메이션']];
const npcStates={active:'활성',approved:'승인',draft:'초안',published:'게시',archived:'보관',retired:'보관'};
const npcKinds={player:'플레이어',npc:'NPC',combat:'전투',noncombat:'비전투',nonCombat:'비전투',support:'조연'};
const directions={n:'북',ne:'북동',e:'동',se:'남동',s:'남',sw:'남서',w:'서',nw:'북서'};
const npcFieldLabels={name:'이름',kind:'유형',role:'역할',status:'상태',chapters:'등장 챕터',
 summary:'핵심 요약',publicFace:'겉으로 드러나는 모습',actualTruth:'실제 모습',arc:'변화',behavior:'행동',
 belief:'신념',desire:'욕구',fear:'두려움',relationships:'인물 관계',traits:'성향',values:'가치관',
 voice:'말투',numericProfile:'수치 프로필',openQuestions:'열린 질문',title:'제목',purpose:'목적',description:'설명',
 label:'이름',notes:'참고',text:'내용',overview:'개요',background:'배경',personality:'성격',
 content:'내용',body:'본문',value:'내용',goal:'목표',rule:'규칙',motivation:'동기',appearance:'외형',
 action:'행동 성향',cognition:'사고 성향',inner:'내면',relations:'관계 성향',context:'맥락',groups:'수치 기준',
 rules:'판단 규칙',reviewStatus:'검토 상태',version:'버전',score:'점수',reason:'근거',target:'대상'};
const npcInfoKeys=['role','kind','status','chapters','summary','publicFace','actualTruth','desire','fear',
 'values','belief','behavior','voice','relationships','arc','traits','numericProfile','openQuestions'];
const present=value=>value!==undefined&&value!==null&&(typeof value!=='string'||!!value.trim())
 &&(typeof value!=='object'||Object.keys(value).length>0);
function hierarchyLabel(id,kind){
 const match=String(id).match(/(?:^|[.])(?:act|chapter)0*(\d+)$/i);
 return match?kind+' '+Number(match[1]):id;
}
function fieldLabel(key){return npcFieldLabels[key]??String(key).replace(/[_-]+/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2');}
function npcAsset(value){
 if(typeof value!=='string'||!value.startsWith('/api/npc-workspace?'))return null;
 try{const url=new URL(value,location.origin);return url.origin===location.origin&&url.pathname==='/api/npc-workspace'?url.pathname+url.search:null;}
 catch{return null;}
}
function inlineText(parent,text){
 const pattern=/(\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\([^\s)]+\))/g;
 let offset=0;
 for(const part of text.matchAll(pattern)){
  parent.append(document.createTextNode(text.slice(offset,part.index)));
  parent.append(part[2]?nodeOf('strong','',part[2]):part[3]?nodeOf('code','',part[3]):document.createTextNode(part[4]));
  offset=part.index+part[0].length;
 }
 parent.append(document.createTextNode(text.slice(offset)));
}
function authoredText(value){
 const fragment=document.createDocumentFragment(),lines=value.replace(/\r\n?/g,'\n').split('\n');
 let prose=[],list=null,code=null;
 const flush=()=>{
  if(!prose.length)return;
  const p=nodeOf('p');inlineText(p,prose.join('\n'));fragment.append(p);prose=[];
 };
 for(const line of lines){
  if(/^\s*```/.test(line)){
   flush();list=null;
   if(code){fragment.append(nodeOf('div','npc-authored-code',code.join('\n')));code=null;}else code=[];
   continue;
  }
  if(code){code.push(line);continue;}
  const title=/^\s{0,3}#{1,6}\s+(.+)$/.exec(line);
  const bullet=/^\s*(?:(\d+)[.)]|[-+*])\s+(.+)$/.exec(line);
  const quote=/^\s*>\s?(.*)$/.exec(line);
  if(bullet){
   flush();
   const tag=bullet[1]?'ol':'ul';
   if(list?.localName!==tag){list=nodeOf(tag,'npc-authored-list');fragment.append(list);}
   const item=nodeOf('li');inlineText(item,bullet[2]);list.append(item);continue;
  }
  list=null;
  if(title||quote){
   flush();
   const block=nodeOf(title?'h5':'blockquote');inlineText(block,(title??quote)[1]);fragment.append(block);
  }else if(!line.trim()){flush();}
  else prose.push(line);
 }
 flush();
 if(code?.length)fragment.append(nodeOf('div','npc-authored-code',code.join('\n')));
 return fragment;
}
function authoredValue(value,depth=0){
 if(depth>=6)return nodeOf('p','meta','중첩된 내용은 이 보기에서 펼칠 수 없습니다.');
 if(typeof value==='string')return authoredText(value);
 if(typeof value==='number'||typeof value==='boolean')return nodeOf('p','',typeof value==='boolean'?(value?'예':'아니요'):String(value));
 if(Array.isArray(value)){
  const list=nodeOf('ul','npc-authored-list');
  for(const entry of value.slice(0,180).filter(present)){const item=nodeOf('li');item.append(authoredValue(entry,depth+1));list.append(item);}
  return list;
 }
 const fields=nodeOf('dl','npc-authored-fields');
 for(const [key,entry] of Object.entries(value??{}).slice(0,180)){
  if(!present(entry)||['id','schemaVersion','sourceRefs','assetId','sha256','url'].includes(key))continue;
  const data=nodeOf('dd'),field=nodeOf('div');
  data.append(authoredValue(entry,depth+1));field.append(nodeOf('dt','',fieldLabel(key)),data);fields.append(field);
 }
 return fields;
}

export const npcPortraitCompass=Object.freeze(['nw','n','ne','w','center','e','sw','s','se']);
const portraitReferenceLabels={portrait:'원본','pixel-source':'픽셀 처리용 원본',pixel:'픽셀'};
const portraitPoseLabels={representative:'대표',idle:'아이들',combat:'전투'};
const portraitOrder=['representative','idle','combat'];
const portraitReferenceOrder=['portrait','pixel-source','pixel'];

export function groupNpcPortraits(assets){
 const folders=new Map();
 for(const asset of assets??[]){
  const pose=asset?.posePreset,reference=asset?.referenceType;
  const direction=asset?.direction===undefined?'center':asset.direction;
  if(typeof pose!=='string'||!pose||!portraitReferenceOrder.includes(reference)
      ||!npcPortraitCompass.includes(direction))continue;
  if(!folders.has(pose))folders.set(pose,new Map());
  const refs=folders.get(pose);
  if(!refs.has(reference))refs.set(reference,new Map());
  const cells=refs.get(reference);
  if(!cells.has(direction))cells.set(direction,asset);
 }
 const order=[...portraitOrder.filter(key=>folders.has(key)),...[...folders.keys()].filter(key=>!portraitOrder.includes(key))];
 return order.map(pose=>{
  const original=folders.get(pose),references=portraitReferenceOrder.filter(ref=>original.has(ref))
   .map(ref=>({type:ref,cells:original.get(ref)}));
  const visible=pose==='representative'?references.filter(ref=>ref.type==='portrait'):references;
  const pixel=visible.find(ref=>ref.type==='pixel');
  const raw=visible.find(ref=>ref.type==='portrait');
  return {pose,defaultReference:pose==='representative'?'portrait':(pixel??raw??visible[0]).type,
          references:visible,pixelAvailable:pose!=='representative'&&Boolean(pixel)};

 });
}

let mediaPreviewSequence=0;
function enlargeButton(label,image){
 const trigger=nodeOf('button','npc-media-enlarge-trigger');
 trigger.type='button';trigger.setAttribute('aria-label',label+' 확대');
 trigger.setAttribute('aria-haspopup','dialog');trigger.append(image);
 return trigger;
}
function openMediaPreview(owner,trigger,image,{label,kind,pixel=false,toolbar,onClose}){
 const origin=image.parentNode;
 if(!origin||trigger.isConnected===false)return null;
 const dialog=nodeOf('dialog','npc-media-enlarge');
 dialog.dataset.kind=kind;if(pixel)dialog.dataset.pixel='true';
 const title=nodeOf('h3','',label),closeButton=nodeOf('button','npc-media-enlarge-close','닫기');
 title.id='npc-media-enlarge-title-'+ ++mediaPreviewSequence;
 dialog.setAttribute('aria-labelledby',title.id);
 closeButton.type='button';closeButton.setAttribute('autofocus','');
 const header=nodeOf('header');header.append(title,closeButton);dialog.append(header);
 const stage=nodeOf('div','npc-media-enlarge-stage'),note=nodeOf('p','meta');note.hidden=true;
 stage.append(note);dialog.append(stage);
 if(toolbar)dialog.append(toolbar);
 let ended=false;
 function finish(restoreFocus){
  if(ended)return;
  ended=true;
  // The same image node (and URL) returns to its original button.
  if(dialog.open)dialog.close();
  if(origin.isConnected!==false&&image.parentNode===stage)origin.append(image);
  dialog.remove();onClose?.();
  if(restoreFocus&&trigger.isConnected!==false)trigger.focus({preventScroll:true});
 }
 function close({restoreFocus=true}={}){
  finish(restoreFocus);
 }
 closeButton.addEventListener('click',()=>close());
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('close',()=>finish(true));
 dialog.addEventListener('click',event=>{
  if(event.target!==dialog)return;
  const box=dialog.getBoundingClientRect();
  if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)close();
 });
 owner.append(dialog);stage.append(image);
 try{dialog.showModal();closeButton.focus({preventScroll:true});}
 catch{finish(true);return null;}
 return {dialog,image,note,close};
}

export function scopedPortraitAction(data,owner,submit,intakes,poses){
 const npcId=data.npc.id;
 if(!validNpcAnimationTarget(npcId))return null;
 const button=nodeOf('button','npc-portrait-scoped-trigger','추가·재생성');
 button.type='button';button.setAttribute('aria-haspopup','dialog');
 button.setAttribute('aria-label','아이들·전투 포트레이트 추가 또는 재생성');
 let dialog=null,close=()=>{};
 button.addEventListener('click',()=>{
  if(dialog)return;
  const intake=intakes.get(npcId)??createNpcOneStopIntake(submit,{requestType:portraitRegenerateType});
  intakes.set(npcId,intake);
  dialog=nodeOf('dialog','npc-one-stop-dialog');
  const title=nodeOf('h3','','포트레이트 추가·재생성'),form=nodeOf('form','one-stop-intake');
  const notice=nodeOf('p','meta');notice.setAttribute('role','status');
  const pose=nodeOf('select'),scope=nodeOf('select'),intent=nodeOf('textarea');
  pose.setAttribute('aria-label','포트레이트 포즈');scope.setAttribute('aria-label','생성 범위');
  intent.setAttribute('aria-label','수정 요청');intent.placeholder='바꾸려는 내용을 입력하세요 (선택)';intent.maxLength=3500;
  function option(select,value,label){const option=nodeOf('option','',label);option.value=value;select.append(option);return option;}
  option(pose,'idle','아이들');option(pose,'combat','전투');
  option(scope,'reference-and-directions','기준 원본 + 8방향');const directionOnly=option(scope,'directions','8방향만');
  pose.value=poses.get(npcId)==='combat'?'combat':'idle';scope.value='reference-and-directions';
  const explain=nodeOf('p','meta'),send=nodeOf('button','npc-one-stop-submit','생성 요청'),cancel=nodeOf('button','','닫기');
  send.type='submit';cancel.type='button';
  let pending=false;
  function available(){
   directionOnly.disabled=!(data.portraits??[]).some(p=>p.posePreset===pose.value&&p.referenceType==='portrait'&&(p.direction??'center')==='center');
   if(directionOnly.disabled&&scope.value==='directions')scope.value='reference-and-directions';
   explain.textContent=directionOnly.disabled?'원본이 아직 없어 기준 원본과 8방향을 함께 생성합니다.':scope.value==='directions'
    ?'기준 원본을 그대로 두고 8방향만 바꿉니다.':'기준 원본을 새로 만들고 그 원본으로 8방향도 바꿉니다.';
  }
  function controls(){
   pose.disabled=scope.disabled=intent.disabled=pending||intake.waitingConfirmation||intake.accepted;
   send.disabled=pending||intake.accepted;
   send.textContent=intake.waitingConfirmation?'접수 다시 확인':'생성 요청';
  }
  pose.addEventListener('change',available);scope.addEventListener('change',available);available();controls();
  form.append(nodeOf('p','meta','대표 포트레이트와 다른 포즈는 그대로 유지합니다.'),pose,scope,explain,intent,send,cancel,notice);
  dialog.append(title,form);dialog.setAttribute('aria-label',title.textContent);owner.append(dialog);dialog.showModal();
  const opened=dialog;
  close=()=>{if(dialog!==opened)return;dialog=null;opened.close();opened.remove();if(!intake.waitingConfirmation)intakes.delete(npcId);};
  cancel.addEventListener('click',close);opened.addEventListener('cancel',e=>{e.preventDefault();close();});
  form.addEventListener('submit',async e=>{
   e.preventDefault();if(pending||intake.accepted)return;
   const payload={schemaVersion:portraitRegenerateSchema,projectId:'binari',npcId,posePreset:pose.value,scope:scope.value,intent:intent.value.trim()};
   if(!intake.waitingConfirmation&&(!validNpcPortraitRegeneration(payload)||(directionOnly.disabled&&payload.scope==='directions'))){notice.textContent='포즈와 생성 범위를 다시 확인해 주세요.';return;}
   pending=true;controls();
   try{const receipt=await intake.send(()=>payload);if(dialog===opened&&receipt)notice.textContent='포트레이트 생성 요청을 접수했습니다.';}
   catch(error){if(dialog===opened)notice.textContent=error.definitive?'요청을 접수하지 못했습니다: '+error.message:'접수 응답을 확인하지 못했습니다. 같은 접수를 다시 확인해 주세요.';}
   finally{pending=false;if(dialog===opened)controls();else if(!intake.waitingConfirmation)intakes.delete(npcId);}
  });
 });
 return {button,close:()=>close()};
}

export function renderNpcPortraitPanel(data,panel,{variants=new Map(),poses=new Map(),portraitActions=null,originalOnly=false}={}){
 const folders=groupNpcPortraits((data.portraits??[]).filter(asset=>npcAsset(asset.url)&&(!originalOnly||asset.referenceType==='portrait')));
 const row=nodeOf('div','npc-one-stop-roster-heading');
 const tabs=nodeOf('div','npc-portrait-pose-tabs');
 if(portraitActions){row.append(tabs,portraitActions.button);panel.append(row);}
 if(!folders.length){panel.append(nodeOf('p','meta','게시된 포트레이트가 없습니다.'));return ()=>portraitActions?.close();}

 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','포트레이트 포즈');
 const activePanel=nodeOf('div','npc-portrait-pose-panel');
 activePanel.id='npc-portrait-pose-panel';activePanel.setAttribute('role','tabpanel');activePanel.tabIndex=0;
 const buttons=folders.map(({pose},index)=>{
  const button=nodeOf('button','npc-portrait-pose-tab',portraitPoseLabels[pose]??pose);
  button.type='button';button.id='npc-portrait-pose-tab-'+index;button.dataset.posePreset=pose;
  button.setAttribute('role','tab');button.setAttribute('aria-controls',activePanel.id);
  button.addEventListener('click',()=>select(index));
  button.addEventListener('keydown',event=>{
   const target=event.key==='ArrowRight'?(index+1)%folders.length
    :event.key==='ArrowLeft'?(index+folders.length-1)%folders.length
     :event.key==='Home'?0:event.key==='End'?folders.length-1:null;
   if(target!==null){event.preventDefault();select(target,true);}
  });
  return button;
 });
 tabs.append(...buttons);
 if(!portraitActions)panel.append(tabs);
 panel.append(activePanel);
 let current=-1,preview=null;
 const closePreview=()=>preview?.close({restoreFocus:false});
 function select(index,moveFocus=false){
  if(index===current){if(moveFocus)buttons[index].focus();return;}
  current=index;
  const {pose,references,defaultReference,pixelAvailable}=folders[index];
  poses.set(data.npc.id,pose);
  buttons.forEach((button,i)=>{
   button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;
  });
  activePanel.setAttribute('aria-labelledby',buttons[index].id);

  const section=nodeOf('section','npc-portrait-folder'),header=nodeOf('header','npc-portrait-compass-heading');
  const folderLabel=portraitPoseLabels[pose]??pose;
  const title=nodeOf('h4','',folderLabel+' 포트레이트');
  const grid=nodeOf('div','npc-portrait-compass');
  section.dataset.posePreset=pose;
  grid.setAttribute('role','group');grid.setAttribute('aria-label',folderLabel+' 9방향 포트레이트');
  header.append(title);
  const preferenceKey=data.npc.id+':'+pose;
  function show(reference){
   closePreview();
   const choice=references.find(entry=>entry.type===reference)??references[0]??
    {type:'portrait',cells:new Map()};
   variants.set(preferenceKey,choice.type);
   grid.dataset.referenceType=choice.type;
   const cells=npcPortraitCompass.map(direction=>{
    const label=direction==='center'?'중앙':directions[direction];
    const tile=nodeOf('figure','npc-portrait-card npc-portrait-direction'),art=nodeOf('div','npc-portrait-art');
    tile.dataset.direction=direction;tile.setAttribute('aria-label',label);
    const asset=choice.cells.get(direction),url=asset&&npcAsset(asset.url);
    if(url){
     const image=nodeOf('img');image.src=url;image.loading='lazy';image.decoding='async';
     image.alt=data.npc.name+' '+folderLabel+' '+label+' '+portraitReferenceLabels[choice.type];
     const trigger=enlargeButton(image.alt,image);
     trigger.addEventListener('click',()=>{
      if(preview)return;
      preview=openMediaPreview(panel,trigger,image,{label:image.alt,kind:'portrait',pixel:choice.type==='pixel',
       onClose:()=>{preview=null;}});
     });
     image.addEventListener('error',()=>{
      if(preview?.image===image)closePreview();
      art.replaceChildren(nodeOf('span','meta','읽기 실패'));
     },{once:true});
     art.append(trigger);
    }else{
     tile.classList.add('empty');
     art.append(nodeOf('span','meta',choice.type==='pixel'?'픽셀 미게시':'게시 없음'));
    }
    tile.append(art);
    return tile;
   });
   grid.replaceChildren(...cells);
  }
  const prior=variants.get(preferenceKey);
  const selected=references.some(ref=>ref.type===prior)?prior:defaultReference;
  if(references.length>1){
   const picker=nodeOf('select','npc-portrait-reference');
   picker.setAttribute('aria-label',folderLabel+' 포트레이트 형식');
   for(const ref of references){
    const label=portraitReferenceLabels[ref.type]+(!pixelAvailable?' · 픽셀 미게시':'');
    const option=nodeOf('option','',label);option.value=ref.type;picker.append(option);
   }
   picker.value=selected;picker.addEventListener('change',()=>show(picker.value));header.append(picker);
  }else{
   const label=pose==='representative'&&!references.length?'원본 미게시':
    !originalOnly&&pose!=='representative'&&!pixelAvailable?portraitReferenceLabels[selected]+' · 픽셀 미게시':
    portraitReferenceLabels[selected];
   header.append(nodeOf('span','meta',label));
  }
  section.append(header,grid);activePanel.replaceChildren(section);show(selected);
  if(moveFocus)buttons[index].focus();
 }
 const remembered=folders.findIndex(folder=>folder.pose===poses.get(data.npc.id));
 const representative=folders.findIndex(folder=>folder.pose==='representative');
 select(remembered>=0?remembered:Math.max(0,representative));
 return ()=>{closePreview();portraitActions?.close();};
}

const npcMediaDetailTabs=new Set(['portraits','animations']);
export function npcDetailNavigation(npcId,tab){
 return {item:npcId,npcTab:tab,...(npcMediaDetailTabs.has(tab)?{npcRefresh:'detail'}:{})};
}
export function npcRefreshScopes({projectId,wanted,selected,roster,npcTab,npcRefresh,mediaScopes}){
 const base=projectId+'/npcs';
 if(!wanted)return [base];
 if(wanted!==selected)return [];
 const scope=roster?.find(npc=>npc.id===wanted)?.scope;
 if(scope!==base+'/'+wanted)return [];
 if(npcRefresh!=='detail'||!npcMediaDetailTabs.has(npcTab))return [scope];
 const paths=mediaScopes?.[npcTab];
 // Only the bound NPC DTO can name detail folders. Never broaden a detail
 // request to the whole character when a narrowed contract is unavailable.
 return Array.isArray(paths)?[...new Set(paths.filter(path=>typeof path==='string'&&path.startsWith(scope+'/')))]:[];
}
export async function refreshNpcScopes(scopes,{post,signal,onDownload=()=>{}}){
 let changed=false,failed=false;
 // Different scopes must not race the PDS compare endpoint. Groups within
 // the current scope use the existing independently bounded apply path.
 for(const scope of scopes){
  if(signal.aborted)break;
  try{
   const comparison=await post('compare',{scope});
   if(signal.aborted)break;
   if(comparison.groups.length)onDownload();
   const results=await Promise.allSettled(comparison.groups.map(group=>post('refresh',{scope,folder:group.folder})));
   changed ||= results.some(result=>result.status==='fulfilled');
   failed ||= Boolean(comparison.unavailable?.length)||results.some(result=>result.status==='rejected');
  }catch{if(!signal.aborted)failed=true;}
 }
 return {changed,failed};
}

export function mountNpcAnimationRegenerate(owner,{npc,request,submit,intakes,modalOwner=owner,poseSelectionV2Enabled=false}){
 if(!validNpcAnimationTarget(npc?.id)||typeof submit!=='function')return ()=>{};
 const actions=nodeOf('div','npc-animation-request-actions'),trigger=nodeOf('button','npc-one-stop-trigger','+');
 trigger.type='button';trigger.setAttribute('aria-label','애니메이션 재생성 요청');trigger.setAttribute('aria-haspopup','dialog');
 trigger.title='애니메이션 재생성 요청';actions.append(trigger);owner.append(actions);
 let disposeDialog=()=>{},mounted=true;
 trigger.addEventListener('click',()=>{
  if(!mounted)return;
  const controller=new AbortController(),modal=nodeOf('dialog','npc-one-stop-dialog');
  const intake=intakes.get(npc.id)??createNpcOneStopIntake(submit,{requestType:animationRegenerateType});
  const title=nodeOf('h2','','애니메이션 재생성 요청'),head=nodeOf('header'),close=nodeOf('button','','닫기');
  title.id='npc-animation-request-heading';modal.setAttribute('aria-labelledby',title.id);
  close.type='button';head.append(title,close);
  const intro=nodeOf('p','meta',npc.name+'의 선택한 모션만 8방향으로 생성합니다. 기존 방향별 포트레이트를 사용하며, 기획·포트레이트·다른 모션은 그대로 둡니다.');
  const form=nodeOf('form'),fields=nodeOf('fieldset','one-stop-section'),legend=nodeOf('legend','','등록된 모션 프리셋');
  const choices=nodeOf('div','one-stop-motion-choices'),count=nodeOf('p','meta'),status=nodeOf('p','meta');
  const send=nodeOf('button','npc-one-stop-submit','재생성 요청');send.type='submit';
  status.setAttribute('role','status');fields.append(legend,choices,count);form.append(fields,send);
  modal.append(head,intro,form,status);
  const selected=new Map();let rows=null,busy=false,closed=false;
  function update(){
   fields.hidden=intake.waitingConfirmation;fields.disabled=busy||intake.waitingConfirmation;
   close.disabled=busy;send.disabled=busy||intake.accepted||(!intake.waitingConfirmation&&!selected.size);
   send.textContent=busy?'접수 중…':intake.waitingConfirmation?'같은 접수 다시 확인':'재생성 요청';
   count.textContent=selected.size+'개 선택';
  }
  function dismiss(restore=true){
   if(closed)return;closed=true;controller.abort();if(modal.open)modal.close();modal.remove();
   if(restore&&trigger.isConnected)trigger.focus();
  }
  disposeDialog=()=>dismiss(false);
  close.addEventListener('click',()=>{if(!busy)dismiss();});
  modal.addEventListener('cancel',event=>{event.preventDefault();if(!busy)dismiss();});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(send.disabled||closed)return;
   busy=true;update();status.textContent='';
   try{
    const receipt=await intake.send(()=>npcAnimationRegenerateRequest(npc.id,[...selected.values()],rows??[],poseSelectionV2Enabled));
    if(receipt)intakes.delete(npc.id);
    if(closed)return;
    if(receipt){form.hidden=true;status.textContent=receipt.status==='queued'?'NGS 대기열에 저장했습니다.':'요청을 접수했습니다.';}
   }catch(error){
    if(intake.waitingConfirmation)intakes.set(npc.id,intake);
    else intakes.delete(npc.id);
    if(!closed){
     if(error.message==='NPC_ANIMATION_REGENERATE_PRESETS_STALE'){
      status.textContent='프리셋이 변경됐습니다. 창을 다시 열고 선택해 주세요.';form.hidden=true;
     }else status.textContent=intake.waitingConfirmation?'접수 응답을 확인하지 못했습니다. 같은 접수를 다시 확인해 주세요.':'요청을 받지 못했습니다. 선택한 NPC와 프리셋을 확인해 주세요.';
    }
   }finally{if(!closed){busy=false;update();if(intake.accepted)close.focus();}}
  });
  update();modalOwner.append(modal);modal.showModal();
  if(intake.waitingConfirmation){send.focus();return;}
  status.textContent='등록된 프리셋을 확인하는 중…';
  void readOneStopMotionPresets(request,controller.signal).then(catalog=>{
   if(closed)return;rows=catalog;
   status.textContent=rows.length?'':'게시된 8방향 모션 프리셋이 없습니다.';
   for(const [pose,label] of [['idle','아이들'],['combat','전투']]){
    const matches=rows.filter(row=>row.posePreset===pose);if(!matches.length)continue;
    const group=nodeOf('div','one-stop-motion-group');group.append(nodeOf('strong','',label));choices.append(group);
    for(const row of matches){
     const item=nodeOf('label'),box=nodeOf('input');box.type='checkbox';
     box.addEventListener('change',()=>{
      if(!box.checked)selected.delete(row.presetId);
      else selected.set(row.presetId,motionSelectionOf(row));
      box.checked=selected.has(row.presetId);update();
     });
     item.append(box,nodeOf('span','',row.label+' · '+row.presetId));group.append(item);
    }
   }
   update();
  }).catch(()=>{if(!closed)status.textContent='모션 프리셋을 읽지 못했습니다. 창을 다시 열어 주세요.';});
 });
 return ()=>{mounted=false;disposeDialog();actions.remove();};
}

export async function loadNpcFolder({search,projectId,signal,request,post,submitOneStop,submitPlanning,note,items,detail,workspace,poseSelectionV2Enabled=false,basicPortraitRequests=false,scopedPortraitRequests=false}){
 const planEditor=projectId==='binari'&&typeof submitPlanning==='function'?createNpcPlanningEditor({owner:workspace,submit:submitPlanning,signal}):null;
 const listPane=items.parentElement;
 listPane.classList.add('npc-roster-list');
 detail.classList.add('npc-detail');
 listPane.querySelector('h3').textContent='NPC';
 if(projectId==='binari'&&typeof submitOneStop==='function')mountNpcOneStop(listPane,{submit:submitOneStop,request,signal,poseSelectionV2Enabled,basic:basicPortraitRequests});
 const heading=workspace.querySelector('.project-content-heading');
 workspace.querySelector('.npc-hierarchy-nav')?.remove();
 listPane.querySelector('.npc-search-label')?.remove();
 listPane.querySelector('.npc-search')?.remove();
 const hierarchy=nodeOf('div','npc-hierarchy-nav');
 heading.after(hierarchy);
 const query=nodeOf('input','npc-search');
 query.type='search';query.id='npc-search';query.placeholder='이름이나 역할 검색';
 const control=nodeOf('label','npc-search-label','인물 검색');control.htmlFor=query.id;
 items.before(control,query);
 const chapterLabels=new Map(),portraitVariantPreferences=new Map(),portraitPosePreferences=new Map();
 const wanted=search.get('item');
 const chapter=search.get('npcChapter')??'all';
 let selected='',disposeMedia=()=>{},replacementAction=null;
 const animationSettings=new Map(),animationIntakes=new Map(),portraitIntakes=new Map();
 signal.addEventListener('abort',()=>{disposeMedia();replacementAction?.controller.abort();},{once:true});
 const nav=values=>navigation({projectId,catalogArea:'npcs',npcChapter:chapter==='all'?'':chapter,...values});
 const get=(npcId='')=>request('/api/npc-workspace?'+new URLSearchParams({projectId,...(npcId?{npcId}:{})}));
 function showHierarchy(data){
  const bands=[];
  if(data.actId){
   const row=nodeOf('div','npc-hierarchy-band');row.append(nodeOf('strong','','NPC Act'),
    nodeOf('span','npc-hierarchy-chip selected',hierarchyLabel(data.actId,'Act')));bands.push(row);
  }
  chapterLabels.clear();
  for(const entry of data.chapters??[])chapterLabels.set(entry.id,entry.label!==entry.id?entry.label:hierarchyLabel(entry.id,'챕터'));
  if(chapterLabels.size){
   const row=nodeOf('nav','npc-hierarchy-band');row.setAttribute('aria-label','NPC 챕터');
   row.append(nodeOf('strong','','NPC 챕터'));
   for(const [id,name] of [['all','전체 챕터'],...chapterLabels,['unclassified','미분류']]){
    const link=nodeOf('a','npc-hierarchy-chip',name);link.href=nav({npcChapter:id==='all'?'':id});
    if(chapter===id)link.setAttribute('aria-current','page');
    row.append(link);
   }
   bands.push(row);
  }
  hierarchy.replaceChildren(...bands);
 }
 function visible(data){
  return (data.npcs??[]).filter(npc=>!data.actId||!npc.actId||npc.actId===data.actId)
   .filter(npc=>chapter==='all'||(chapter==='unclassified'?!npc.chapters?.length:!npc.chapters?.length||npc.chapters.includes(chapter)));
 }
 function roster(data){
  const filter=query.value.trim().toLocaleLowerCase();
  const rows=visible(data).filter(npc=>[npc.name,npc.role].some(text=>typeof text==='string'&&text.toLocaleLowerCase().includes(filter)));
  const grouped=[['공통 인물',rows.filter(npc=>!npc.chapters?.length)],['등장 인물',rows.filter(npc=>npc.chapters?.length)]];
  const content=[];
  for(const [label,group] of grouped){
   if(!group.length)continue;
   const section=nodeOf('li','npc-roster-group'),pool=nodeOf('ul'),name=nodeOf('h4','',label);
   section.append(name,pool);content.push(section);
   for(const npc of group){
    const entry=nodeOf('li'),link=nodeOf('a','request-item npc-roster-entry');
    // Roster navigation keeps the visual tab, never the detail-only intent.
    link.href=nav({item:npc.id,npcTab:search.get('npcTab')??''});
    if(npc.id===selected)link.setAttribute('aria-current','page');
    link.append(nodeOf('strong','',npc.name));
    if(present(npc.role))link.append(nodeOf('span','meta',npc.role));
    entry.append(link);pool.append(entry);
   }
  }
  if(!content.length)content.push(nodeOf('li','meta',filter?'검색 결과가 없습니다.':'조건에 맞는 NPC가 없습니다.'));
  items.replaceChildren(...content);
 }
 function planPanel(data,panel){
  const npc=data.npc,plans=(data.planning??[]).filter(row=>typeof row.id==='string'&&typeof row.name==='string');
  const wanted=search.get('npcCategory'),{choices,selected,legacy,custom,selectedCustom}=npcPlanningSelection(plans,wanted);
  const basic=wanted==='__basic',selectedPlan=selectedCustom??legacy??selected.document;
  const layout=nodeOf('div','npc-planning-layout'),menu=nodeOf('nav','npc-planning-nav'),content=nodeOf('section','npc-planning-page');
  layout.append(menu,content);
  menu.setAttribute('aria-label','기획 문서');
  const tool=nodeOf('div','npc-planning-document-heading');
  tool.append(nodeOf('h4','','기획 문서'));
  const add=planEditor?.addButton({npcId:npc.id,npcName:npc.name});
  if(add)tool.append(add);
  menu.append(tool);
  for(const row of choices){
   const link=nodeOf('a','',row.name);link.href=nav({item:npc.id,npcTab:'planning',npcCategory:row.role});
   if(!selectedCustom&&!legacy&&!basic&&row.role===selected.role)link.setAttribute('aria-current','page');menu.append(link);
  }
  if(custom.length){
   menu.append(nodeOf('h4','','추가 기획'));
   for(const document of custom){
    const link=nodeOf('a','',document.name);link.href=nav({item:npc.id,npcTab:'planning',npcCategory:document.id});
    if(selectedCustom?.id===document.id)link.setAttribute('aria-current','page');
    menu.append(link);
   }
  }
  content.setAttribute('aria-label','선택한 기획 문서');
  const heading=nodeOf('header','npc-planning-document-heading');
  heading.append(nodeOf('h4','',basic?'기본 정보':selectedCustom?.name??legacy?.name??selected.name));
  if(planEditor&&!basic&&!legacy&&!selectedCustom&&editableNpcPlanningDocument(selectedPlan))
   heading.append(planEditor.button({npcId:npc.id,npcName:npc.name,role:selected.role,name:selected.name}));
  content.append(heading);
  if(basic){
   const info={};
   for(const key of npcInfoKeys){
    if(!present(npc[key]))continue;
    const raw=npc[key];
    info[key]=key==='kind'?npcKinds[raw]??raw:key==='status'?npcStates[raw]??raw
     :key==='chapters'&&Array.isArray(raw)?raw.map(id=>chapterLabels.get(id)??hierarchyLabel(id,'챕터')):raw;
   }
   if(Object.keys(info).length)content.append(authoredValue(info));
   else content.append(nodeOf('p','meta','작성된 기본 정보가 없습니다.'));
  }else content.append(renderNpcPlanningDocument(selectedPlan,value=>present(value)?authoredValue(value):
   nodeOf('p','meta','작성된 기획 문서가 없습니다.')));
  panel.append(layout);
 }
 function traitsPanel(data,panel){
  const npc=data.npc,groups=nodeOf('div','npc-traits-grid');
  function append(title,value){
   if(!present(value))return;
   const block=nodeOf('section','npc-traits-card');block.append(nodeOf('h4','',title),authoredValue(value));groups.append(block);
  }
  if(present(npc.traits)){
   for(const [key,value] of Object.entries(npc.traits))append(fieldLabel(key),value);
  }
  if(present(npc.numericProfile)){
   for(const key of ['groups','context','rules','relationships'])append(fieldLabel(key),npc.numericProfile[key]);
  }
  if(groups.childElementCount)panel.append(groups);
  else panel.append(nodeOf('p','meta','게시된 성향과 수치 프로필이 없습니다.'));
 }
 function showNpc(data){
  disposeMedia();disposeMedia=()=>{};
  const npc=data.npc;
  if(!npc){
   replacementAction?.controller.abort();replacementAction=null;
   const header=nodeOf('header','npc-detail-heading');
   header.append(nodeOf('h3','','NPC'));
   const empty=nodeOf('div','npc-tab-panel');
   empty.append(nodeOf('p','meta','왼쪽 목록에서 인물을 선택하세요.'));
   detail.replaceChildren(header,empty);
   return;
  }
  const panels=npcPanels.filter(([id])=>id!=='traits'||present(npc.traits)||present(npc.numericProfile));
  const explicit=search.get('npcTab'),tab=panels.some(([id])=>id===explicit)?explicit
   :data.portraits?.length?'portraits':'planning';
  const header=nodeOf('header','npc-detail-heading'),identity=nodeOf('div','npc-character-identity');
  identity.append(nodeOf('h3','',npc.name));
  const badges=nodeOf('div','npc-character-badges');
  for(const value of [npc.role,npcKinds[npc.kind]??npc.kind,npcStates[npc.status]??npc.status]){
   if(present(value))badges.append(nodeOf('span','',value));
  }
  identity.append(badges);
  header.append(identity);
  if(projectId==='binari'&&typeof submitOneStop==='function'){
   if(replacementAction?.npcId!==npc.id){
    replacementAction?.controller.abort();
    const controller=new AbortController(),holder=nodeOf('div','npc-replacement-action');
    const rosterNpc=data.npcs?.find(row=>row.id===npc.id);
    const target={...rosterNpc,...npc,actId:npc.actId??rosterNpc?.actId??data.actId};
    const trigger=mountNpcOneStop(holder,{submit:submitOneStop,request,signal:controller.signal,...(basicPortraitRequests?{basic:true,newVersion:true}:{replaceNpc:target}),modalOwner:workspace,poseSelectionV2Enabled});
    replacementAction={npcId:npc.id,controller,holder,trigger};
   }
   if(replacementAction.trigger)header.append(replacementAction.holder);
  }
  const tabs=nodeOf('nav','npc-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','NPC 상세 영역');
  const links=panels.map(([id,name],i)=>{
   const anchor=nodeOf('a','',name);anchor.id='npc-tab-'+id;anchor.href=nav(npcDetailNavigation(npc.id,id));
   anchor.setAttribute('role','tab');anchor.setAttribute('aria-controls','npc-tab-panel');
   anchor.setAttribute('aria-selected',String(id===tab));anchor.tabIndex=id===tab?0:-1;
   anchor.addEventListener('keydown',event=>{
    const next=event.key==='ArrowRight'?(i+1)%links.length:event.key==='ArrowLeft'?(i+links.length-1)%links.length
     :event.key==='Home'?0:event.key==='End'?links.length-1:null;
    if(next!==null){event.preventDefault();links[next].click();}
   });
   return anchor;
  });
  tabs.append(...links);
  const panel=nodeOf('section','npc-tab-panel');panel.id='npc-tab-panel';panel.setAttribute('role','tabpanel');
  panel.setAttribute('aria-labelledby','npc-tab-'+tab);panel.tabIndex=0;
  detail.replaceChildren(header,tabs,panel);
  if(tab==='portraits'){
   const portraitActions=projectId==='binari'&&scopedPortraitRequests&&typeof submitOneStop==='function'?
    scopedPortraitAction(data,workspace,submitOneStop,portraitIntakes,portraitPosePreferences):null;
   disposeMedia=renderNpcPortraitPanel(data,panel,{variants:portraitVariantPreferences,poses:portraitPosePreferences,portraitActions,
    originalOnly:basicPortraitRequests||scopedPortraitRequests});
  }
  else if(tab==='traits')traitsPanel(data,panel);
  else if(tab==='animations'){
   if(!animationSettings.has(npc.id))animationSettings.set(npc.id,{percent:100,intervalMs:null});
   const disposeRequest=projectId==='binari'?mountNpcAnimationRegenerate(panel,{npc,request,submit:submitOneStop,
    intakes:animationIntakes,modalOwner:workspace,poseSelectionV2Enabled}):()=>{};
   const catalog=projectId==='binari'?readOneStopMotionPresets(request,signal).catch(()=>[]):Promise.resolve([]);
   const disposePlayback=renderNpcAnimations(data,panel,signal,animationSettings.get(npc.id),catalog);
   disposeMedia=()=>{disposeRequest();disposePlayback();};
  }
  else planPanel(data,panel);
 }
 let data;
 async function reload(){
  const base=await get();
  if(signal.aborted)return base;
  selected=wanted&&visible(base).some(npc=>npc.id===wanted)?wanted:visible(base)[0]?.id??'';
  data=base;showHierarchy(base);roster(base);
  if(selected){data=await get(selected);if(signal.aborted)return base;}
  showNpc(data);return base;
 }
 query.addEventListener('input',()=>{if(data)roster(data);});
 const base=await reload();
 if(signal.aborted)return;
 const scopes=npcRefreshScopes({projectId,wanted,selected,roster:base.npcs,
  npcTab:search.get('npcTab'),npcRefresh:search.get('npcRefresh'),mediaScopes:data?.mediaScopes});
 if(!scopes.length){note('');return;}
 note('파일 비교 중');
 const result=await refreshNpcScopes(scopes,{post,signal,onDownload:()=>note('동기화 중')});
 if(signal.aborted)return;
 if(result.changed)await reload();
 if(result.failed)note(result.changed?'일부 파일을 갱신하지 못했습니다. 기존 사본을 표시합니다.'
  :'파일을 갱신하지 못했습니다. 기존 사본을 표시합니다.',true);
 else note('');
}

const npcPoseLabels={idle:'아이들',combat:'전투',representative:'대표'};
const npcMotionLabels={walk:'걷기',run:'달리기','sword-attack':'검 공격'};
const frameModes=[['pixelUrl','픽셀'],['alphaUrl','알파'],['rawUrl','원본']];
const frameCacheLimit=64*1024*1024,frameCacheEntries=512;

export function groupNpcAnimations(sets,asset=npcAsset){
 const poses=new Map();
 for(const set of sets??[]){
  if(typeof set?.posePreset!=='string'||!set.posePreset||typeof set.presetId!=='string'||!set.presetId)continue;
  const tracks=new Map();
  for(const track of set.directions??[]){
   if(!npcPortraitCompass.includes(track.direction)||tracks.has(track.direction))continue;
   const frames=new Map();
   for(const frame of track.frames??[]){
    if(!Number.isSafeInteger(frame.index)||frame.index<0||frames.has(frame.index))continue;
    const layers=Object.fromEntries(frameModes.flatMap(([mode])=>{const url=asset(frame[mode]);return url?[[mode,url]]:[];}));
    if(Object.keys(layers).length)frames.set(frame.index,layers);
   }
   if(!frames.size)continue;
   const end=Math.max(...frames.keys())+1;
   const count=Number.isSafeInteger(track.frameCount)&&track.frameCount>=end?track.frameCount:end;
   tracks.set(track.direction,{frames,count,fps:Number.isFinite(track.fps)&&track.fps>0?track.fps:12});
  }
  if(!tracks.size)continue;
  if(!poses.has(set.posePreset))poses.set(set.posePreset,new Map());
  const actions=poses.get(set.posePreset);
  if(!actions.has(set.presetId)){
   const modes=frameModes.filter(([mode])=>[...tracks.values()].some(track=>[...track.frames.values()].some(frame=>frame[mode])));
   actions.set(set.presetId,{id:set.presetId,tracks,modes});
  }
 }
 const order=[...['idle','combat'].filter(pose=>poses.has(pose)),...[...poses.keys()].filter(pose=>!['idle','combat'].includes(pose))];
 return order.map(pose=>({pose,actions:[...poses.get(pose).values()]}));
}

export function npcPreviewIndices(total,percent){
 if(total<=1)return total?[0]:[];
 const selected=Math.min(total,Math.max(2,Math.floor(total*percent/100+0.5)));
 return Array.from({length:selected},(_,i)=>Math.floor(i*(total-1)/(selected-1)+0.5));
}
export function parseNpcPreviewInterval(value){
 const n=typeof value==='string'&&value.trim()?Number(value):NaN;
 return Number.isFinite(n)&&n>=1&&n<=10000?n:null;
}
const recordedInterval=fps=>Math.min(10000,Math.max(1,1000/fps));
export function npcPreviewTiming(track,{percent,intervalMs}){
 return {indices:npcPreviewIndices(track.count,percent),intervalMs:intervalMs??recordedInterval(track.fps)};
}
export function npcFrameAt(track,milliseconds,mode,timing){
 const count=timing?.indices.length??track.count;
 const interval=timing?.intervalMs??recordedInterval(track.fps);
 const position=Math.floor(Math.max(0,milliseconds)/interval+1e-7)%count;
 const index=timing?.indices[position]??position;
 return {index,position,url:track.frames.get(index)?.[mode]??null};
}

export function createNpcFrameCache({fetchFrame,makeURL=URL.createObjectURL.bind(URL),dropURL=URL.revokeObjectURL.bind(URL),
 maxBytes=frameCacheLimit,maxEntries=frameCacheEntries,parallel=4}){
 const saved=new Map(),pending=new Map(),queue=[],failed=new Set();
 let bytes=0,active=0,disposed=false,pinned=new Set(),warmLimit=false;
 function trim(extra){
  for(const [key,entry] of saved){
   if(bytes+extra<=maxBytes&&saved.size<maxEntries)break;
   if(pinned.has(key))continue;
   saved.delete(key);bytes-=entry.size;dropURL(entry.url);warmLimit=true;
  }
  return bytes+extra<=maxBytes&&saved.size<maxEntries;
 }
 function pump(){
  while(!disposed&&active<parallel&&queue.length){
   const job=queue.shift();active++;
   Promise.resolve().then(()=>disposed?null:fetchFrame(job.key)).then(blob=>{
    if(disposed)return;
    if(!blob||blob.type!=='image/png'||!blob.size||!trim(blob.size))throw Error('FRAME_NOT_AVAILABLE');
    const entry={url:makeURL(blob),size:blob.size};saved.set(job.key,entry);bytes+=entry.size;
    if(saved.size>=maxEntries||bytes>=maxBytes)warmLimit=true;
   }).catch(()=>{
    if(!disposed){
     if(failed.size>=maxEntries)failed.delete(failed.values().next().value);
     failed.add(job.key);
    }
   }).finally(()=>{active--;pending.delete(job.key);job.done();pump();});
  }
 }
 function load(key,priority=false){
  if(disposed||saved.has(key)||failed.has(key))return Promise.resolve();
  if(pending.has(key))return pending.get(key);
  const promise=new Promise(done=>{const job={key,done};if(priority)queue.unshift(job);else queue.push(job);});
  pending.set(key,promise);pump();return promise;
 }
 function value(key){
  const entry=saved.get(key);
  if(entry){saved.delete(key);saved.set(key,entry);return entry.url;}
  return failed.has(key)?null:undefined;
 }
 return {load,value,pin:keys=>{pinned=new Set(keys);},get warmLimit(){return warmLimit;},
  dispose(){
   if(disposed)return;disposed=true;
   for(const entry of saved.values())dropURL(entry.url);
   saved.clear();failed.clear();
   for(const job of queue)job.done();
   queue.length=0;pending.clear();pinned.clear();
  },
 };
}

export function renderNpcAnimations(data,panel,signal,settings={percent:100,intervalMs:null},catalog=Promise.resolve([])){
 const poses=groupNpcAnimations(data.frameSets);
 if(!poses.length){panel.append(nodeOf('p','meta','게시된 애니메이션 프레임이 없습니다.'));return ()=>{};}
 const tabs=nodeOf('div','npc-animation-pose-tabs npc-portrait-pose-tabs');
 tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','애니메이션 포즈');
 const activePanel=nodeOf('section','npc-animation-pose-panel');activePanel.id='npc-animation-pose-panel';
 activePanel.setAttribute('role','tabpanel');
 let poseIndex=-1,dispose=()=>{};
 const actionsByPose=new Map(),modesByAction=new Map();
 const buttons=poses.map(({pose},index)=>{
  const button=nodeOf('button','npc-animation-pose-tab npc-portrait-pose-tab',npcPoseLabels[pose]??pose);
  button.type='button';button.id='npc-animation-pose-tab-'+index;button.dataset.posePreset=pose;
  button.setAttribute('role','tab');button.setAttribute('aria-controls',activePanel.id);
  button.addEventListener('click',()=>choosePose(index));
  button.addEventListener('keydown',event=>{
   const next=event.key==='ArrowRight'?(index+1)%poses.length
    :event.key==='ArrowLeft'?(index+poses.length-1)%poses.length
     :event.key==='Home'?0:event.key==='End'?poses.length-1:null;
   if(next!==null){event.preventDefault();choosePose(next);buttons[next].focus();}
  });
  return button;
 });
 tabs.append(...buttons);panel.append(tabs,activePanel);
 function choosePose(index){
  if(poseIndex===index)return;
  dispose();poseIndex=index;
  const {pose,actions}=poses[index];
  buttons.forEach((button,i)=>{button.setAttribute('aria-selected',String(i===index));button.tabIndex=i===index?0:-1;});
  activePanel.setAttribute('aria-labelledby',buttons[index].id);activePanel.dataset.posePreset=pose;
  const head=nodeOf('div','npc-frame-controls npc-animation-controls'),actionSelect=nodeOf('select','npc-animation-action');
  const modeSelect=nodeOf('select','npc-animation-variant'),body=nodeOf('div','npc-animation-playback');
  const actionLabel=nodeOf('label','','동작'),modeLabel=nodeOf('label','','프레임 표시');
  actionSelect.id='npc-animation-action';actionLabel.htmlFor=actionSelect.id;
  modeSelect.id='npc-animation-variant';modeLabel.htmlFor=modeSelect.id;
  const tools=nodeOf('div','npc-animation-preview-settings');
  const percentLabel=nodeOf('label','','표시 프레임 비율'),percentInput=nodeOf('input'),percentOutput=nodeOf('output','npc-animation-percent-output');
  const intervalLabel=nodeOf('label','','프레임 간격 (ms)'),intervalInput=nodeOf('input');
  const resetInterval=nodeOf('button','','기본 FPS');
  percentInput.id='npc-animation-percent';percentInput.type='range';
  percentInput.min='1';percentInput.max='100';percentInput.step='1';percentInput.value=String(settings.percent);
  percentLabel.htmlFor=percentInput.id;
  percentOutput.textContent=settings.percent+'%';
  intervalInput.id='npc-animation-interval';intervalInput.type='number';
  intervalInput.min='1';intervalInput.max='10000';intervalInput.step='0.01';
  intervalLabel.htmlFor=intervalInput.id;resetInterval.type='button';
  tools.append(percentLabel,percentInput,percentOutput,intervalLabel,intervalInput,resetInterval);
  let player;
  for(const action of actions){
   const option=nodeOf('option','',npcMotionLabels[action.id]??action.id);option.value=action.id;actionSelect.append(option);
   void catalog.then(rows=>{
    if(signal.aborted||!option.isConnected)return;
    const label=npcPublishedMotionLabel(pose,action.id,rows);
    if(label)option.textContent=label;
   });
  }
  actionSelect.value=actionsByPose.get(pose)??actions.find(action=>action.id==='walk')?.id??actions[0].id;
  head.append(actionLabel,actionSelect,modeLabel,modeSelect,tools);activePanel.replaceChildren(head,body);
  function showInterval(){
   if(!player)return;
   intervalInput.value=String(settings.intervalMs??Number(player.sourceInterval.toFixed(2)));
   intervalInput.setAttribute('aria-invalid','false');
   resetInterval.disabled=settings.intervalMs===null;
  }
  percentInput.addEventListener('input',()=>{
   const value=Number(percentInput.value);
   if(!Number.isSafeInteger(value)||value<1||value>100||value===settings.percent)return;
   settings.percent=value;percentOutput.textContent=value+'%';player?.setTiming();
  });
  intervalInput.addEventListener('input',()=>{
   const value=parseNpcPreviewInterval(intervalInput.value);
   intervalInput.setAttribute('aria-invalid',String(value===null));
   if(value===null||value===settings.intervalMs)return;
   settings.intervalMs=value;resetInterval.disabled=false;player?.setTiming();
  });
  intervalInput.addEventListener('blur',showInterval);
  resetInterval.addEventListener('click',()=>{settings.intervalMs=null;showInterval();player?.setTiming();});
  function playSelection(){
   dispose();
   const action=actions.find(row=>row.id===actionSelect.value),key=pose+':'+action.id;
   modesByAction.set(key,modeSelect.value);
   body.replaceChildren();
   player=mountFrameCompass(action,modeSelect.value,body,data.npc.name,settings);
   dispose=()=>{player?.dispose();player=null;};
   showInterval();
  }
  function chooseAction(){
   const action=actions.find(row=>row.id===actionSelect.value)??actions[0];
   actionsByPose.set(pose,action.id);actionSelect.value=action.id;
   modeSelect.replaceChildren(...action.modes.map(([mode,name])=>{const option=nodeOf('option','',name);option.value=mode;return option;}));
   const prior=modesByAction.get(pose+':'+action.id);
   modeSelect.value=action.modes.some(([mode])=>mode===prior)?prior:action.modes[0][0];
   playSelection();
  }
  actionSelect.addEventListener('change',chooseAction);
  modeSelect.addEventListener('change',playSelection);
  chooseAction();
 }
 choosePose(0);
 const end=()=>dispose();
 signal.addEventListener('abort',end,{once:true});
 return ()=>{signal.removeEventListener('abort',end);end();};
}

function mountFrameCompass(action,mode,body,npcName,settings){
 const abort=new AbortController(),clock=()=>performance.now();
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
 const grid=nodeOf('div','npc-animation-compass npc-portrait-compass');
 grid.setAttribute('role','group');grid.setAttribute('aria-label','9방향 애니메이션 프레임');
 grid.dataset.referenceType=mode==='pixelUrl'?'pixel':mode==='alphaUrl'?'alpha':'raw';
 grid.dataset.action=action.id;
 const tracks=new Map([...action.tracks].filter(([,track])=>[...track.frames.values()].some(frame=>frame[mode])));
 const reference=tracks.get('center')??tracks.get('s')??tracks.values().next().value;
 const cells=npcPortraitCompass.map(direction=>{
  const label=direction==='center'?'중앙':directions[direction],track=tracks.get(direction);
  const figure=nodeOf('figure','npc-portrait-card npc-animation-direction'),art=nodeOf('div','npc-portrait-art');
  figure.dataset.direction=direction;figure.setAttribute('aria-label',label);
  const note=nodeOf('span','meta',track?'프레임 준비 중':'게시 없음');
  const image=nodeOf('img');image.alt=npcName+' '+label+' 방향';image.decoding='async';image.hidden=true;
  const trigger=track?enlargeButton(image.alt+' 애니메이션',image):null;
  if(trigger){
   trigger.hidden=true;
   trigger.addEventListener('click',()=>openDirection(cell));
  }else figure.classList.add('empty');
  art.append(note);
  if(trigger)art.append(trigger);
  figure.append(art);grid.append(figure);
  const cell={figure,image,note,track,trigger};
  return cell;
 });
 const controls=nodeOf('div','npc-frame-toolbar npc-animation-transport');
 const previous=nodeOf('button','','이전'),toggle=nodeOf('button','','재생'),next=nodeOf('button','','다음');
 const position=nodeOf('span','npc-frame-position'),status=nodeOf('span','meta');status.setAttribute('role','status');
 for(const button of [previous,toggle,next]){button.type='button';button.disabled=true;}
 toggle.setAttribute('aria-pressed','false');
 status.textContent='프레임 준비 중';
 controls.append(previous,toggle,next,position,status);body.append(controls,grid);
 const cache=createNpcFrameCache({fetchFrame:async url=>{
  const response=await fetch(url,{signal:abort.signal,cache:'no-store',credentials:'same-origin'});
  if(!response.ok)throw Error('FRAME_NOT_AVAILABLE');
  return response.blob();
 }});
 let disposed=false,playing=false,started=false,waiting=false,raf=0,elapsed=0,anchor=0,version=0,visible=[];
 let paintedTime=0,lastPaintSignature='',warmVersion=0,timings,referenceTiming,preview=null;
 function playbackClick(){if(playing)pause();else setPlaying(true);}
 function syncPreview(){
  if(!preview)return;
  const {cell,toggle:play,previous:back,next:forward,dialog,note}=preview;
  const frameIndex=cell.figure.dataset.frameIndex;
  if(frameIndex===undefined)delete dialog.dataset.frameIndex;else dialog.dataset.frameIndex=frameIndex;
  play.textContent=playing?'일시 정지':'재생';play.setAttribute('aria-pressed',String(playing));
  for(const button of [play,back,forward])button.disabled=toggle.disabled;
  note.hidden=!cell.image.hidden;note.textContent=cell.note.textContent;
 }
 function openDirection(cell){
  if(preview||cell.image.hidden||!cell.image.getAttribute('src'))return;
  const toolbar=nodeOf('div','npc-frame-toolbar npc-media-enlarge-transport');
  const back=nodeOf('button','','이전'),play=nodeOf('button','','재생'),forward=nodeOf('button','','다음');
  for(const button of [back,play,forward])button.type='button';
  back.addEventListener('click',()=>step(-1));play.addEventListener('click',playbackClick);forward.addEventListener('click',()=>step(1));
  toolbar.append(back,play,forward);
  const opened=openMediaPreview(body,cell.trigger,cell.image,{label:cell.image.alt+' 애니메이션',
   kind:'animation',pixel:mode==='pixelUrl',toolbar,onClose:()=>{preview=null;}});
  if(opened){preview={...opened,cell,toggle:play,previous:back,next:forward};syncPreview();}
 }
 const frameAt=(track,t)=>npcFrameAt(track,t,mode,timings.get(track));
 const desiredAt=t=>cells.map(cell=>cell.track?frameAt(cell.track,t):null);
 const urls=desired=>[...new Set(desired.flatMap(frame=>frame?.url?[frame.url]:[]))];
 function paint(desired,t){
  paintedTime=t;
  const signature=desired.map(frame=>frame?.index??'').join(':');
  if(signature===lastPaintSignature)return;
  lastPaintSignature=signature;
  const nextUrls=urls(desired);
  for(const [i,frame] of desired.entries()){
   if(!frame)continue;
   const {figure,image,note,trigger}=cells[i],src=frame.url&&cache.value(frame.url);
   if(!src){
    note.textContent=frame.url?'읽기 실패':'게시 없음';note.hidden=false;image.hidden=true;
    image.removeAttribute('src');trigger.hidden=false;
    trigger.setAttribute('aria-disabled','true');trigger.tabIndex=-1;
    delete figure.dataset.frameIndex;continue;
   }
   if(image.getAttribute('src')!==src)image.src=src;
   image.hidden=false;note.hidden=true;trigger.hidden=false;
   trigger.removeAttribute('aria-disabled');trigger.tabIndex=0;figure.dataset.frameIndex=String(frame.index);
  }
  const frame=frameAt(reference,t);
  position.textContent=(frame.position+1)+' / '+referenceTiming.indices.length+' 프레임';
  grid.dataset.frameIndex=String(frame.index);
  visible=nextUrls;cache.pin(visible);syncPreview();
 }
 function setPlaying(value){
  playing=value;
  toggle.textContent=value?'일시 정지':'재생';toggle.setAttribute('aria-pressed',String(value));
  grid.dataset.playbackState=value?'playing':started?'paused':'loading';
  if(value){anchor=clock();schedule();}
  else{cancelAnimationFrame(raf);raf=0;}
  syncPreview();
 }
 function schedule(){if(playing&&!waiting&&!raf)raf=requestAnimationFrame(tick);}
 function tick(time){
  raf=0;
  if(!playing||disposed)return;
  const target=elapsed+Math.max(0,time-anchor),desired=desiredAt(target);
  if(urls(desired).some(url=>cache.value(url)===undefined)){void seek(target);return;}
  paint(desired,target);schedule();
 }
 async function seek(target){
  const mine=++version,desired=desiredAt(target),wanted=urls(desired);
  waiting=true;
  cache.pin([...visible,...wanted]);
  await Promise.all(wanted.map(url=>cache.load(url,true)));
  if(disposed||mine!==version)return false;
  paint(desired,target);elapsed=target;anchor=clock();waiting=false;
  schedule();return true;
 }
 async function warm(){
  // Preload only the selected temporal sample; settings changes reuse stored bytes.
  const mine=++warmVersion,seen=new Set(),byTime=[...tracks.values()].map(track=>
   timings.get(track).indices.map(index=>track.frames.get(index)?.[mode]));
  const last=Math.max(...byTime.map(track=>track.length));
  for(let i=0;i<last&&!disposed&&mine===warmVersion&&!cache.warmLimit;i++){
   const batch=[];
   for(const track of byTime){
    const url=track[i];
    if(url&&!seen.has(url)){seen.add(url);batch.push(cache.load(url));}
   }
   await Promise.all(batch);
  }
 }
 function pause(){
  if(playing){
   elapsed=paintedTime;
   if(waiting){version++;waiting=false;cache.pin(visible);}
  }
  setPlaying(false);
 }
 function step(delta){
  pause();
  const stepMs=referenceTiming.intervalMs,number=Math.floor(paintedTime/stepMs+1e-7)+delta;
  void seek((number<0?referenceTiming.indices.length-1:number)*stepMs);
 }
 previous.addEventListener('click',()=>step(-1));next.addEventListener('click',()=>step(1));
 toggle.addEventListener('click',playbackClick);
 const hidden=()=>{if(document.hidden)pause();};
 const motionChanged=()=>{if(reduced.matches)pause();};
 document.addEventListener('visibilitychange',hidden);
 reduced.addEventListener('change',motionChanged);
 function setTiming(){
  if(disposed)return;
  timings=new Map([...tracks.values()].map(track=>[track,npcPreviewTiming(track,settings)]));
  referenceTiming=timings.get(reference);
  grid.dataset.framePercent=String(settings.percent);
  grid.dataset.frameIntervalMs=String(Number(referenceTiming.intervalMs.toFixed(2)));
  grid.dataset.frameTiming=settings.intervalMs===null?'recorded':'custom';
  grid.dataset.previewFrameCount=String(referenceTiming.indices.length);
  for(const cell of cells)if(cell.track)cell.figure.dataset.frameIntervalMs=String(Number(timings.get(cell.track).intervalMs.toFixed(2)));
  warmVersion++;cancelAnimationFrame(raf);raf=0;lastPaintSignature='';elapsed=0;paintedTime=0;
  void seek(0).then(ready=>{
   if(!ready||disposed)return;
   const hasFrame=cells.some(cell=>cell.figure.dataset.frameIndex!==undefined),canPlay=referenceTiming.indices.length>1;
   status.textContent=hasFrame?'':'첫 프레임을 읽지 못했습니다.';
   for(const button of [previous,toggle,next])button.disabled=!canPlay;
   syncPreview();
   if(!started){started=true;setPlaying(hasFrame&&canPlay&&!reduced.matches&&!document.hidden);}
   else if(!canPlay)setPlaying(false);
   void warm();
  });
 }
 setPlaying(false);
 setTiming();
 return {sourceInterval:recordedInterval(reference.fps),setTiming,dispose(){
  if(disposed)return;disposed=true;preview?.close({restoreFocus:false});setPlaying(false);
  abort.abort();cache.dispose();
  document.removeEventListener('visibilitychange',hidden);
  reduced.removeEventListener('change',motionChanged);
 }};
}
