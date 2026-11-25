import {MASTER_FPS,validCinematicPlayback,compileCinematicTimeline,cinematicSpeedAt,cinematicStageRect} from './cinematic-timeline.mjs';

export function layoutTimelineControls(parent,initial,onValid,{signal,onSaveRequest,allowDownload=true}={}){
 const d=parent.ownerDocument,make=(tag,text)=>{const n=d.createElement(tag);if(text)n.textContent=text;return n;};
 const group=make('section'),legend=make('h4','시네마틱 카메라·프레임 곡선');
 const duration=make('input');duration.type='number';duration.step='0.041666667';duration.min='0.041666667';duration.max='60';duration.value=String(initial.durationFrames/MASTER_FPS);
 const speeds=make('textarea');speeds.rows=4;speeds.value=initial.speedCurve.map(p=>[p.frame/MASTER_FPS,p.rate].join(', ')).join('\n');
 const cameras=make('textarea');cameras.rows=4;cameras.value=initial.cameraCurve.map(p=>[p.frame/MASTER_FPS,p.zoom,p.x,p.y].join(', ')).join('\n');
 const label=(s,input)=>{const l=make('label',s);l.style.display='grid';l.append(input);return l;};
 const note=make('p','입력한 시점의 배속을 기준으로 그 사이를 부드럽게 가감속해요. 같은 배속을 두 시점에 적으면 그 구간은 일정하고, 둘 다 0이면 멈춰요.');
 const hint=make('p','');hint.setAttribute('role','status');
 const svgns='http://www.w3.org/2000/svg',svg=d.createElementNS(svgns,'svg');
 svg.setAttribute('viewBox','0 0 360 96');svg.setAttribute('role','img');svg.setAttribute('aria-label','시간별 재생 속도와 줌 곡선');
 svg.style.display='block';svg.style.width='min(100%, 420px)';svg.style.height='auto';
 const info=make('small','파랑: 배속 · 주황: 줌');
 const save=make('button','재생 메타 JSON 다운로드');save.type='button';
 const upload=make('input');upload.type='file';upload.accept='.json,application/json';
 const publish=make('button','메타 수정 요청');publish.type='button';publish.hidden=typeof onSaveRequest!=='function';
 let sending=false,sent=false,valid=true;
 const frameSec=raw=>Math.round(Number(raw)*MASTER_FPS);
 let current=structuredClone(initial);

 function plot(t){
  svg.replaceChildren();
  const line=(points,max,color)=>{
   const p=d.createElementNS(svgns,'polyline');
   p.setAttribute('points',points.map(x=>`${10+x.frame/t.durationFrames*340},${84-x.value/max*68}`).join(' '));
   p.setAttribute('fill','none');p.setAttribute('stroke',color);p.setAttribute('stroke-width','2');
   svg.append(p);
  };
  const speedPoints=t.speedCurve.flatMap(({frame},i)=>{
   const end=t.speedCurve[i+1]?.frame??t.durationFrames;
   return Array.from({length:12},(_,n)=>frame+(end-frame)*n/12);
  });
  speedPoints.push(t.durationFrames);
  line(speedPoints.map(frame=>({frame,value:cinematicSpeedAt(t.speedCurve,frame)})),4,'#5ac9ff');
  // The camera curve is smoothly interpolated at runtime. Plot the same samples.
  const sample=compileCinematicTimeline(t,45);
  const cameraPoints=Array.from({length:49},(_,i)=>({frame:i*t.durationFrames/48,value:sample(i*t.durationFrames/48).zoom-1}));
  line(cameraPoints,2,'#ffa34f');
 }
 const num=s=>{if(!s.trim())return NaN;return Number(s);};
 function readKeys(v,arity){
  return v.trim().split(/\r?\n/).map(row=>{
   const vals=row.split(',').map(num);
   if(vals.length!==arity||!vals.every(Number.isFinite))throw Error('INVALID_KEY');
   return vals;
  });
 }
 function evaluate(){
  let next;
  try{
   next={durationFrames:frameSec(duration.value),
    speedCurve:readKeys(speeds.value,2).map(([sec,rate])=>({frame:frameSec(sec),rate})),
    cameraCurve:readKeys(cameras.value,4).map(([sec,zoom,x,y])=>({frame:frameSec(sec),zoom,x,y}))};
  }catch{}
  if(!validCinematicPlayback(next)){
   valid=false;save.disabled=true;publish.disabled=true;hint.textContent='0초 키가 필요해요. 시간은 중복 없이 오름차순, 배속 0–4, 줌 1–3배, 중심 0–1로 입력해 주세요.';
   onValid(null);return;
  }
  current=next;valid=true;save.disabled=false;publish.disabled=sending||sent;hint.textContent=(next.durationFrames/MASTER_FPS).toFixed(3)+'초 · 24fps';
  plot(next);onValid(next);
 }
 for(const el of [duration,speeds,cameras])el.addEventListener('input',evaluate,{signal});
 save.addEventListener('click',()=>{
  const href=URL.createObjectURL(new Blob([JSON.stringify({schemaVersion:'ngs.cinematic-playback.v1',masterFps:MASTER_FPS,playback:current},null,2)],{type:'application/json'}));
  const a=make('a');a.href=href;a.download='cinematic-playback.json';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
 },{signal});
 upload.addEventListener('change',async()=>{
  const f=upload.files?.[0];upload.value='';
  if(!f)return;
  try{
   if(f.size<2||f.size>64*1024)throw Error('INVALID_JSON');
   const raw=JSON.parse(await f.text());
   if(signal?.aborted)return;
   const next=raw?.schemaVersion==='ngs.cinematic-playback.v1'&&raw.masterFps===MASTER_FPS?raw.playback:raw;
   if(!validCinematicPlayback(next))throw Error('INVALID_JSON');
   duration.value=String(next.durationFrames/MASTER_FPS);
   speeds.value=next.speedCurve.map(p=>[p.frame/MASTER_FPS,p.rate].join(', ')).join('\n');
   cameras.value=next.cameraCurve.map(p=>[p.frame/MASTER_FPS,p.zoom,p.x,p.y].join(', ')).join('\n');
   evaluate();hint.textContent+=' · 파일을 읽었어요. 아직 저장하지 않았어요.';
  }catch{if(!signal?.aborted)hint.textContent='재생 메타 JSON을 읽을 수 없어요.';}
 },{signal});
 publish.addEventListener('click',async()=>{
  if(!valid||sending||sent)return;
  sending=true;publish.disabled=true;
  try{
   await onSaveRequest(structuredClone(current));
   if(signal?.aborted)return;sent=true;hint.textContent='정식 메타 수정 요청을 접수했어요. 반영 뒤 화면을 새로고침해 주세요.';
  }catch(err){
   if(!signal?.aborted)hint.textContent=err?.message==='CINEMATIC_PLAYBACK_REVISION_CONFLICT'
    ?'다른 수정이 먼저 반영됐어요. 화면을 새로고침해 주세요.':'메타 수정 요청 접수를 확인하지 못했어요.';
  }finally{sending=false;publish.disabled=!valid||sent;}
 },{signal});
 group.append(legend,note,label('컷 길이(초)',duration),label('속도 곡선: 초, 배속',speeds),
  label('카메라 곡선: 초, 줌, 중심 X, 중심 Y',cameras),svg,info,hint);
 if(allowDownload)group.append(save);
 group.append(label('직접 편집한 메타 JSON 가져오기',upload),publish);
 parent.append(group);evaluate();
}

