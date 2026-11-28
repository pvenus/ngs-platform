import {browserRequestId} from './browser-request-id.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
import {conceptCategoryRequestType,makeConceptCategoryRequest} from './local-concept-category-contract.mjs';

const definitive=new Set(['CONCEPT_CATEGORY_REQUEST_INVALID','NGS_CONCEPT_CATEGORY_PAYLOAD_INVALID','CONCEPT_CATEGORY_TARGET_NOT_FOUND',
 'CONCEPT_CATEGORY_TARGET_CHANGED','OFFICIAL_REQUEST_CONCEPT_CATEGORY_ALREADY_REGISTERED',
 'OFFICIAL_REQUEST_IDEMPOTENCY_CONFLICT','REQUEST_SUBMIT_INVALID','LOCAL_SIGN_IN_REQUIRED',
 'LOCAL_SESSION_EXPIRED_OR_REVOKED','PROJECT_OR_RESOURCE_DENIED','FRONTEND_SESSION_CONTEXT_CHANGED',
 'CSRF_INVALID','ORIGIN_OR_CSRF_REJECTED']);
const labels={add:'카테고리 추가',update:'수정 요청',remove:'카테고리 삭제 요청'};
const id=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export function createConceptCategoryIntake(submit,{uuid=()=>browserRequestId()}={}){
 let command=null,busy=false,receipt=null;
 return {
  get waitingConfirmation(){return command!==null&&!receipt;},
  async send(values){
   if(busy||receipt)return null;
   if(!command)command={requestType:conceptCategoryRequestType,idempotencyKey:uuid(),payload:makeConceptCategoryRequest(values,uuid)};
   busy=true;
   try{
    const response=await submit(command),value=await response.json();
    if(isQueuedRequest(response,value)){receipt=value;return value;}
    if(response.status===201&&value&&Object.keys(value).sort().join(',')==='officialRequestId,status'&&
       value.status==='registered'&&typeof value.officialRequestId==='string'&&id.test(value.officialRequestId)){
     receipt=value;return receipt;
    }
    if(response.status>=400&&response.status<500&&definitive.has(value?.error)){
     command=null;throw Object.assign(Error(value.error),{definitive:true});
    }
    throw Error('CONCEPT_CATEGORY_RECEIPT_UNCONFIRMED');
   }finally{busy=false;}
  },
 };
}

function node(tag,className='',label){
 const element=document.createElement(tag);
 if(className)element.className=className;
 if(label!==undefined)element.textContent=label;
 return element;
}
function field(label,tag,options){
 const wrapper=node('label','',label),input=Object.assign(node(tag),options);wrapper.append(input);return {wrapper,input};
}
function failureMessage(error,operation){
 if(error.message==='CONCEPT_REQUIRED_SECTIONS_INVALID')return '필수 구성 항목을 줄마다 하나씩 입력해 주세요. 중복 없이 1~16개, 항목당 최대 80자입니다.';
 if(error.message==='OFFICIAL_REQUEST_CONCEPT_CATEGORY_ALREADY_REGISTERED')return '이 카테고리의 요청이 이미 접수되어 있습니다.';
 if(['CONCEPT_CATEGORY_TARGET_NOT_FOUND','CONCEPT_CATEGORY_TARGET_CHANGED'].includes(error.message))
  return '선택한 카테고리가 변경되었습니다. 화면을 새로 연 뒤 다시 선택해 주세요.';
 if(error.definitive)return '요청을 접수하지 못했습니다. 선택과 입력을 확인해 주세요.';
 return operation==='update'?'수정 요청을 1~4,000자로 입력해 주세요.':'카테고리 이름, 상위 그룹과 큰 줄기를 확인해 주세요.';
}

