import {uiPath,uiGenerate,uiImport,uiSchemas,uiKind,uiMaxPng,validUiRequest} from './ui-asset-contract.mjs';
import {sha256Hex} from './browser-sha256.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
const label=kind=>kind==='logo'?'로고':'버튼';
const e=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const btn=(text,fn)=>{const b=e('button',text);b.type='button';b.addEventListener('click',fn);return b;};
export async function mountUiWorkspace({items,detail,tools,projectId,item,request,submit,stage,navigate,signal}){
 const get=query=>uiPath+'?'+new URLSearchParams({projectId,...query});
 const {assets}=await request(get());
 if(signal.aborted)return;
 if(!Array.isArray(assets))throw Error('NGS_UI_CATALOG_UNAVAILABLE');
 const status=e('p','','meta'),search=e('input');search.type='search';search.placeholder='UI 이름 검색';search.setAttribute('aria-label','UI 이름 검색');
 const type=e('select');type.setAttribute('aria-label','UI 타입');for(const [value,name] of [['','전체'],['logo','로고'],['button','버튼']]){
  const opt=e('option',name);opt.value=value;type.append(opt);
 }
 function render(){
  const query=search.value.trim().toLocaleLowerCase();
  const rows=assets.filter(a=>uiKind(a.kind)&&(!type.value||type.value===a.kind)&&(!query||a.title.toLocaleLowerCase().includes(query)));
  items.replaceChildren(...rows.map(a=>{
   const li=e('li'),link=e('a',a.title,'request-item');link.href=navigate({item:a.id});if(item===a.id)link.setAttribute('aria-current','page');
   li.append(link,e('small',label(a.kind),'meta'));return li;
  }),...(rows.length?[]:[e('li','게시된 UI 리소스가 없습니다.','meta')]));
 }
 search.addEventListener('input',render);type.addEventListener('change',render);render();
 tools.hidden=false;tools.replaceChildren(search,type);
 const row=assets.find(a=>a.id===item);
 if(row){
  const safeUrl=get({id:row.id,sha256:row.sha256});
  const image=e('img');image.alt=row.title;image.src=safeUrl;image.style.cssText='max-width:100%;max-height:55vh;object-fit:contain;background:#25252a;padding:12px';
  const download=e('a','PNG 다운로드');download.href=safeUrl;download.download=row.kind+'.png';
  detail.replaceChildren(e('h3',row.title),e('p',label(row.kind)+' · '+row.width+' × '+row.height+' · '+(row.origin==='manual'?'수동 등록':'ImageGen'),'meta'),image,download,status);
 }else detail.replaceChildren(e('h3','UI 제작'),e('p','타이틀 로고와 버튼을 개별 투명 PNG 리소스로 관리합니다.','meta'),status);
 if(!submit)return;
 const show=manual=>{
  const dialog=e('dialog');const form=e('form');form.append(e('h3',manual?'UI PNG 수동 등록':'UI 이미지 생성 요청'));
  const kind=e('select');for(const v of ['logo','button']){const o=e('option',label(v));o.value=v;kind.append(o);}
  const title=e('input');title.required=true;title.maxLength=120;
  const field=manual?e('input'):e('textarea');field.required=true;
  if(manual){field.type='file';field.accept='image/png,.png';}else{field.maxLength=2000;field.rows=5;field.placeholder='예: 한지 위에 먹으로 쓴 들어가기 버튼, 텍스트는 정확히 들어가기만';}
  for(const [text,input] of [['종류',kind],['리소스 이름',title],[manual?'투명 PNG':'요청 사항',field]]){
   const l=e('label',text);l.style.display='grid';l.append(input);form.append(l);
  }
  const output=e('p','','meta');output.setAttribute('role','status');
  const send=e('button',manual?'정식 등록 요청':'정식 생성 요청');send.type='submit';
  const cancel=btn('닫기',()=>dialog.close());form.append(output,send,cancel);dialog.append(form);
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  signal.addEventListener('abort',()=>dialog.remove(),{once:true});
  form.addEventListener('submit',async event=>{
   event.preventDefault();if(send.disabled)return;send.disabled=true;cancel.disabled=true;
   let rType=manual?uiImport:uiGenerate;
   const draft={schemaVersion:uiSchemas[rType],projectId,title:title.value.trim(),kind:kind.value};
   try{
    if(manual){
     const file=field.files?.[0];
     if(!file||file.size>uiMaxPng)throw Error('8 MiB 이하 투명 PNG를 선택하세요.');
     if(!validUiRequest(rType,{...draft,sha256:'0'.repeat(64)}))throw Error('이름과 종류를 확인하세요.');
     output.textContent='PNG를 검증하는 중…';const receipt=await stage(file);draft.sha256=receipt.sha256;
    }else draft.prompt=field.value.trim();
    if(!validUiRequest(rType,draft))throw Error('이름과 요청 사항을 확인하세요.');
    output.textContent='정식 요청을 접수하는 중…';const key='ui-asset:'+await sha256Hex(new TextEncoder().encode(JSON.stringify(draft)));
    const response=await submit({requestType:rType,idempotencyKey:key,payload:draft});
    const result=await response.json().catch(()=>null);
    if(!isQueuedRequest(response,result))throw Error('정식 요청을 접수하지 못했습니다.');
    dialog.close();status.textContent='정식 요청을 접수했습니다. 게시되면 이 목록에 표시됩니다.';
   }catch(error){output.textContent=error.message;}
   finally{send.disabled=false;cancel.disabled=false;}
  });
  dialog.showModal();title.focus();
 };
 tools.append(btn('+ 생성 요청',()=>show(false)));
 if(stage)tools.append(btn('PNG 등록',()=>show(true)));
}
