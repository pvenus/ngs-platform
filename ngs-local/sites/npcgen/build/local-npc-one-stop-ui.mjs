import {isQueuedRequest} from './local-request-queue-browser.mjs';
import {motionCatalogSchema,motionSelectionOf,npcReplacementSlug,quickMotionSelection,sameMotionChoice,selectionReplaceSchemaVersion,
 selectionSchemaVersion,selectionLegacySchemaVersion,selectionLegacyReplaceSchemaVersion,validMotionChoice,validMotionSelection,validNpcMotionSelectionRequest,npcBasicSchema,validNpcBasicRequest} from './npc-motion-selection.mjs';
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
 'PAYLOAD_TOO_LARGE','NGS_REQUEST_QUEUE_INPUT_TOO_LARGE','SPACE_BODY_TOO_LARGE',
 'REQUEST_SUBMIT_INVALID','NPC_BASIC_PORTRAIT_UNAVAILABLE','NPC_POSE_SELECTION_V2_UNAVAILABLE','NGS_ONE_STOP_PAYLOAD_INVALID','OFFICIAL_REQUEST_NPC_ALREADY_REGISTERED',
 'ONE_STOP_REPLACE_TARGET_NOT_FOUND','ONE_STOP_REPLACE_IDENTITY_INVALID','ONE_STOP_MOTION_SELECTION_STALE',
 'NGS_NPC_PORTRAIT_REGENERATE_PAYLOAD_INVALID','NPC_PORTRAIT_EDIT_UNAVAILABLE','NPC_PORTRAIT_EDIT_TARGET_NOT_FOUND','NPC_PORTRAIT_EDIT_SOURCE_NOT_FOUND','NGS_NPC_ANIMATION_REGENERATE_PAYLOAD_INVALID','NPC_ANIMATION_REGENERATE_TARGET_NOT_FOUND','NPC_ANIMATION_REGENERATE_PRESETS_STALE',
]);

const basicBriefFields=Object.freeze([
 {key:'goal',label:'목표·등장 이유',example:'예: 실종된 딸을 찾고 있다. 처음에는 마을 사람에게 실종 사실을 숨긴다.'},
 {key:'behavior',label:'성격·평소 행동',example:'예: 말이 짧고 낯선 사람의 말을 바로 믿지 않는다. 아이 앞에서는 한 걸음 물러선다.'},
 {key:'palette',label:'퍼스널 컬러',example:'예: 먹색과 바랜 남색을 주로, 탁한 붉은색은 허리끈에만.'},
 {key:'appearance',label:'외형·복식의 단서',example:'예: 30대 후반, 각진 어깨, 단정하고 검소한 별감 차림.'},
]);
const basicBriefLimit=450;

export function composeNpcBasicIntent(values){
 const lines=basicBriefFields.map(({key,label})=>{
  const value=typeof values[key]==='string'?values[key].trim():'';
  if(!text(value,basicBriefLimit))throw Error(label+'을(를) 한두 줄로 입력해 주세요.');
  return label+': '+value;
 });
 const notes=typeof values.notes==='string'?values.notes.trim():'';
 if(notes){
  if(!text(notes,900))throw Error('추가 요청은 900자 이내로 입력해 주세요.');
  lines.push('추가 요청: '+notes);
 }
 return lines.join('\n\n');
}