// A category's content and its shared visibility/hash index are separate replica scopes.
export async function syncConceptDetail({projectId,item,post,readIndex,signal}){
 const shared=projectId+'/concept',selectedScope=shared+'/sections/'+item;
 async function sync(scope,accept){
  const delta=await post('compare',{scope});
  if(signal.aborted)return;
  if(delta.unavailable?.some(accept))throw Error('CONCEPT_REPLICA_SYNC_UNAVAILABLE');
  for(const {folder} of delta.groups){
   if(signal.aborted)return;
   if(accept(folder))await post('refresh',{scope,folder});
  }
 }
 await sync(shared,folder=>folder==='');
 if(signal.aborted)return null;
 const index=await readIndex();
 if(signal.aborted)return null;
 const selected=index.items.find(row=>row.id===item&&row.scope===selectedScope);
 if(!selected)return {index,selected:false};
 await sync(selected.scope,()=>true);
 return signal.aborted?null:{index,selected:true};
}

export function conceptDetailOperations(selected){
 if(typeof selected?.title!=='string'||selected.archived===true)return [];
 return ['update','remove'];
}

export function createConceptCategoryActions({modalOwner,projectId,signal,submit}){
 const attempts=new Map();
 let closeCurrent=null;
 signal.addEventListener('abort',()=>closeCurrent?.(true),{once:true});
 function trigger(operation,{target=null,groups=[]}={}){
  if(!Object.hasOwn(labels,operation))throw Error('CONCEPT_CATEGORY_ACTION_UNAVAILABLE');
  const action=labels[operation],authoring=operation==='add'||operation==='update';
  const icon=operation==='add'?'+':operation==='remove'?'−':operation==='update'?'✎':null;
  const button=node('button','concept-category-trigger'+(icon?' concept-category-icon':''),icon??action);
  button.disabled=operation==='add'&&!groups.length;
  if(button.disabled)button.title='게시된 상위 그룹을 먼저 확인해 주세요.';
  button.type='button';if(!button.disabled)button.title=action;button.setAttribute('aria-label',action);button.setAttribute('aria-haspopup','dialog');
  button.addEventListener('click',()=>{
   if(button.disabled||closeCurrent||signal.aborted)return;
   const key=operation+':'+(target?.id??''),carry=attempts.has(key);
   const intake=attempts.get(key)??createConceptCategoryIntake(submit);
   const modal=node('dialog','npc-one-stop-dialog concept-category-dialog'),heading=node('h2','',action);
   heading.id='concept-category-intake-title';modal.setAttribute('aria-labelledby',heading.id);
   const header=node('header'),close=node('button','','닫기');close.type='button';header.append(heading,close);
   const targetLabel=target?`“${target.title}” (${target.id})`:'';
   const intro=node('p','meta',({
    add:'선택한 상위 그룹에 새 마스터 컨셉 카테고리 1개를 만듭니다.',
    update:`${targetLabel}의 현재 문서를 바탕으로 수정 요청을 반영해 문서 전체를 다시 작성합니다.`,
    remove:`삭제 대상: ${target?.title??''} (하위 항목 포함)`,
   })[operation]);
   const form=node('form','one-stop-intake'),inputs=node('fieldset'),fields=node('div','concept-category-fields');
   inputs.append(node('legend','',operation==='update'?'마스터 컨셉 수정 조건':'카테고리 생성 조건'),fields);
   const title=field('카테고리 이름','input',{required:true,maxLength:120,readOnly:Boolean(target),value:target?.title??''});
   const group=field('상위 그룹','select',{required:true});
   if(operation==='add'){
    const none=node('option','','상위 그룹을 선택하세요');none.value='';group.input.append(none);
    for(const row of groups){const option=node('option','',row.title);option.value=row.id;group.input.append(option);}
    fields.append(group.wrapper);
   }
   const outline=field('큰 줄기','textarea',{required:true,maxLength:4000});
   const requirements=field(operation==='update'?'수정 요청':'추가 요청 (선택)','textarea',
    {maxLength:4000,required:operation==='update'});
   const sections=field('필수 구성 항목','textarea',{required:operation==='add',placeholder:'줄마다 제목 하나씩 · 1~16개'});
   if(operation==='add'){
    const help=node('small','meta','항목당 최대 80자, 작성한 순서대로 구성합니다.');
    const describedBy='concept-category-required-sections-help';
    help.id=describedBy;sections.input.setAttribute('aria-describedby',describedBy);
    sections.wrapper.append(help);
    fields.append(title.wrapper,outline.wrapper,sections.wrapper,requirements.wrapper);
   }
   if(operation==='update')fields.append(requirements.wrapper);
   const submitLabel=operation==='remove'?'삭제 요청':operation==='update'?'수정 요청 제출':'요청 제출';
   const send=node('button','npc-one-stop-submit',submitLabel);send.type='submit';
   if(authoring)form.append(inputs);
   form.append(send);
   const alert=node('p','meta error'),status=node('p','meta');
   alert.setAttribute('role','alert');status.setAttribute('role','status');
   modal.append(header,intro,form,alert,status);
   modalOwner.append(modal);
   let working=false;
   function controls(){
    close.disabled=working;send.disabled=working;inputs.disabled=working||intake.waitingConfirmation;
    inputs.hidden=carry&&intake.waitingConfirmation;
    send.textContent=working?'접수 중…':intake.waitingConfirmation?'같은 접수 다시 확인':submitLabel;
   }
   function leave(force=false){
    if(working&&!force)return;
    modal.close();modal.remove();closeCurrent=null;
    if(!force&&button.isConnected)button.focus({preventScroll:true});
   }
   closeCurrent=leave;close.addEventListener('click',()=>leave());
   modal.addEventListener('cancel',event=>{event.preventDefault();leave();});
   if(carry)alert.textContent='앞서 보낸 요청의 접수 결과를 먼저 확인해 주세요.';
   form.addEventListener('submit',async event=>{
    event.preventDefault();if(working||form.hidden)return;
    working=true;alert.textContent='';controls();
    try{
     const values={projectId,operation,target,group:group.input.value,title:title.input.value,
      outline:outline.input.value,requirements:requirements.input.value,requiredSections:sections.input.value};
     const result=await intake.send(values);
     if(result&&!signal.aborted){
      attempts.delete(key);form.hidden=true;
      status.textContent=result.status==='queued'?'NGS 대기열에 저장했습니다.':'요청을 접수했습니다. 요청 ID: '+result.officialRequestId;
     }
    }catch(error){
     if(!signal.aborted){
      if(intake.waitingConfirmation){
       attempts.set(key,intake);alert.textContent='접수 결과를 확인하지 못했습니다. 같은 요청만 다시 확인할 수 있습니다.';
      }else{
       attempts.delete(key);alert.textContent=failureMessage(error,operation);
      }
     }
    }finally{working=false;controls();}
   });
   controls();modal.showModal();
  });
  return button;
 }
 return {trigger};
}

