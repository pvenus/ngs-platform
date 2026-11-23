import {initial,targets,act,nextAftermath} from './ending-state.mjs';
import {eligibleSceneTargets,activateSceneTarget,hitScene,readScenePointer} from './scene-input.mjs';
const q=s=>document.querySelector(s),host=q('.ngs-host'),plane=q('.scene-plane'),still=q('#image'),video=q('#film');
const prompt=q('#start'),resume=q('#resume'),actionBar=q('#actions'),hint=q('#hint'),markers=q('.targets');
let state=initial(),started=false,muted=false,epoch=0,busy=false,ctx,loop,volume,buffer,loading,filmToken;
const captions={
 home:'대문 쪽으로 다가갑니다.',shoulders:'문간 너머에 마당이 보입니다.',yard:'신발 쪽이나 열린 문을 살펴볼 수 있어요.',
 shoes:'마루 아래 마당 쪽에 작은 신이 놓여 있어요.',room:'방 안의 물건을 직접 눌러 살펴보세요.',
 ribbon:'머리끈이 놓여 있습니다.',doll:'낡은 천 인형이 있습니다.',candle:'심지가 꺼져 있습니다.'
};
const films=new Set(['ignition','doll-dissolve','ribbon-dissolve','bowed','ending']);
const assets=(s,ext)=>new URL('assets/'+s+'.'+ext,import.meta.url).href;
for (const s of Object.keys(captions)){const preload=new Image();preload.src=assets(s,'webp');}
function frame(){
 const ts=targets(state).map(t=>t.kind==='move'?{...t,choiceId:t.id}:t);
 return {targets:ts,routes:ts.filter(t=>t.kind==='move').map(t=>({trigger:'choice:'+t.id,target:t.id})),paused:busy||!started};
}
function paintControls(){
 Object.assign(host.dataset,{coreNode:state.node,coreSequence:String(state.sequence),encounterRevision:'ending.v1'});
 const controls=eligibleSceneTargets(frame());
 markers.replaceChildren();actionBar.replaceChildren();
 actionBar.hidden=!controls.length;
 for(const t of controls){
  const b=document.createElement('button');b.type='button';b.textContent=t.label;b.dataset.action=t.id;
  if(state.seen.includes(t.id))b.classList.add('is-seen');
  b.onclick=()=>choose(t.id);
  b.onkeydown=e=>{if((e.key==='Enter'||e.key===' ')&&!e.repeat){e.preventDefault();void choose(t.id);}};
  actionBar.append(b);
  if(t.id!=='room'||state.node==='yard'){
   const m=document.createElement('span');m.className='marker';m.setAttribute('aria-hidden','true');
   m.style.left=100*(t.rect.x+t.rect.width/2)+'%';m.style.top=100*(t.rect.y+t.rect.height/2)+'%';markers.append(m);
  }
 }
 hint.textContent=started?(captions[state.node]??''):'';
}
function replacePicture(n){
 video.hidden=true;still.hidden=false;still.src=assets(n,'webp');
}
function pauseScore(fade=0){
 if(!loop||!ctx)return;
 if(fade){volume.gain.cancelScheduledValues(ctx.currentTime);volume.gain.setTargetAtTime(0,ctx.currentTime,.055);}
 try{loop.stop(ctx.currentTime+fade);}catch{}
 loop=null;
}
async function startScore(){
 const token=epoch;
 try{
  ctx??=new (window.AudioContext||window.webkitAudioContext)();
  await ctx.resume();
  loading??=fetch(assets('intro-loop','wav')).then(r=>{if(!r.ok)throw Error('audio');return r.arrayBuffer();}).then(data=>ctx.decodeAudioData(data));
  buffer??=await loading;
  if(token!==epoch||!started||!video.hidden&&state.node==='ending')return;
  pauseScore();
  loop=ctx.createBufferSource();volume=ctx.createGain();loop.buffer=buffer;loop.loop=true;
  volume.gain.value=muted?0:.75;
  loop.connect(volume);volume.connect(ctx.destination);loop.start();
 }catch{loading=null;hint.textContent='배경음을 읽지 못했어요. 조작은 계속할 수 있어요.';}
}
function safetyPlay(){
 const current=filmToken;resume.hidden=true;
 video.play().catch(()=>{if(current===filmToken)resume.hidden=false;});
}
function showFilm(){
 filmToken={};const local=filmToken;
 video.onended=null;video.onplaying=null;video.onerror=null;
 video.preload='auto';video.muted=muted||state.node!=='ending';
 video.onerror=()=>{if(local===filmToken){resume.hidden=false;hint.textContent='영상 연결을 다시 확인해 주세요.';}};
 video.onended=()=>{
  if(local!==filmToken)return;
  const n=nextAftermath(state);
  if(n===state){hint.textContent='';return;}
  state=n;render();
 };
 video.onplaying=()=>{if(local===filmToken&&state.node==='ending')pauseScore(.16);};
 video.src=assets(state.node,'mp4');
 still.hidden=true;video.hidden=false;
 safetyPlay();
}
function render(){
 paintControls();
 if(films.has(state.node))showFilm();
 else replacePicture(state.node);
}
const wait=n=>new Promise(resolve=>setTimeout(resolve,n));
async function choose(id){
 if(busy||!started||!activateSceneTarget(frame(),id))return;
 const next=act(state,id);
 if(next===state)return;
 const token=epoch;
 if(id==='light'){state=next;render();return;}
 busy=true;paintControls();plane.classList.add('transition');
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 await wait(reduced?30:id==='walk'?800:480);
 if(token!==epoch)return;
 state=next;render();plane.classList.remove('transition');
 await wait(reduced?30:350);
 if(token!==epoch)return;
 busy=false;paintControls();
 if(document.activeElement?.tagName==='BODY')actionBar.querySelector('button')?.focus({preventScroll:true});
}
function reset(){
 epoch++;filmToken=null;state=initial();started=false;busy=false;pauseScore();
 video.pause();video.onended=null;video.onplaying=null;video.onerror=null;video.removeAttribute('src');video.load();
 plane.classList.remove('transition');prompt.hidden=false;resume.hidden=true;render();q('#begin').focus();
}
q('#begin').onclick=()=>{if(started)return;started=true;prompt.hidden=true;render();void startScore();};
q('#continue').onclick=safetyPlay;
q('#reset').onclick=reset;
q('#mute').onclick=e=>{
 muted=!muted;e.currentTarget.textContent=muted?'소리 켜기':'소리 끄기';e.currentTarget.setAttribute('aria-pressed',String(muted));
 if(state.node==='ending')video.muted=muted;
 if(volume&&loop&&ctx){volume.gain.cancelScheduledValues(ctx.currentTime);volume.gain.setTargetAtTime(muted?0:.75,ctx.currentTime,.08);}
};
plane.addEventListener('pointerup',e=>{
 const point=readScenePointer(e);
 if(!point)return;
 const target=hitScene(frame(),...point);
 if(target)void choose(target.id);
});
plane.addEventListener('pointermove',e=>{
 const r=plane.getBoundingClientRect();
 plane.style.cursor=hitScene(frame(),(e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height)?'pointer':'';
});
addEventListener('pagehide',()=>{pauseScore();video.pause();});
render();