function oneStopRequest(values,motionCatalog,target,poseSelectionV2Enabled,basic=false){
 const {name,role,actId,chapterId}=values,slug=target?.slug??values.slug?.trim();
 if(!text(name,60)||!text(role,300)||!validId(slug)||!slugPattern.test(slug)||(!target&&!validId('npc.'+slug))||!validId(actId)||!validId(chapterId)){
  throw Error('이름, 식별 이름, 역할과 스토리 위치를 확인해 주세요.');
 }
 const intent=basic?composeNpcBasicIntent(values):values.intent?.trim();
 if(!text(intent,3500)||count(intent)<5)throw Error('기획 요청은 5~3,500자로 입력해 주세요.');
 const sourceRefs=basic?['사용자 기획 요청']:typeof values.sourceRefs==='string'?values.sourceRefs.split('\n').map(s=>s.trim()).filter(Boolean):[];
 if(!sourceRefs.length||sourceRefs.length>64||sourceRefs.some(ref=>count(ref)>300))throw Error('근거 참조를 한 줄에 하나씩 입력해 주세요. 최대 64줄, 줄당 300자입니다.');
 const character={npcId:target?.npcId??'npc.'+slug,name:name.trim(),slug,role:role.trim(),actId,chapterId};
 if(basic){
  const combatRequirements=typeof values.combatRequirements==='string'?values.combatRequirements.trim():'';
  const body={schemaVersion:npcBasicSchema,projectId:'binari',character,intent,sourceRefs,includeCombat:values.includeCombat,
   ...(values.includeCombat===true&&combatRequirements?{combatRequirements}:{})};
  if(target||!validNpcBasicRequest(body))throw Error('요청 입력 내용을 확인해 주세요.');
  return body;
 }
 const chosen=values.motionSelection;
 if((!validMotionSelection(chosen)&&!(Array.isArray(chosen)&&chosen.length===0&&!target))||!chosen.every(choice=>motionCatalog.some(row=>sameMotionChoice(choice,row)))){
  throw Error('게시된 모션 프리셋을 한 개 이상 선택하세요. 변경된 선택은 해제한 뒤 다시 골라 주세요.');
 }
 const schemaVersion=poseSelectionV2Enabled===true
  ?(target?selectionReplaceSchemaVersion:selectionSchemaVersion)
  :(target?selectionLegacyReplaceSchemaVersion:selectionLegacySchemaVersion);
 const body={schemaVersion,projectId:'binari',
  character,intent,sourceRefs,
  motionSelection:chosen.map(motionSelectionOf)};
 if(!validNpcMotionSelectionRequest(body))throw Error('요청 입력 내용을 확인해 주세요.');
 return body;
}
export const newNpcOneStopRequest=(values,motionCatalog=[],poseSelectionV2Enabled=false)=>oneStopRequest(values,motionCatalog,null,poseSelectionV2Enabled);

export const newNpcBasicRequest=values=>oneStopRequest(values,[],null,false,true);

export function npcReplacementTarget(npc){
 const npcId=npc?.id;
 const slug=npcReplacementSlug(npcId);
 if(!slug||(npc.slug!==undefined&&npc.slug!==slug))return null;
 const act=validId(npc.actId)?npc.actId:'story.main.act01';
 return {npcId,slug,name:typeof npc.name==='string'?npc.name:'',role:typeof npc.role==='string'?npc.role:'',
  actId:npcId.startsWith('character.')&&act==='story.main.act01'?'act01':act,
  chapterId:Array.isArray(npc.chapters)?npc.chapters.find(validId)??'chapter01':'chapter01'};
}

export function readyCombatPreset(id,detail){
 const record=detail?.motionPreset,rows=record?.directions;
 if(typeof id!=='string'||!presetId.test(id)||detail?.item?.id!==id||record?.presetId!==id||record.posePreset!=='combat'||Object.hasOwn(record,'variant')||
    !Array.isArray(rows)||rows.length!==directions.length)return null;
 const published=new Set();
 for(const row of rows){
  if(!row||!directions.includes(row.direction)||published.has(row.direction)||
     typeof row.path!=='string'||!/^motion-presets\/assets\/[a-f0-9]{64}\.mp4$/u.test(row.path))return null;
  published.add(row.direction);
 }
 return {presetId:id,label:[record.label,detail.item.label].find(label=>typeof label==='string'&&label.trim())??id};
}
export async function readOneStopMotionPresets(request,signal){
 const url='/api/project-workspace?'+new URLSearchParams({projectId:'binari',tab:'motion-presets',view:'selection'});
 const catalog=await request(url,{signal});
 if(catalog?.schemaVersion!==motionCatalogSchema||!Array.isArray(catalog.presets)||catalog.presets.length>4096||
    !catalog.presets.every(validMotionChoice)||new Set(catalog.presets.map(row=>row.presetId.toLowerCase())).size!==catalog.presets.length)
  throw Error('MOTION_SELECTION_CATALOG_UNAVAILABLE');
 return catalog.presets;
}

