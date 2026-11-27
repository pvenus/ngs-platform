import {backgroundLoopFrame} from './cinematic-timeline.mjs';

export const spiritSightFlag='seojin.spiritSight';
export const backgroundTransitionSeconds=.55;
export const backgroundPhase=backgroundLoopFrame;
export function createSpiritBlend(seconds=backgroundTransitionSeconds){
 let value=0,target=0,initial=0,elapsed=0,duration=0;
 return {
  get value(){return value;},
  set(enabled){
   if(Number(enabled)===target)return;
   target=Number(enabled);initial=value;elapsed=0;duration=Math.max(seconds*.25,seconds*Math.abs(target-initial));
  },
  advance(delta){
   if(duration<=0)return value=target;
   elapsed=Math.min(duration,elapsed+Math.max(0,delta));
   const t=elapsed/duration,eased=t*t*(3-2*t);
   return value=initial+(target-initial)*eased;
  },
 };
}

export function playableBackgroundManifest(normalFrames=0,spiritFrames=0){
 function track(key,count){
  return {still:key+'/still.png',frames:Array.from({length:count},(_,i)=>key+'/frames/'+String(i).padStart(4,'0')+'.png'),
   ticksPerFrame:count===45?3:6,fps:24};
 }
 return {schemaVersion:'ngs.background-playable.v1',flag:spiritSightFlag,transitionSeconds:backgroundTransitionSeconds,
  normal:track('normal',normalFrames),spirit:track('spirit',spiritFrames)};
}

export function mountPlayableBackground(parent,{stills,loadPair,signal,onEnlarge}){
 const node=(tag,txt)=>{const el=document.createElement(tag);if(txt)el.textContent=txt;return el;};
 const toggle=node('button','영적 시야 켜기'),status=node('p','기본 시야 · 이미지'),stage=node('span');
 toggle.type='button';toggle.className='prop-control';toggle.dataset.flag=spiritSightFlag;toggle.setAttribute('aria-pressed','false');
 status.className='meta';status.setAttribute('role','status');
 stage.className='background-playable-stage';
 Object.assign(stage.style,{display:'block',position:'relative',overflow:'hidden',width:'100%',aspectRatio:String(stills.normal.width/stills.normal.height),background:'#141414'});
 stage.setAttribute('role','img');stage.setAttribute('aria-label',stills.title);
 const layers={};
 for(const key of ['normal','spirit']){
  const layer=node('span'),img=node('img'),canvas=loadPair?node('canvas'):null;
  img.src=stills[key].url;img.alt='';layer.dataset.layer=key;
  const stack={position:'absolute',inset:'0',width:'100%',height:'100%'};
  const media={...stack,objectFit:'contain',imageRendering:key==='normal'?'pixelated':'auto'};
  Object.assign(layer.style,stack,{opacity:key==='normal'?'1':'0'});
  Object.assign(img.style,media);layer.append(img);
  if(canvas){Object.assign(canvas.style,media);canvas.hidden=true;layer.append(canvas);}
  stage.append(layer);layers[key]={layer,img,canvas,ctx:canvas?.getContext('2d')};
 }
 let view=stage;
 if(onEnlarge){
  view=node('button');view.type='button';view.className='npc-media-enlarge-trigger background-still-enlarge';
  view.setAttribute('aria-haspopup','dialog');view.addEventListener('click',()=>onEnlarge(flag),{signal});view.append(stage);
 }
 parent.append(toggle,status,view);
 const transition=createSpiritBlend();
 let flag=false,prior,origin,raf,tracks,timeline,published=false;
 const frameIndices={normal:-1,spirit:-1};
 function updateStatus(){
  if(onEnlarge)view.setAttribute('aria-label',(flag?'시네마틱 스타일 원본':'픽셀 보정본')+' 확대');
  status.textContent=(flag?'영적 시야':'기본 시야')+' · '+(tracks?'반복 애니메이션':'이미지'+(published?' (두 애니메이션을 함께 불러오지 못했어요)':''));
 }
 function tick(now){
  if(signal.aborted)return;
  origin??=now;
  const blend=transition.advance((now-(prior??now))/1000);
  prior=now;
  // The base remains opaque. Compositing only the upper layer avoids a dark midpoint.
  layers.spirit.layer.style.opacity=String(blend);
  if(tracks){
   const ticks=(now-origin)*24/1000;
   for(const key of ['normal','spirit']){
    const track=tracks[key],i=backgroundPhase(ticks,track.frames.length,timeline[key].ticksPerFrame);
    if(i!==frameIndices[key]){
     const target=layers[key],image=track.decoded[i],canvas=target.canvas;
     if(canvas.width!==image.naturalWidth)canvas.width=image.naturalWidth;
     if(canvas.height!==image.naturalHeight)canvas.height=image.naturalHeight;
     target.ctx.clearRect(0,0,canvas.width,canvas.height);target.ctx.drawImage(image,0,0);
     canvas.hidden=false;target.img.hidden=true;target.layer.dataset.frame=String(i);frameIndices[key]=i;
    }
   }
  }
  if(tracks||blend!==Number(flag))raf=requestAnimationFrame(tick);else raf=undefined;
 }
 function wake(){if(raf===undefined){prior=undefined;raf=requestAnimationFrame(tick);}}
 function setFlag(key,enabled){
  if(key!==spiritSightFlag||typeof enabled!=='boolean'||signal.aborted)return false;
  if(flag!==enabled){
   flag=enabled;transition.set(flag);toggle.setAttribute('aria-pressed',String(flag));toggle.textContent=flag?'영적 시야 끄기':'영적 시야 켜기';
   updateStatus();wake();
  }
  return true;
 }
 toggle.addEventListener('click',()=>setFlag(spiritSightFlag,!flag),{signal});
 signal.addEventListener('abort',()=>cancelAnimationFrame(raf),{once:true});
 updateStatus();

 async function prepare(){
  let candidate;
  try{
   candidate=await loadPair();signal.throwIfAborted();if(!candidate)return;
   const jobs=Object.entries(candidate).flatMap(([key,track])=>track.frames.map((url,index)=>({key,url,index})));
   // Best-effort browser decoding before the switch to animation. Do not expose a half-ready pair.
   for(const track of Object.values(candidate))track.decoded=[];
   if(!Object.values(layers).every(layer=>layer.ctx))throw Error('BACKGROUND_CANVAS_UNAVAILABLE');
   for(let i=0;i<jobs.length;i+=6){
    signal.throwIfAborted();
    await Promise.all(jobs.slice(i,i+6).map(({key,url,index})=>{
     const image=new Image();candidate[key].decoded[index]=image;image.src=url;return image.decode();
    }));
   }
   signal.throwIfAborted();
   timeline=playableBackgroundManifest(candidate.normal.frames.length,candidate.spirit.frames.length);
   tracks=candidate;stage.dataset.motion='paired';updateStatus();wake();
  }catch{if(!signal.aborted){published=Boolean(candidate);updateStatus();}}
 }
 return {setFlag,ready:loadPair?prepare():Promise.resolve()};
}