async function loadImages(urls,signal){
 const result=new Array(urls.length);let index=0;
 await Promise.all(Array.from({length:Math.min(4,urls.length)},async()=>{
  while(index<urls.length){signal.throwIfAborted();const i=index++;const image=new Image();image.src=urls[i];
   await image.decode();signal.throwIfAborted();result[i]=image;
  }
 }));
 return result;
}
export async function mountCinematicPlayer(parent,{manifest,frameUrl,signal,edit=true,onSaveRequest,autoplay=false}){
 const d=parent.ownerDocument,make=(tag,text)=>{const e=d.createElement(tag);if(text)e.textContent=text;return e;};
 const stage=make('canvas');stage.width=manifest.width;stage.height=manifest.height;
 stage.style.maxWidth='100%';stage.style.display='block';stage.setAttribute('aria-label','시네마틱 전용 카메라 화면');
 const canvas=stage.getContext('2d',{alpha:false});
 const toggle=make('button','재생'),range=make('input'),status=make('p','시네마틱 PNG 프레임을 읽고 있어요.');
 toggle.type='button';toggle.disabled=true;
 range.type='range';range.min='0';range.max=String(manifest.playback.durationFrames-1);range.step='1';range.value='0';range.disabled=true;range.setAttribute('aria-label','시네마틱 시간');
 status.setAttribute('role','status');parent.append(stage,toggle,range,status);
 let playback=manifest.playback,evaluate=compileCinematicTimeline(playback,manifest.frameCount);
 let tick=0,base=0,started=null,handle=null,frames;
 function disable(){if(handle!==null)cancelAnimationFrame(handle);handle=null;started=null;toggle.textContent='재생';}
 function paint(masterFrame){
  const frame=Math.min(masterFrame,playback.durationFrames-1);
  const camera=evaluate(frame);const source=frames[camera.source];
  const r=cinematicStageRect(stage.width,stage.height,manifest.width,manifest.height,camera);
  canvas.drawImage(source,r.left,r.top,r.width,r.height);
  range.value=String(frame);
  status.textContent=(frame/MASTER_FPS).toFixed(2)+'초 / '+(playback.durationFrames/MASTER_FPS).toFixed(2)+'초';
 }
 function advance(now){
  if(signal.aborted)return disable();
  if(started===null)started=now;
  const next=base+Math.floor((now-started)*MASTER_FPS/1000);
  if(next!==tick){tick=Math.min(next,playback.durationFrames-1);paint(tick);}
  if(next>=playback.durationFrames){disable();return;}
  handle=requestAnimationFrame(advance);
 }
 function start(){
  if(handle!==null)return;
  if(tick>=playback.durationFrames-1){tick=0;paint(tick);}
  base=tick;toggle.textContent='일시 정지';handle=requestAnimationFrame(advance);
 }
 toggle.addEventListener('click',()=>handle===null?start():disable(),{signal});
 range.addEventListener('input',()=>{disable();tick=Number(range.value);paint(tick);},{signal});
 signal.addEventListener('abort',disable,{once:true});
 try{
  frames=await loadImages(manifest.frames.map(frame=>frameUrl(frame.index)),signal);
  signal.throwIfAborted();
 }catch(error){if(!signal.aborted)status.textContent='PNG 프레임을 읽지 못했어요.';throw error;}
 toggle.disabled=false;range.disabled=false;paint(0);
 if(autoplay)start();
 if(edit)layoutTimelineControls(parent,playback,value=>{
  if(!value)return;
  disable();playback=value;evaluate=compileCinematicTimeline(playback,manifest.frameCount);
  range.max=String(playback.durationFrames-1);tick=Math.min(tick,playback.durationFrames-1);paint(tick);
 },{signal,onSaveRequest});
}