export function createNpcOneStopIntake(submit,{key=()=>crypto.randomUUID(),requestType='npc.workflow'}={}){
 let pending=null,busy=false,accepted=false;
 return {
  get waitingConfirmation(){return pending!==null;},
  get accepted(){return accepted;},
  async send(makeRequest){
   if(busy||accepted)return null;
   if(!pending)pending={requestType,idempotencyKey:key(),payload:makeRequest()};
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
 if(['PAYLOAD_TOO_LARGE','NGS_REQUEST_QUEUE_INPUT_TOO_LARGE','SPACE_BODY_TOO_LARGE'].includes(code))
  return '요청 용량이 너무 큽니다. 선택이나 입력 내용을 줄여 주세요.';
 if(code==='ONE_STOP_MOTION_SELECTION_STALE')return '선택한 프리셋이 변경됐습니다. 선택을 해제한 뒤 다시 골라 주세요.';
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

export function mountNpcOneStop(owner,{submit,request,signal,replaceNpc,modalOwner=owner,poseSelectionV2Enabled=false,basic=false,newVersion=false}){
 const target=replaceNpc===undefined?null:npcReplacementTarget(replaceNpc);
 if(replaceNpc!==undefined&&!target)return null;
 const action=target?'종합 재생성':newVersion?'새 버전 생성':basic?'기본 생성':'종합 생성',titleText='NPC '+action;
 const headingId=target?'npc-one-stop-replace-heading':newVersion?'npc-one-stop-version-heading':'npc-one-stop-heading';
 let bar=owner;
 if(!target&&!newVersion){
  const title=owner.querySelector('h3');
  bar=owner.querySelector('.npc-one-stop-roster-heading');
  if(!bar){bar=node('div','npc-one-stop-roster-heading');title.before(bar);bar.append(title);}
  owner.querySelector('.npc-one-stop-trigger')?.remove();
 }
 const trigger=node('button',target?'npc-one-stop-replace-trigger':newVersion?'npc-portrait-scoped-trigger':'npc-one-stop-trigger',target?'':newVersion?'새 버전':'+');
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
   basic?'새 폴더에 입력한 기획으로 처음부터 생성합니다. 기존 NPC 기획·이미지를 복제하지 않습니다.':'새 NPC의 기획과 포트레이트를 생성합니다. 모션을 선택하면 애니메이션도 함께 생성합니다.');
  const form=node('form','one-stop-intake'),fields=node('fieldset'),notice=node('p','meta');
  fields.append(node('legend','',target?'기존 NPC 재생성':'새 NPC 생성'));
  const error=node('p','meta error');error.setAttribute('role','alert');notice.setAttribute('role','status');
  const required={required:true};
  const name=field('이름','input',{...required,maxLength:60,autocomplete:'off',value:target?.name??''});
  const slug=field(target?'기존 NPC ID':'ID (식별 이름)','input',{...required,maxLength:target?128:124,
   autocomplete:'off',spellcheck:false,readOnly:Boolean(target),value:target?.npcId??''});
  const role=field(basic?'직업·이야기 속 역할 (필수)':'직업·간략 역할','input',{...required,maxLength:300,
   placeholder:basic?'예: 실종 사건을 조사하는 별감이자 아이의 아버지':'',value:target?.role??''});
  const act=field('Act ID','input',{...required,maxLength:128,value:target?.actId??(basic?'act01':'story.main.act01'),spellcheck:false});
  const chapter=field('챕터 ID','input',{...required,maxLength:128,value:target?.chapterId??'chapter01',spellcheck:false});
  const intent=field('기획 요청','textarea',{...required,minLength:5,maxLength:3500});
  const refs=field('근거 참조 · 한 줄에 하나','textarea',required);
  section(fields,'기본 정보','one-stop-basic',[name,slug,role]);
  section(fields,'스토리 위치','one-stop-location',[act,chapter]);
  const briefInputs=basic?Object.fromEntries(basicBriefFields.map(({key,label,example})=>
   [key,field(label+' (필수)','textarea',{...required,rows:2,maxLength:basicBriefLimit,placeholder:example})])):{};
  const extraNotes=field('추가 요청 (선택)','textarea',{rows:2,maxLength:900,placeholder:'예: 왼쪽 눈썹의 흉터는 유지. 갑옷이나 과한 장신구는 피하기.'});
  if(basic)fields.append(node('p','meta','항목마다 한두 줄이면 충분합니다. 정해지지 않았다면 미정이라고 쓰고, 모델이 제안해도 되는 범위를 적어 주세요.'));
  section(fields,'기획 요청','one-stop-planning',basic?[...Object.values(briefInputs),extraNotes]:[intent,refs]);
  const options=node('section','one-stop-section one-stop-options');
  const presets=node('fieldset'),legend=node('legend','','모션 프리셋 선택');
  const quick=node('div','one-stop-motion-quick'),noncombat=node('button','','비전투 기본'),combat=node('button','','전투 기본');
  noncombat.type=combat.type='button';quick.append(noncombat,combat);
  const pick=node('div','one-stop-motion-choices'),motionInfo=node('p','meta'),selectionInfo=node('p','meta');
  motionInfo.setAttribute('role','status');selectionInfo.setAttribute('role','status');
  presets.append(legend,quick,motionInfo,pick,selectionInfo);
  const combatChoice=node('input');combatChoice.type='checkbox';
  const combatRequest=field('전투 추가 요청 (선택)','textarea',{rows:3,maxLength:900,
   placeholder:'예: 오른손에 환도를 낮게 들고, 반 걸음 물러서 경계하는 자세. 장부나 장식품은 제외.'});
  function toggleCombatRequest(){
   const enabled=basic&&combatChoice.checked===true;
   combatRequest.root.hidden=!enabled;combatRequest.input.disabled=!enabled;
   combatChoice.setAttribute('aria-expanded',String(enabled));
  }
  combatRequest.root.id=headingId+'-combat-request';
  combatChoice.setAttribute('aria-controls',combatRequest.root.id);
  combatChoice.addEventListener('change',toggleCombatRequest);
  toggleCombatRequest();
  if(basic){
   const extra=node('label','one-stop-motion-option');
   extra.append(combatChoice,node('span','','전투 대표 포트레이트 추가'));
   options.append(node('h3','','생성 항목'),
    node('p','meta','대표·아이들 원본은 기본으로 만들고, 8방향은 이후 별도로 요청합니다.'),extra,combatRequest.root);
  }else options.append(node('h3','','생성 옵션'),presets);
  fields.append(options);
  const send=node('button','npc-one-stop-submit',action+' 요청');send.type='submit';
  form.append(fields,send);modal.append(header,intro,form,error,notice);

  // Keep one immutable command for an ambiguous receipt, never send a second key.
  const carry=intake?.waitingConfirmation===true;
  if(!carry)intake=createNpcOneStopIntake(submit);
  let pending=false,ended=false,motionCatalog=null,catalogError=false,pollTimer=null,catalogKey=null;
  const catalogController=new AbortController(),selected=new Map(),checkBoxes=new Map();
  if(carry)error.textContent='앞서 보낸 요청의 접수를 먼저 확인해 주세요.';
  const liveRow=choice=>motionCatalog?.find(row=>row.presetId===choice.presetId);
  const staleChoice=choice=>!sameMotionChoice(choice,liveRow(choice));
  function updateControls(){
   const frozen=intake.waitingConfirmation,stale=[...selected.values()].filter(staleChoice).length;
   fields.disabled=pending||frozen||intake.accepted;
   fields.hidden=carry&&frozen;
   send.disabled=pending||intake.accepted||(!frozen&&(selected.size>0?(catalogError||!motionCatalog||stale>0):Boolean(target)));
   send.textContent=pending?'접수 중…':frozen?'같은 접수 다시 확인':action+' 요청';
   close.disabled=pending;
   noncombat.disabled=!quickMotionSelection('noncombat',motionCatalog??[])||catalogError;
   combat.disabled=!quickMotionSelection('combat',motionCatalog??[])||catalogError;
   noncombat.title=noncombat.disabled?'walk-flat, run-flat이 모두 게시되면 선택할 수 있습니다.':'walk-flat, run-flat 선택';
   combat.title=combat.disabled?'walk-flat, run-flat, sword-attack-flat이 모두 게시되면 선택할 수 있습니다.':'walk-flat, run-flat, sword-attack-flat 선택';
   for(const [id,{check,label,row}] of checkBoxes){
    const choice=selected.get(id);
    check.checked=!!choice;check.disabled=!choice&&catalogError;
    label.textContent=row?row.label+' · '+row.presetId+(choice&&staleChoice(choice)?' · 게시 내용 변경, 다시 선택 필요':''):
     id+' · 현재 게시되지 않음, 선택 해제 필요';
   }
   selectionInfo.textContent=!target&&selected.size===0?'0개 선택 · 기획과 포트레이트만 생성':selected.size+'개 선택'+(stale?' · '+stale+'개 다시 선택 필요':'');
  }
  function renderMotions(){
   pick.replaceChildren();checkBoxes.clear();
   const add=(id,row,parent)=>{
    const label=node('label'),check=node('input'),textLabel=node('span');
    check.type='checkbox';
    check.addEventListener('change',()=>{
     if(!check.checked){selected.delete(id);if(!row){renderMotions();return;}}
     else if(row&&!catalogError&&!selected.has(id))selected.set(id,motionSelectionOf(row));
     updateControls();
    });
    label.append(check,textLabel);parent.append(label);checkBoxes.set(id,{check,label:textLabel,row});
   };
   for(const [pose,title] of [['idle','아이들'],['combat','전투']]){
    const rows=(motionCatalog??[]).filter(row=>row.posePreset===pose);
    if(!rows.length)continue;
    const group=node('div','one-stop-motion-group');group.append(node('strong','',title));
    for(const row of rows)add(row.presetId,row,group);
    pick.append(group);
   }
   const removed=[...selected.keys()].filter(id=>!checkBoxes.has(id));
   if(removed.length){
    const group=node('div','one-stop-motion-group');group.append(node('strong','','재선택 필요'));
    for(const id of removed)add(id,null,group);
    pick.append(group);
   }
   updateControls();
  }
  function prefill(kind){
   if(ended||catalogError)return;
   const rows=quickMotionSelection(kind,motionCatalog??[]);
   if(!rows)return;
   selected.clear();
   for(const row of rows)selected.set(row.presetId,row);
   renderMotions();
  }
  noncombat.addEventListener('click',()=>prefill('noncombat'));
  combat.addEventListener('click',()=>prefill('combat'));
  async function pollCatalog(){
   if(ended||catalogController.signal.aborted||intake.accepted)return;
   if(!pending&&!intake.waitingConfirmation){
    try{
     const rows=await readOneStopMotionPresets(request,catalogController.signal);
     if(ended||catalogController.signal.aborted)return;
     catalogError=false;motionCatalog=rows;
     motionInfo.textContent=rows.length?'필요한 동작과 스타일을 함께 고를 수 있습니다. 기본 버튼은 선택을 채울 뿐입니다.':'게시된 8방향 모션이 없습니다.';
     const key=JSON.stringify(rows);
     if(key!==catalogKey){catalogKey=key;renderMotions();}else updateControls();
    }catch{
     if(ended||catalogController.signal.aborted)return;
     catalogError=true;motionInfo.textContent='게시된 모션을 확인하지 못했습니다. 다시 확인하고 있습니다.';updateControls();
    }
   }
   if(!ended&&!intake.accepted)pollTimer=setTimeout(pollCatalog,4000);
  }
  motionInfo.textContent='게시된 8방향 모션을 확인하고 있습니다.';
  function leave(force=false){
   if(ended||pending&&!force)return;
   ended=true;catalogController.abort();clearTimeout(pollTimer);
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
      chapterId:chapter.input.value,intent:intent.input.value,sourceRefs:refs.input.value,
      ...(basic?{...Object.fromEntries(Object.entries(briefInputs).map(([key,control])=>[key,control.input.value])),notes:extraNotes.input.value}:{}),
      motionSelection:[...selected.values()],includeCombat:combatChoice.checked===true,combatRequirements:combatRequest.input.value},motionCatalog??[],target,poseSelectionV2Enabled,basic);
     requestBuilt=true;return body;
    });
    if(receipt&&!ended){
     notice.textContent=receipt.status==='queued'?'NGS 대기열에 저장했습니다.':'요청을 접수했습니다.';
     form.hidden=true;intro.hidden=true;
    }
   }catch(failure){
    if(!ended)error.textContent=!requestBuilt?failure.message:failure.definitive?rejectMessage(failure.message,Boolean(target))
     :'접수 응답을 확인하지 못했습니다. 같은 접수를 다시 확인해 주세요.';
   }finally{if(!ended){pending=false;updateControls();if(intake.accepted)close.focus({preventScroll:true});}}
  });
  updateControls();modalOwner.append(modal);modal.showModal();if(!basic)void pollCatalog();
  if(carry)send.focus();else name.input.focus();
 }
 trigger.addEventListener('click',open);
 signal.addEventListener('abort',()=>{closeCurrent();trigger.remove();},{once:true});
 return trigger;
}
