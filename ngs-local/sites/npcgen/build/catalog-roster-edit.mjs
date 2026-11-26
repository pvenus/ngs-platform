/** Shared edit-mode UI. The caller supplies an already-authorized single-item intake. */
const el=(doc,tag,cls,text)=>{
 const node=doc.createElement(tag);if(cls)node.className=cls;if(text)node.textContent=text;
 return node;
};

export async function submitCatalogSelections(rows,submitOne){
 const accepted=[],failed=[];
 for(const row of rows)try{await submitOne(row);accepted.push(row.id);}catch{failed.push(row.id);}
 return {accepted,failed};
}

export function mountCatalogRosterEdit({items,tools,modalOwner=items.parentElement,deleteItem,signal}){
 if(typeof deleteItem!=='function'||!tools||!modalOwner||signal.aborted)return null;
 const doc=items.ownerDocument,selected=new Map(),boxes=new Map();
 let active=false,busy=false,opened=null;
 const create=(...args)=>el(doc,...args);
 const controls=create('span','catalog-roster-edit-tools');
 const toggle=create('button','prop-control catalog-roster-edit-trigger');toggle.type='button';
 const aria='목록 편집';toggle.title=aria;toggle.setAttribute('aria-label',aria);toggle.setAttribute('aria-pressed','false');
 const ns='http://www.w3.org/2000/svg',icon=doc.createElementNS(ns,'svg'),path=doc.createElementNS(ns,'path');
 icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('width','17');icon.setAttribute('height','17');
 icon.setAttribute('aria-hidden','true');icon.setAttribute('fill','none');icon.setAttribute('stroke','currentColor');
 icon.setAttribute('stroke-width','1.8');icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');
 path.setAttribute('d','M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z');icon.append(path);toggle.append(icon);
 const remove=create('button','prop-control prop-animation-delete');remove.type='button';remove.hidden=true;
 const notice=create('p','meta catalog-roster-edit-status');notice.hidden=true;notice.setAttribute('role','status');
 controls.append(toggle,remove);tools.append(controls);tools.hidden=false;items.before(notice);

 function refresh(){
  toggle.setAttribute('aria-pressed',String(active));toggle.disabled=busy;remove.hidden=!active;remove.disabled=busy||!selected.size;
  remove.textContent=selected.size?'선택 삭제 ('+selected.size+')':'선택 삭제';
  for(const [input,row] of boxes){
   if(!items.contains(input)){boxes.delete(input);continue;}
   input.hidden=!active;input.disabled=busy;input.checked=selected.has(row.id);
   input.parentElement.classList.toggle('catalog-roster-edit-row',active);
  }
 }
 function decorate(li,id,title,expected){
  const row={id,title,...(expected?{expected}: {})},input=create('input','catalog-roster-checkbox');
  input.type='checkbox';input.hidden=!active;input.disabled=busy;input.checked=selected.has(id);
  input.setAttribute('aria-label',title+' 선택');
  input.addEventListener('change',()=>{if(!active||busy)return;if(input.checked)selected.set(id,row);else selected.delete(id);refresh();},{signal});
  li.prepend(input);li.classList.toggle('catalog-roster-edit-row',active);boxes.set(input,row);
 }
 toggle.addEventListener('click',()=>{if(busy)return;active=!active;if(!active)selected.clear();refresh();},{signal});
 remove.addEventListener('click',()=>{
  if(busy||opened||!selected.size)return;
  const list=[...selected.values()],dialog=create('dialog','prop-workspace-dialog');opened=dialog;
  const h=create('h3',null,'선택한 항목 전체 삭제');h.id='catalog-delete-'+crypto.randomUUID();
  dialog.setAttribute('aria-labelledby',h.id);
  const names=create('ul','catalog-roster-delete-targets');
  for(const row of list)names.append(create('li',null,row.title));
  const buttons=create('div','prop-actions'),cancel=create('button','prop-control','취소'),
   confirm=create('button','prop-control prop-animation-delete','삭제 요청');
  cancel.type=confirm.type='button';buttons.append(cancel,confirm);
  dialog.append(h,create('p','meta','원본과 하위 결과가 삭제됩니다. 선택한 항목마다 별도 삭제 요청을 접수합니다.'),names,buttons);
  modalOwner.append(dialog);dialog.addEventListener('close',()=>{opened=null;dialog.remove();if(!signal.aborted)(active?remove:toggle).focus();},{once:true});
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  cancel.addEventListener('click',()=>dialog.close(),{signal});
  confirm.addEventListener('click',async()=>{
   if(busy||signal.aborted)return;
   busy=true;confirm.disabled=cancel.disabled=true;refresh();
   try{
    const {accepted,failed}=await submitCatalogSelections(list,row=>{
     if(signal.aborted)throw Error('CATALOG_VIEW_CHANGED');
     return deleteItem(row);
    });
    if(signal.aborted)return;
    for(const id of accepted)selected.delete(id);
    notice.hidden=false;notice.textContent=accepted.length+'건 접수'+(failed.length?' · '+failed.length+'건 접수 실패':'')+'. 삭제가 게시되면 목록에 반영됩니다.';
    if(!failed.length)active=false;
   }finally{busy=false;if(!signal.aborted){refresh();dialog.close();}}
  },{signal});
  dialog.showModal();cancel.focus();
 },{signal});
 signal.addEventListener('abort',()=>{opened?.close();controls.remove();notice.remove();boxes.clear();},{once:true});
 return {decorate,refresh};
}
