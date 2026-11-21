import {isQueuedRequest} from './local-request-queue-browser.mjs';
/** The roster '+' creates a new NPC; the detail action targets the selected NPC ID. */
const directions=['n','ne','e','se','s','sw','w','nw'];
const identifier=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const slugPattern=/^[a-z0-9]+(?:[-._][a-z0-9]+)*$/;
const presetId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const count=value=>Array.from(value).length;
const text=(value,max)=>typeof value==='string'&&value.trim()&&count(value)<=max;
const validId=value=>typeof value==='string'&&value===value.trim()&&identifier.test(value);
const optionalCode=value=>typeof value==='string'&&/^[A-Z0-9_]{1,100}$/.test(value)?value:null;
const knownRejections=new Set([
 'ONE_STOP_REQUEST_REQUIRED','ONE_STOP_REQUEST_INVALID','ONE_STOP_CHARACTER_INVALID','ONE_STOP_JSON_INVALID',
 'ONE_STOP_INTENT_INVALID','ONE_STOP_REFERENCES_INVALID','ONE_STOP_TARGET_ALREADY_ACTIVE',
 'ONE_STOP_COMBAT_PRESETS_REQUIRED','ONE_STOP_COMBAT_PRESETS_UNEXPECTED','ONE_STOP_COMBAT_PRESET_INVALID',
 'COMMON_INVALID_IDENTIFIER','ORIGIN_OR_CSRF_REJECTED','CSRF_INVALID','PROJECT_OR_RESOURCE_DENIED',
 'LOCAL_SIGN_IN_REQUIRED','LOCAL_SESSION_EXPIRED_OR_REVOKED','FRONTEND_SESSION_CONTEXT_CHANGED',
 'REQUEST_SUBMIT_INVALID','NGS_ONE_STOP_PAYLOAD_INVALID','OFFICIAL_REQUEST_NPC_ALREADY_REGISTERED',
 'ONE_STOP_REPLACE_TARGET_NOT_FOUND','ONE_STOP_REPLACE_IDENTITY_INVALID',
]);

function oneStopRequest(values,combatCatalog,target){
 const {name,role,actId,chapterId}=values,slug=target?.slug??values.slug?.trim(),intent=values.intent?.trim();
 if(!text(name,60)||!text(role,300)||!validId(slug)||!slugPattern.test(slug)||!validId('npc.'+slug)||!validId(actId)||!validId(chapterId)){
  throw Error('이름, 식별 이름, 역할과 스토리 위치를 확인해 주세요.');
 }
 if(!text(intent,3500)||count(intent)<5)throw Error('기획 요청은 5~3,500자로 입력해 주세요.');
 const sourceRefs=typeof values.sourceRefs==='string'?values.sourceRefs.split('\n').map(s=>s.trim()).filter(Boolean):[];
 if(!sourceRefs.length||sourceRefs.length>64||sourceRefs.some(ref=>count(ref)>300))throw Error('근거 참조를 한 줄에 하나씩 입력해 주세요. 최대 64줄, 줄당 300자입니다.');
 const includeCombat=values.includeCombat===true,chosen=values.selectedCombat??[];
 if(includeCombat&&(!Array.isArray(chosen)||chosen.length<1||chosen.length>16||new Set(chosen).size!==chosen.length
    ||chosen.some(id=>!combatCatalog.some(row=>row.presetId===id)))){
  throw Error('게시된 전투 모션 프리셋을 1~16개 선택하세요.');
 }
 return {schemaVersion:target?'ngs.npc-one-stop.replace.v1':'ngs.npc-one-stop.v1',projectId:'binari',
  character:{npcId:target?.npcId??'npc.'+slug,name:name.trim(),slug,role:role.trim(),actId,chapterId},intent,sourceRefs,includeCombat,
  ...(includeCombat?{combatMotionPresets:[...chosen]}:{})};
}
export const newNpcOneStopRequest=(values,combatCatalog=[])=>oneStopRequest(values,combatCatalog,null);
export function npcReplacementTarget(npc){
 const npcId=npc?.id;
 if(!validId(npcId)||!npcId.startsWith('npc.'))return null;
 const slug=npc.slug??npcId.slice(4);
 if(!validId(slug)||!slugPattern.test(slug)||!validId('npc.'+slug))return null;
 return {npcId,slug,name:typeof npc.name==='string'?npc.name:'',role:typeof npc.role==='string'?npc.role:'',
  actId:validId(npc.actId)?npc.actId:'story.main.act01',
  chapterId:Array.isArray(npc.chapters)?npc.chapters.find(validId)??'chapter01':'chapter01'};
}

