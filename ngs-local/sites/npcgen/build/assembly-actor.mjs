import {createMapWarp,entryFraction} from './map-warp.mjs';
import {mapColliderRotation,mapColliderShape} from './map-contract.mjs';

const clamp=n=>Math.min(1000,Math.max(0,n));
const movementKeys=new Set(['w','a','s','d']);
export function assemblyDirection(keys){
 const x=Number(keys.has('d'))-Number(keys.has('a')),y=Number(keys.has('s'))-Number(keys.has('w'));
 const length=Math.hypot(x,y)||1;
 return {x:x/length,y:y/length};
}

function colliderEntry(a,b,collider,aspect){
 const r=collider.rect,cx=r.x+r.width/2,cy=r.y+r.height/2;
 const theta=mapColliderRotation(collider)*Math.PI/180,c=Math.cos(theta),s=Math.sin(theta);
 const local=p=>{
  const x=p.x-cx,y=p.y-cy;
  // CSS rotates in pixels; positions here use the full scene on each axis.
  return {x:x*c+y*s/aspect,y:y*c-x*s*aspect};
 };
 const p=local(a),q=local(b),rx=r.width/2,ry=r.height/2;
 if(mapColliderShape(collider)!=='ellipse'){
  if(Math.abs(p.x)<=rx&&Math.abs(p.y)<=ry)return null;
  return entryFraction(p,q,{x:-rx,y:-ry,width:r.width,height:r.height});
 }
 const x=p.x/rx,y=p.y/ry,dx=q.x/rx-x,dy=q.y/ry-y;
 const k=x*x+y*y-1;
 if(k<=0)return null; // A published spawn inside a wall can still leave.
 const aa=dx*dx+dy*dy,bb=dx*x+dy*y,disc=bb*bb-aa*k;
 if(!aa||bb>=0||disc<0)return null;
 // Stable smaller root, especially for a move starting near the boundary.
 const enter=k/(-bb+Math.sqrt(disc));
 return enter<=1?enter:null;
}

export function createAssemblyActor(graph){
 let warp=createMapWarp(graph);
 const walls=new Map(graph.regions.map(r=>[r.id,[]]));
 for(const c of graph.colliders??[])walls.get(c.regionId).push(c);
 return {
  snapshot:()=>warp.snapshot(),
  reset(){warp=createMapWarp(graph);return warp.snapshot();},
  move(dx,dy,aspect=1){
   if(!Number.isFinite(dx)||!Number.isFinite(dy))throw Error('ASSEMBLY_ACTOR_DELTA_INVALID');
   const {regionId,position:a}=warp.snapshot();
   const b={x:clamp(a.x+dx),y:clamp(a.y+dy)};
   if(a.x===b.x&&a.y===b.y)return {...warp.snapshot(),warp:null};
   if(!Number.isFinite(aspect)||aspect<=0)aspect=1;
   let first=null;
   for(const c of walls.get(regionId)){
    const t=colliderEntry(a,b,c,aspect);
    if(t!==null&&(first===null||t<first))first=t;
   }
   // Clip to just before a solid shape. Existing portal handling checks the
   // surviving segment, so an earlier portal wins and walls win exact ties.
   if(first!==null){
    const x=b.x-a.x,y=b.y-a.y,t=Math.max(0,first-1e-5/Math.hypot(x,y));
    return warp.move(a.x+x*t,a.y+y*t);
   }
   return warp.move(b.x,b.y);
  },
 };
}

const isControl=target=>Boolean(target?.isContentEditable||target?.closest?.('input,textarea,select,button,[role="textbox"],[contenteditable]:not([contenteditable="false"])'));
export function mountAssemblyActor(scene,{graph,root=scene,signal,onMove,onRegion,nearRadius=8,speed=260,
 requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),
 cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis)}={}){
 const actor=createAssemblyActor(graph),keys=new Set();
 const document=scene.ownerDocument??globalThis.document;
 const marker=document.createElement('span');
 marker.className='assembly-actor';
 marker.setAttribute('role','img');marker.setAttribute('aria-label','캐릭터 위치');
 marker.style.pointerEvents='none';
 const addTab=!scene.hasAttribute('tabindex');
 let enabled=!signal?.aborted,disposed=Boolean(signal?.aborted),frame=null,last=null;
 if(!disposed){
  if(addTab)scene.setAttribute('tabindex','0');
  scene.append(marker);
 }
 function draw({position}){
  if(!disposed&&marker.parentNode!==scene)scene.append(marker);
  marker.style.left=position.x/10+'%';marker.style.top=position.y/10+'%';
 }
 function stop(){
  keys.clear();last=null;
  if(frame!==null){cancelFrame?.(frame);frame=null;}
 }
 function inScope(){
  const target=document.activeElement;
  return Boolean(target&&(target===root||root.contains(target))&&!isControl(target));
 }
 function tick(time){
  frame=null;
  if(!enabled||!keys.size||!inScope()){stop();return;}
  const previous=last;last=time;
  if(previous!==null){
   const dt=Math.min(50,Math.max(0,time-previous))/1000,d=assemblyDirection(keys);
   if(d.x||d.y){
    const size=scene.getBoundingClientRect(),before=actor.snapshot();
    const next=actor.move(d.x*speed*dt,d.y*speed*dt,size.width/size.height);
    if(next.warp||before.position.x!==next.position.x||before.position.y!==next.position.y){
     if(next.warp)onRegion?.(next.regionId);
     draw(next);onMove?.(actor.snapshot());
    }
   }
  }
  if(enabled&&keys.size&&frame===null)frame=requestFrame?.(tick)??null;
 }
 function down(event){
  const key=event.key?.toLowerCase();
  if(!enabled||!movementKeys.has(key)||event.defaultPrevented||event.isComposing||
     event.altKey||event.ctrlKey||event.metaKey||isControl(event.target)||!inScope())return;
  event.preventDefault();
  keys.add(key);
  if(frame===null)frame=requestFrame?.(tick)??null;
 }
 function up(event){
  if(keys.delete(event.key?.toLowerCase())&&!keys.size)stop();
 }
 function focusOut(event){
  const next=event.relatedTarget;
  if(!next||!(next===root||root.contains(next))||isControl(next))stop();
 }
 function dispose(){
  disposed=true;enabled=false;stop();
  root.removeEventListener('keydown',down);root.removeEventListener('keyup',up);
  root.removeEventListener('focusout',focusOut);
  document.defaultView?.removeEventListener('blur',stop);
  signal?.removeEventListener('abort',dispose);
  marker.remove();
  if(addTab&&scene.getAttribute('tabindex')==='0')scene.removeAttribute('tabindex');
 }
 if(!disposed){
  root.addEventListener('keydown',down);root.addEventListener('keyup',up);root.addEventListener('focusout',focusOut);
  document.defaultView?.addEventListener('blur',stop);
  signal?.addEventListener('abort',dispose,{once:true});
  draw(actor.snapshot());
 }
 return Object.freeze({
  snapshot:()=>actor.snapshot(),
  reset(){
   stop();const state=actor.reset();
   if(!disposed){onRegion?.(state.regionId);draw(state);onMove?.(actor.snapshot());}
   return state;
  },
  isNear(regionId,xPerc,yPerc){
   const state=actor.snapshot();
   return state.regionId===regionId&&Number.isFinite(xPerc)&&Number.isFinite(yPerc)&&
    Math.hypot(state.position.x/10-xPerc,state.position.y/10-yPerc)<=nearRadius;
  },
  setEnabled(value){enabled=Boolean(value)&&!disposed;if(!enabled)stop();},
 });
}