// Render a small inert Markdown subset. HTML, URLs and embeds never become active nodes.
export function conceptMarkdown(source){
 const article=node('article','concept-markdown');let block=null,paragraph=[],code=null,fence=0;
 const flush=()=>{
  if(paragraph.length){article.append(node('p','',paragraph.join('\n')));paragraph=[];}
  block=null;
 };
 for(const line of source.split(/\r?\n/)){
  if(code!==null){
   const end=/^ {0,3}(`{3,})\s*$/.exec(line);
   if(end&&end[1].length>=fence){const pre=node('pre');pre.append(node('code','',code.join('\n')));article.append(pre);code=null;}
   else code.push(line);
   continue;
  }
  const begin=/^ {0,3}(`{3,})[^`]*$/.exec(line);
  if(begin){flush();code=[];fence=begin[1].length;continue;}
  const h=/^ {0,3}(#{1,6})\s+(.+)$/.exec(line),item=/^ {0,3}([-+*]|\d+\.)\s+(.+)$/.exec(line);
  if(h){flush();article.append(node('h'+Math.min(6,h[1].length+3),'',h[2]));continue;}
  if(item){
   const kind=/^\d/.test(item[1])?'ol':'ul';
   if(block?.kind!==kind){flush();const children=node(kind);article.append(children);block={kind,children};}
   block.children.append(node('li','',item[2]));continue;
  }
  if(!line.trim()){flush();continue;}
  block=null;paragraph.push(line);
 }
 if(code!==null){const pre=node('pre');pre.append(node('code','',code.join('\n')));article.append(pre);}
 flush();
 if(!source.trim())article.append(node('p','meta','게시된 마크다운 본문이 비어 있습니다.'));
 return article;
}