export function readyCombatPreset(id,detail){
 const record=detail?.motionPreset,rows=record?.directions;
 if(typeof id!=='string'||!presetId.test(id)||detail?.item?.id!==id||record?.presetId!==id||record.posePreset!=='combat'||
    !Array.isArray(rows)||rows.length!==directions.length)return null;
 const published=new Set();
 for(const row of rows){
  if(!row||!directions.includes(row.direction)||published.has(row.direction)||
     typeof row.path!=='string'||!/^motion-presets\/assets\/[a-f0-9]{64}\.mp4$/u.test(row.path))return null;
  published.add(row.direction);
 }
 return {presetId:id,label:[record.label,detail.item.label].find(label=>typeof label==='string'&&label.trim())??id};
}
export async function readOneStopCombatPresets(request,signal){
 const api=values=>'/api/project-workspace?'+new URLSearchParams({projectId:'binari',tab:'motion-presets',...values});
 const index=await request(api({}),{signal});
 if(!Array.isArray(index?.items))throw Error('COMBAT_CATALOG_UNAVAILABLE');
 const output=Array(index.items.length);let cursor=0,anyRead=false;
 async function worker(){
  while(cursor<index.items.length&&!signal.aborted){
   const i=cursor++,id=index.items[i]?.id;
   if(typeof id!=='string'||!presetId.test(id))continue;
   try{
    const detail=await request(api({item:id}),{signal});
    if(detail?.item?.id!==id||detail.motionPreset?.presetId!==id||!Array.isArray(detail.motionPreset.directions))continue;
    anyRead=true;output[i]=readyCombatPreset(id,detail);
   }catch{/* Unverified entries are never offered as formal preset options. */}
  }
 }
 await Promise.all(Array.from({length:Math.min(3,index.items.length)},worker));
 if(index.items.length&&!anyRead&&!signal.aborted)throw Error('COMBAT_CATALOG_UNAVAILABLE');
 const unique=new Set();
 return output.filter(row=>row&&!unique.has(row.presetId)&&unique.add(row.presetId));
}

export function createNpcOneStopIntake(submit,{key=()=>crypto.randomUUID()}={}){
 let pending=null,busy=false,accepted=false;
 return {
  get waitingConfirmation(){return pending!==null;},
  get accepted(){return accepted;},
  async send(makeRequest){
   if(busy||accepted)return null;
   if(!pending)pending={requestType:'npc.workflow',idempotencyKey:key(),payload:makeRequest()};
   busy=true;
   try{
    const response=await submit(pending);
    const value=await response.json();
    if(isQueuedRequest(response,value)){pending=null;accepted=true;return value;}
    const id=value?.officialRequestId;
    if((response.status===201||response.status===200)&&value?.status==='registered'&&typeof id==='string'&&id.trim()){
     pending=null;accepted=true;return {officialRequestId:id,status:'registered'};
    }
    const code=optionalCode(value?.error);
    if(response.status>=400&&response.status<500&&code&&knownRejections.has(code)){
     pending=null;
     throw Object.assign(Error(code),{definitive:true});
    }
    throw Error('NPC_ONE_STOP_RECEIPT_UNCONFIRMED');
   }finally{busy=false;}
  },
 };
}

function node(tag,className='',label){
 const child=document.createElement(tag);
 if(className)child.className=className;
 if(label!==undefined)child.textContent=label;
 return child;
}
function field(label,tag='input',options={}){
 const root=node('label','',label),input=Object.assign(node(tag),options);
 root.append(input);return {root,input};
}
function section(parent,title,className,fields){
 const body=node('section','one-stop-section'),grid=node('div',className);
 grid.append(...fields.map(field=>field.root));body.append(node('h3','',title),grid);parent.append(body);
}
const rejectMessage=(code,replacing)=>{
 if(replacing&&code==='ONE_STOP_TARGET_ALREADY_ACTIVE')return '이 NPC의 요청이 이미 처리 중입니다.';
 if(replacing&&['ONE_STOP_REPLACE_TARGET_NOT_FOUND','ONE_STOP_REPLACE_IDENTITY_INVALID'].includes(code))
  return '기존 NPC 정보를 확인할 수 없습니다. 페이지를 다시 열어 주세요.';
 if(['ONE_STOP_TARGET_ALREADY_ACTIVE','OFFICIAL_REQUEST_NPC_ALREADY_REGISTERED'].includes(code))return '이 식별 이름의 NPC가 있거나 처리 중입니다. 다른 식별 이름을 사용해 주세요.';
 if(['LOCAL_SIGN_IN_REQUIRED','FRONTEND_SESSION_CONTEXT_CHANGED','PROJECT_OR_RESOURCE_DENIED','CSRF_INVALID','ORIGIN_OR_CSRF_REJECTED'].includes(code)){
  return '이 화면의 접수 권한을 확인할 수 없습니다. 페이지를 다시 열어 주세요.';
 }
 return '요청을 받지 못했습니다. 입력 내용을 확인해 주세요.';
};

