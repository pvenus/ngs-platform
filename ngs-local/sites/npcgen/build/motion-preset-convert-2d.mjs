/** Same formal scope for Local, Space and the browser. No engine or media settings in the request. */
import {isQueuedRequest} from './local-request-queue-browser.mjs';

export const motionPresetConvertType='motion-preset.convert-2d';
export const motionPresetConvertSchema='ngs.motion-preset-convert-2d.v1';
export const motionVariantIdPattern='[a-z][a-z0-9-]{1,63}';
const sourceId=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u,variantId=new RegExp('^'+motionVariantIdPattern+'$','u');
const controls=/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u;
const directions=new Set(['n','ne','e','se','s','sw','w','nw']);
const fields=['schemaVersion','projectId','sourcePresetId','variantPresetId','label'];

export function validMotionPresetConvert(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||
  !fields.every(k=>Object.hasOwn(value,k))||value.schemaVersion!==motionPresetConvertSchema||value.projectId!=='binari')return false;
 const {sourcePresetId,variantPresetId,label}=value;
 return typeof sourcePresetId==='string'&&!controls.test(sourcePresetId)&&sourceId.test(sourcePresetId)&&
  typeof variantPresetId==='string'&&!controls.test(variantPresetId)&&variantId.test(variantPresetId)&&sourcePresetId.toLowerCase()!==variantPresetId&&
  typeof label==='string'&&label.isWellFormed()&&label===label.trim()&&label.length>0&&[...label].length<=120&&!controls.test(label);
}

export function readyMotionPreset(preset){
 const rows=preset?.directions;
 return typeof preset?.presetId==='string'&&!Object.hasOwn(preset,'variant')&&!controls.test(preset.presetId)&&sourceId.test(preset.presetId)&&
  Array.isArray(rows)&&rows.length===8&&rows.every(row=>directions.has(row?.direction)&&
   typeof row.path==='string'&&/^motion-presets\/assets\/[a-f0-9]{64}\.mp4$/u.test(row.path)&&!controls.test(row.path))&&
  new Set(rows.map(row=>row.direction)).size===8&&new Set(rows.map(row=>row.path)).size===8;
}

export function suggestMotionVariantId(source){
 let stem=(typeof source==='string'?source:'').toLowerCase().replace(/[^a-z0-9]+/gu,'-').replace(/^-+|-+$/gu,'');
 if(!/^[a-z]/u.test(stem))stem='preset-'+stem;
 return (stem.slice(0,61).replace(/-+$/u,'')||'preset')+'-2d';
}

export async function motionConversionCommand(input){
 const trim=text=>typeof text==='string'?text.trim():text;
 const payload={schemaVersion:motionPresetConvertSchema,projectId:input.projectId,sourcePresetId:input.sourcePresetId,
  variantPresetId:trim(input.variantPresetId),label:trim(input.label)};
 if(!validMotionPresetConvert(payload))throw Error('새 프리셋 ID와 이름을 확인하세요.');
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([motionPresetConvertType,payload])));
 const idempotencyKey='motion-2d-'+[...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,'0')).join('');
 return {requestType:motionPresetConvertType,idempotencyKey,payload};
}

export function createMotionPresetIntake(submit){
 let pending=false;
 return {async send(input){
  if(pending)return null;
  pending=true;
  try{
   const command=await motionConversionCommand(input);
   const response=await submit(command);
   const value=await response.json().catch(()=>null);
   if(!isQueuedRequest(response,value))throw Error('접수를 확인하지 못했습니다. 같은 ID로 다시 시도할 수 있습니다.');
   return value;
  }finally{pending=false;}
 }};
}

/** Extension of the existing preset detail, not a new menu. The source remains read-only. */
export function motionConversionForm({projectId,preset,publishedIds,submit,signal}){
 if(projectId!=='binari'||typeof submit!=='function'||signal.aborted||preset&&Object.hasOwn(preset,'variant'))return null;
 const node=(tag,text)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
 const panel=node('details');panel.className='motion-preset-conversion';
 panel.append(node('summary','2D 마네킹 프리셋 등록'));
 const intro=node('p','선택한 원본 프리셋을 기준으로 얼굴·머리·의상 특징이 없는 2D 마네킹 영상 8개를 만듭니다. 원본은 바뀌지 않습니다.');
 intro.className='meta';panel.append(intro);
 if(!readyMotionPreset(preset)){
  const missing=node('p','원본 8방향 영상이 모두 표시된 후 변환할 수 있습니다.');missing.className='meta';panel.append(missing);return panel;
 }
 const form=node('form'),id=node('input'),name=node('input');
 const label=(text,control)=>{const wrap=node('label');wrap.append(node('span',text),control);return wrap;};
 id.value=suggestMotionVariantId(preset.presetId);id.maxLength=64;id.required=true;
 id.pattern=motionVariantIdPattern.replace('[a-z0-9-]','[a-z0-9\\-]');id.spellcheck=false;id.autocomplete='off';
 name.value=[...String(preset.label??preset.presetId)].slice(0,108).join('')+' · 2D 마네킹';name.required=true;name.autocomplete='off';
 const send=node('button','정식 변환 요청');send.type='submit';
 const status=node('p');status.className='meta';status.setAttribute('role','status');
 const intake=createMotionPresetIntake(submit);
 let inFlight=false;
 const disabled=value=>{id.disabled=value;name.disabled=value;send.disabled=value;};
 form.append(label('새 프리셋 ID',id),label('새 프리셋 이름',name),send,status);
 form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(inFlight||signal.aborted)return;
  if(publishedIds.has(id.value.trim().toLowerCase())){
   status.textContent='이미 게시된 ID입니다. 다른 ID를 입력하세요.';status.className='meta error';return;
  }
  inFlight=true;disabled(true);status.className='meta';status.textContent='요청을 접수하고 있습니다.';
  let accepted=false;
  try{
   const response=await intake.send({projectId,sourcePresetId:preset.presetId,variantPresetId:id.value,label:name.value});
   if(!response||signal.aborted||!panel.isConnected)return;
   accepted=true;status.textContent='요청을 대기열에 넣었습니다. 8방향 게시 완료 후 모션 프리셋 목록에서 확인할 수 있습니다.';
  }catch(e){
   if(!signal.aborted&&panel.isConnected){
    status.textContent=e instanceof Error&&e.message==='새 프리셋 ID와 이름을 확인하세요.'?e.message:
     '접수를 확인하지 못했습니다. 같은 ID로 다시 시도할 수 있습니다.';
    status.className='meta error';
   }
  }finally{
   inFlight=false;
   if(!accepted&&!signal.aborted&&panel.isConnected)disabled(false);
  }
 },{signal});
 panel.append(form);return panel;
}
