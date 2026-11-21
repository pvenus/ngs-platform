import {isQueuedRequest} from './local-request-queue-browser.mjs';
import {parseRequiredSections,validRequiredSections} from './local-concept-category-contract.mjs';
import {conceptMarkdown} from './local-concept-category-ui.mjs';

export const npcPlanningRoles=Object.freeze([
 ['overview','인물 개요'],['portrait.art','포트레이트용 아트'],
 ['portrait.representative','대표 포즈 기획'],['portrait.idle','아이들 포즈 기획'],
].map(Object.freeze));
const schemaVersion='ngs.npc-planning-update.v1';
export const npcPlanningRequestType='npc.planning.update';
export const npcPlanningAddType='npc.planning.add';
const addSchema='ngs.npc-planning-add.v1';
const newCategory=/^category\.add\.[a-f0-9]{32}$/;
const idPattern=/^(?:npc|character)\.[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/;
const officialId=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const known=new Set(['NGS_NPC_PLANNING_UPDATE_PAYLOAD_INVALID','NGS_NPC_PLANNING_ADD_PAYLOAD_INVALID','NPC_PLANNING_UPDATE_REQUEST_INVALID',
 'OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT',
 'LOCAL_SIGN_IN_REQUIRED','FRONTEND_SESSION_CONTEXT_CHANGED','PROJECT_OR_RESOURCE_DENIED','CSRF_INVALID',
 'LOCAL_SESSION_EXPIRED_OR_REVOKED','REQUEST_SUBMIT_INVALID']);
export function validNpcPlanningUpdate(value){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')==='npcId,projectId,requirements,role,schemaVersion'&&
  value.schemaVersion===schemaVersion&&value.projectId==='binari'&&
  typeof value.npcId==='string'&&value.npcId===value.npcId.trim()&&idPattern.test(value.npcId)&&
  npcPlanningRoles.some(([role])=>role===value.role)&&typeof value.requirements==='string'&&
  value.requirements.isWellFormed()&&value.requirements===value.requirements.trim()&&
  value.requirements.length>0&&[...value.requirements].length<=4000&&!control.test(value.requirements);
}
export function makeNpcPlanningUpdate({npcId,role},requirements){
 const payload={schemaVersion,projectId:'binari',npcId,role,requirements:requirements.trim()};
 if(!validNpcPlanningUpdate(payload))throw Error('NPC_PLANNING_UPDATE_REQUEST_INVALID');
 return payload;
}

const validText=(value,min,max)=>typeof value==='string'&&value.isWellFormed()&&value===value.trim()&&
 [...value].length>=min&&[...value].length<=max&&!control.test(value);
export function validNpcPlanningAdd(value){
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join(',')==='categoryId,npcId,outline,projectId,requiredSections,requirements,schemaVersion,title'&&
  value.schemaVersion===addSchema&&value.projectId==='binari'&&
  typeof value.npcId==='string'&&value.npcId===value.npcId.trim()&&idPattern.test(value.npcId)&&
  typeof value.categoryId==='string'&&newCategory.test(value.categoryId)&&
  validText(value.title,1,120)&&!/[\p{Cc}\u2028\u2029]/u.test(value.title)&&
  validText(value.outline,1,4000)&&validText(value.requirements,0,4000)&&validRequiredSections(value.requiredSections);
}
export function makeNpcPlanningAdd({npcId},{title,outline,requirements,requiredSections},uuid){
 const payload={schemaVersion:addSchema,projectId:'binari',npcId,categoryId:'category.add.'+uuid().replaceAll('-',''),
  title:title.trim(),outline:outline.trim(),requirements:requirements.trim(),requiredSections:parseRequiredSections(requiredSections)};
 if(!validNpcPlanningAdd(payload))throw Error('NPC_PLANNING_ADD_REQUEST_INVALID');
 return payload;
}

export function npcPlanningSelection(plans,wanted){
 const choices=npcPlanningRoles.map(([role,name])=>{
  const found=plans.filter(row=>row.planningRole===role);
  return {role,name,document:found.length===1?found[0]:null};
 });
 const selected=choices.find(row=>row.role===wanted||row.document?.id===wanted)??choices[0];
 const custom=plans.filter(row=>row.planningRole==='custom'&&typeof row.id==='string'&&newCategory.test(row.id)&&
  row.contentFormat==='markdown.v1');
 const selectedCustom=custom.find(row=>row.id===wanted)??null;
 const legacy=plans.find(row=>row.id===wanted&&row.planningRole===undefined)??null;
 return {choices,selected,legacy,custom,selectedCustom};
}
function node(tag,className='',label){
 const element=document.createElement(tag);
 if(className)element.className=className;
 if(label!==undefined)element.textContent=label;
 return element;
}
export function renderNpcPlanningDocument(row,appendLegacy){
 if(row?.contentFormat==='markdown.v1'&&typeof row.markdown==='string')return conceptMarkdown(row.markdown);
 if(row?.contentFormat==='markdown.v1')return node('p','meta error','게시된 기획 문서를 아직 확인할 수 없습니다.');
 if(row&&Object.hasOwn(row,'content'))return appendLegacy(row.content);
 return node('p','meta','작성된 기획 문서가 없습니다.');
}
export function editableNpcPlanningDocument(row){
 if(!row||row.planningRole==='custom')return false;
 return row.contentFormat==='markdown.v1'?typeof row.markdown==='string'&&!!row.markdown.trim():
  Object.hasOwn(row,'content')&&(typeof row.content==='string'?!!row.content.trim():
   row.content!==null&&typeof row.content==='object'&&Object.keys(row.content).length>0);
}

export function createNpcPlanningIntake(submit,{uuid=()=>crypto.randomUUID(),type=npcPlanningRequestType,
 build=makeNpcPlanningUpdate}={}){
 let command=null,pending=false,accepted=false;
 return {
  get waiting(){return command!==null&&!accepted;},
  async send(target,values){
   if(pending||accepted)return null;
   if(!command)command={requestType:type,idempotencyKey:uuid(),payload:build(target,values,uuid)};
   pending=true;
   try{
    const response=await submit(command),result=await response.json();
    if(isQueuedRequest(response,result)){accepted=true;return result;}
    if(response.status===201&&result?.status==='registered'&&typeof result.officialRequestId==='string'&&
       officialId.test(result.officialRequestId)&&Object.keys(result).sort().join(',')==='officialRequestId,status'){
     accepted=true;return result;
    }
    if(response.status>=400&&response.status<500&&known.has(result?.error)){
     command=null;throw Object.assign(Error(result.error),{definitive:true});
    }
    throw Error('NPC_PLANNING_RECEIPT_UNCONFIRMED');
   }finally{pending=false;}
  },
 };
}
function pencil(){
 const ns='http://www.w3.org/2000/svg',icon=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path');
 for(const [name,value] of Object.entries({viewBox:'0 0 24 24',width:'16',height:'16',fill:'none',stroke:'currentColor',
  'stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))icon.setAttribute(name,value);
 path.setAttribute('d','M4 20l4-.8L20 7l-3-3L5 16l-1 4ZM14.5 6.5l3 3');icon.append(path);return icon;
}
export function createNpcPlanningEditor({owner,submit,signal}){
 let closeCurrent=null;
 const uncertain=new Map();
 signal.addEventListener('abort',()=>closeCurrent?.(true),{once:true});
 function action({npcId,npcName,role,name},adding){
  const title=adding?'기획 문서 추가':name+' 수정 요청';
  const trigger=node('button','concept-category-trigger concept-category-icon '+(adding?'npc-planning-add':'npc-planning-edit'),adding?'+':undefined);
  trigger.type='button';trigger.title=title;trigger.setAttribute('aria-label',title);trigger.setAttribute('aria-haspopup','dialog');
  if(!adding)trigger.append(pencil());
  trigger.addEventListener('click',()=>{
   if(closeCurrent||signal.aborted)return;
   const key=npcId+':'+(adding?'add':role);
   const intake=uncertain.get(key)??createNpcPlanningIntake(submit,adding?{type:npcPlanningAddType,build:makeNpcPlanningAdd}:undefined);
   const dialog=node('dialog','npc-one-stop-dialog'),head=node('header'),heading=node('h2','',adding?title:'기획 수정 요청'),close=node('button','','닫기');
   heading.id='npc-planning-edit-title';dialog.setAttribute('aria-labelledby',heading.id);close.type='button';head.append(heading,close);
   const form=node('form','one-stop-intake'),fields=node('fieldset'),layout=node('div','concept-category-fields');
   fields.append(node('legend','',title),layout);form.append(fields);
   function field(label,tag,options={}){
    const wrapper=node('label','',label),input=Object.assign(node(tag),options);
    wrapper.append(input);layout.append(wrapper);return input;
   }
   const inputs=adding?{
    title:field('제목','input',{required:true,maxLength:120}),
    outline:field('큰 줄기','textarea',{required:true,maxLength:4000}),
    requiredSections:field('필수 구성 항목','textarea',{required:true,placeholder:'줄마다 제목 하나씩 · 1~16개, 항목당 최대 80자'}),
    requirements:field('추가 요청 (선택)','textarea',{maxLength:4000}),
   }:{requirements:field('수정 요청','textarea',{required:true,maxLength:4000})};
   const send=node('button','npc-one-stop-submit','요청 제출');send.type='submit';form.append(send);
   const status=node('p','meta'),error=node('p','meta error');status.setAttribute('role','status');error.setAttribute('role','alert');
   dialog.append(head,node('p','meta',adding?npcName+'의 기획 문서 한 개를 추가합니다.':npcName+' · '+name+' 문서만 수정합니다.'),form,error,status);owner.append(dialog);
   let busy=false;
   function controls(){
    close.disabled=busy;fields.disabled=busy||intake.waiting;send.disabled=busy;
    send.textContent=busy?'접수 중…':intake.waiting?'같은 접수 다시 확인':'요청 제출';
   }
   function leave(force=false){
    if(busy&&!force)return;
    dialog.close();dialog.remove();closeCurrent=null;
    if(!force&&trigger.isConnected)trigger.focus({preventScroll:true});
   }
   if(intake.waiting)error.textContent='앞서 보낸 요청의 접수를 먼저 확인해 주세요.';
   closeCurrent=leave;
   close.addEventListener('click',()=>leave());
   dialog.addEventListener('cancel',event=>{event.preventDefault();leave();});
   form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(busy||form.hidden||signal.aborted)return;
    busy=true;error.textContent='';controls();
    try{
     const values=adding?Object.fromEntries(Object.entries(inputs).map(([key,element])=>[key,element.value])):inputs.requirements.value;
     const receipt=await intake.send({npcId,role},values);
     if(receipt&&!signal.aborted){uncertain.delete(key);form.hidden=true;status.textContent=receipt.status==='queued'?'NGS 대기열에 저장했습니다.':'요청을 접수했습니다. 요청 ID: '+receipt.officialRequestId;}
    }catch(cause){
     if(intake.waiting)uncertain.set(key,intake);else uncertain.delete(key);
     if(!signal.aborted)error.textContent=intake.waiting?'접수 결과를 확인하지 못했습니다. 같은 요청만 다시 확인할 수 있습니다.':
      cause.definitive?'요청을 접수하지 못했습니다. 입력과 접수 권한을 확인해 주세요.':
      adding?'제목, 큰 줄기 및 필수 구성 항목을 확인해 주세요.':'수정 요청을 1~4,000자로 입력해 주세요.';
    }finally{busy=false;controls();}
   });
   controls();dialog.showModal();
  });
  return trigger;
 }
 return {button:target=>action(target,false),addButton:target=>idPattern.test(target?.npcId??'')?action(target,true):null};
}