function npcRegenerateIcon(){
 const ns='http://www.w3.org/2000/svg',icon=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
 for(const [name,value] of Object.entries({viewBox:'0 0 24 24',width:'18',height:'18',fill:'none',stroke:'currentColor',
  'stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))icon.setAttribute(name,value);
 path.setAttribute('d','M20 5v5h-5M20 10a8 8 0 1 0-1 7');
 icon.append(path);return icon;
}

export function mountNpcOneStop(owner,{submit,request,signal,replaceNpc,modalOwner=owner}){
 const target=replaceNpc===undefined?null:npcReplacementTarget(replaceNpc);
 if(replaceNpc!==undefined&&!target)return null;
 const action=target?'종합 재생성':'종합 생성',titleText='NPC '+action;
 const headingId=target?'npc-one-stop-replace-heading':'npc-one-stop-heading';
 let bar=owner;
 if(!target){
  const title=owner.querySelector('h3');
  bar=owner.querySelector('.npc-one-stop-roster-heading');
  if(!bar){bar=node('div','npc-one-stop-roster-heading');title.before(bar);bar.append(title);}
  owner.querySelector('.npc-one-stop-trigger')?.remove();
 }
 const trigger=node('button',target?'npc-one-stop-replace-trigger':'npc-one-stop-trigger',target?'':'+');
 if(target)trigger.append(npcRegenerateIcon());
 trigger.type='button';trigger.setAttribute('aria-haspopup','dialog');
 trigger.setAttribute('aria-label',titleText);trigger.title=titleText;
 bar.append(trigger);
 let dialog=null,intake=null,closeCurrent=()=>{};
 function open(){
  if(dialog||signal.aborted)return;
  const modal=node('dialog','npc-one-stop-dialog');dialog=modal;
  modal.setAttribute('aria-labelledby',headingId);
  const header=node('header'),heading=node('h2','',titleText),close=node('button','','닫기');
  heading.id=headingId;close.type='button';header.append(heading,close);
  const intro=node('p','meta',target?
   `기존 NPC ${target.name} (${target.npcId})를 같은 ID로 재생성하도록 요청합니다. 새 NPC를 추가하지 않습니다.`:
   '새 NPC의 기획, 포트레이트, 8방향과 프레임 생성을 한 번에 요청합니다.');
  const form=node('form','one-stop-intake'),fields=node('fieldset'),notice=node('p','meta');
  fields.append(node('legend','',target?'기존 NPC 재생성':'새 NPC 생성'));
  const error=node('p','meta error');error.setAttribute('role','alert');notice.setAttribute('role','status');
  const required={required:true};
  const name=field('이름','input',{...required,maxLength:60,autocomplete:'off',value:target?.name??''});
  const slug=field(target?'기존 NPC ID':'ID (식별 이름)','input',{...required,maxLength:target?128:124,
   autocomplete:'off',spellcheck:false,readOnly:Boolean(target),value:target?.npcId??''});
  const role=field('직업·간략 역할','input',{...required,maxLength:300,value:target?.role??''});
  const act=field('Act ID','input',{...required,maxLength:128,value:target?.actId??'story.main.act01',spellcheck:false});
  const chapter=field('챕터 ID','input',{...required,maxLength:128,value:target?.chapterId??'chapter01',spellcheck:false});
  const intent=field('기획 요청','textarea',{...required,minLength:5,maxLength:3500});
  const refs=field('근거 참조 · 한 줄에 하나','textarea',required);
  section(fields,'기본 정보','one-stop-basic',[name,slug,role]);
  section(fields,'스토리 위치','one-stop-location',[act,chapter]);
  section(fields,'기획 요청','one-stop-planning',[intent,refs]);
  const options=node('section','one-stop-section one-stop-options'),combatLabel=node('label');
  const combat=node('input');combat.type='checkbox';combatLabel.append(combat,document.createTextNode(' 전투 캐릭터'));
  const presets=node('fieldset'),legend=node('legend','','전투 모션 프리셋 · 1~16개 선택');
  const pick=node('div');presets.append(legend,pick);presets.hidden=true;
  options.append(node('h3','','생성 옵션'),combatLabel,presets);fields.append(options);
  const send=node('button','npc-one-stop-submit',action+' 요청');send.type='submit';
  form.append(fields,send);modal.append(header,intro,form,error,notice);

  // Keep one immutable command for an ambiguous receipt, never send a second key.
  const carry=intake?.waitingConfirmation===true;
  if(!carry)intake=createNpcOneStopIntake(submit);
  let pending=false,ended=false,combatLoad=null,combatCatalog=null,combatError=false;
  const selected=new Set();
  if(carry)error.textContent='앞서 보낸 요청의 접수를 먼저 확인해 주세요.';
  function updateControls(){
   const frozen=intake.waitingConfirmation;
   fields.disabled=pending||frozen||intake.accepted;
   fields.hidden=carry&&frozen;
   send.disabled=pending||intake.accepted||(!frozen&&combat.checked&&(!combatCatalog||!selected.size));
   send.textContent=pending?'접수 중…':frozen?'같은 접수 다시 확인':action+' 요청';
   close.disabled=pending;
  }
  function renderCombat(){
   presets.hidden=!combat.checked;pick.replaceChildren();
   if(!combat.checked){updateControls();return;}
   if(combatError)pick.append(node('p','meta error','게시된 전투 프리셋을 확인하지 못했습니다.'));
   else if(combatCatalog===null)pick.append(node('p','meta','등록된 전투 프리셋 확인 중…'));
   else if(!combatCatalog.length)pick.append(node('p','meta','사용 가능한 8방향 전투 프리셋이 없습니다.'));
   else for(const row of combatCatalog){
    const label=node('label'),check=node('input');
    check.type='checkbox';check.checked=selected.has(row.presetId);check.disabled=!check.checked&&selected.size>=16;
    check.addEventListener('change',()=>{
     if(check.checked&&selected.size<16)selected.add(row.presetId);else selected.delete(row.presetId);
     for(const input of pick.querySelectorAll('input'))input.disabled=!input.checked&&selected.size>=16;
     updateControls();
    });
    label.append(check,document.createTextNode(' '+row.label+' · '+row.presetId));pick.append(label);
   }
   updateControls();
  }
  combat.addEventListener('change',()=>{
   combatLoad?.abort();combatLoad=null;
   if(combat.checked&&combatCatalog===null){
    const controller=new AbortController();combatLoad=controller;combatError=false;
    void readOneStopCombatPresets(request,controller.signal).then(rows=>{
     if(controller.signal.aborted||ended)return;
     combatCatalog=rows;renderCombat();
    }).catch(()=>{
     if(!controller.signal.aborted&&!ended){combatError=true;renderCombat();}
    });
   }
   renderCombat();
  });
  function leave(force=false){
   if(ended||pending&&!force)return;
   ended=true;combatLoad?.abort();
   if(modal.open)modal.close();
   modal.remove();dialog=null;
   if(!intake.waitingConfirmation)intake=null;
   if(!force&&trigger.isConnected)trigger.focus({preventScroll:true});
  }
  modal.addEventListener('cancel',event=>{event.preventDefault();leave();});
  close.addEventListener('click',()=>leave());
  closeCurrent=()=>leave(true);
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(pending||intake.accepted||send.disabled)return;
   error.textContent='';pending=true;updateControls();
   let requestBuilt=false;
   try{
    if(intake.waitingConfirmation)requestBuilt=true;
    const receipt=await intake.send(()=>{
     const body=oneStopRequest({name:name.input.value,slug:slug.input.value,role:role.input.value,actId:act.input.value,
      chapterId:chapter.input.value,intent:intent.input.value,sourceRefs:refs.input.value,includeCombat:combat.checked,
      selectedCombat:[...selected]},combatCatalog??[],target);
     requestBuilt=true;return body;
    });
    if(receipt&&!ended){
     notice.textContent=receipt.status==='queued'?'로컬 큐에 저장했습니다.':'요청을 접수했습니다.';
     form.hidden=true;intro.hidden=true;
    }
   }catch(failure){
    if(!ended)error.textContent=!requestBuilt?failure.message:failure.definitive?rejectMessage(failure.message,Boolean(target))
     :'접수 응답을 확인하지 못했습니다. 같은 접수를 다시 확인해 주세요.';
   }finally{if(!ended){pending=false;updateControls();if(intake.accepted)close.focus({preventScroll:true});}}
  });
  updateControls();modalOwner.append(modal);modal.showModal();
  if(carry)send.focus();else name.input.focus();
 }
 trigger.addEventListener('click',open);
 signal.addEventListener('abort',()=>{closeCurrent();trigger.remove();},{once:true});
 return trigger;
}
