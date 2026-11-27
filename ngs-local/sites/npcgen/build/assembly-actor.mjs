import {createMapWarp,entryFraction} from './map-warp.mjs';
import {mapColliderRotation,mapColliderShape,validMapPerspective} from './map-contract.mjs';

const clamp=n=>Math.min(1000,Math.max(0,n));
const movementKeys=new Set(['w','a','s','d']);
const physicalMovement=new Map([['KeyW','w'],['KeyA','a'],['KeyS','s'],['KeyD','d']]);
const arrowMovement=new Map([['ArrowUp','w'],['ArrowLeft','a'],['ArrowDown','s'],['ArrowRight','d']]);
const movementCode=e=>e.code&&e.code!=='Unidentified'?e.code:e.key;
const movementKey=(event,arrows)=>physicalMovement.get(movementCode(event))??(arrows?arrowMovement.get(movementCode(event)):null)??
 (!event.code||event.code==='Unidentified'?event.key?.toLowerCase():null);
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

export function createAssemblyActor(graph,{collisions=true,canTraverse}={}){
 let warp=createMapWarp(graph,{canTraverse});
 const walls=new Map(graph.regions.map(r=>[r.id,[]]));
 for(const c of collisions?graph.colliders??[]:[])walls.get(c.regionId).push(c);
 return {
  snapshot:()=>warp.snapshot(),
  reset(){warp=createMapWarp(graph,{canTraverse});return warp.snapshot();},
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
export function mountAssemblyActor(scene,{graph,root=scene,signal,onMove,onRegion,nearRadius=8,speed=260,arrows=false,clickToMove=false,collisions=true,markerClass='assembly-actor',canTraverse,
 requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),
 cancelFrame=globalThis.cancelAnimationFrame?.bind(globalThis)}={}){
 const actor=createAssemblyActor(graph,{collisions,canTraverse}),keys=new Map();
 const document=scene.ownerDocument??globalThis.document;
 const marker=document.createElement('span');
 marker.className=markerClass;
 marker.setAttribute('role','img');marker.setAttribute('aria-label','캐릭터 위치');
 marker.style.pointerEvents='none';
 const addTab=!scene.hasAttribute('tabindex');
 let enabled=!signal?.aborted,disposed=Boolean(signal?.aborted),frame=null,last=null,target=null;
 if(!disposed){
  if(addTab)scene.setAttribute('tabindex','0');
  scene.append(marker);
 }
 function draw({position}){
  if(!disposed&&marker.parentNode!==scene)scene.append(marker);
  marker.style.left=position.x/10+'%';marker.style.top=position.y/10+'%';
 }
 function stop(){
  keys.clear();target=null;last=null;
  if(frame!==null){cancelFrame?.(frame);frame=null;}
 }
 function inScope(){
  const target=document.activeElement;
  return Boolean(target&&(target===root||root.contains(target))&&!isControl(target));
 }
 function schedule(){if(frame===null)frame=requestFrame?.(tick)??null;}
 function tick(time){
  frame=null;
  if(!enabled||(!keys.size&&!target)||!inScope()){stop();return;}
  const previous=last;last=time;
  if(previous!==null){
   const dt=Math.min(50,Math.max(0,time-previous))/1000,step=speed*dt;
   const before=actor.snapshot();let {x,y}=assemblyDirection(new Set(keys.values()));
   if(target){
    const dx=target.x-before.position.x,dy=target.y-before.position.y,len=Math.hypot(dx,dy)||1,dist=Math.min(len,step);
    x=dx/len*dist;y=dy/len*dist;if(dist>=len)target=null;
   }else{x*=step;y*=step;}
   if(x||y){
    const size=scene.getBoundingClientRect();
    const next=actor.move(x,y,size.width/size.height);
    if(next.warp){target=null;onRegion?.(next.regionId,next.warp);}
    if(next.warp||before.position.x!==next.position.x||before.position.y!==next.position.y){
     draw(next);onMove?.(actor.snapshot());
    }else if(target)target=null;
   }else if(target&&target.x===before.position.x&&target.y===before.position.y)target=null;
  }
  if(enabled&&(keys.size||target))schedule();else last=null;
 }
 function down(event){
  const key=movementKey(event,arrows);
  if(!enabled||!movementKeys.has(key)||event.defaultPrevented||event.isComposing||
     event.altKey||event.ctrlKey||event.metaKey||isControl(event.target)||!inScope())return;
  event.preventDefault();target=null;
  keys.set(event.code&&event.code!=='Unidentified'?event.code:key,key);schedule();
 }
 function up(event){
  const key=movementKey(event,arrows);
  if(keys.delete(event.code&&event.code!=='Unidentified'?event.code:key)&&!keys.size&&!target)stop();
 }
 function focusOut(event){
  const next=event.relatedTarget;
  if(!next||!(next===root||root.contains(next))||isControl(next))stop();
 }
 function focusScene(event){
  if(event.button!==0||isControl(event.target))return;
  scene.focus({preventScroll:true});
  if(!clickToMove||!enabled||!inScope())return;
  const rect=scene.getBoundingClientRect();
  if(!(rect.width>0&&rect.height>0))return;
  keys.clear();target={x:clamp((event.clientX-rect.left)*1000/rect.width),y:clamp((event.clientY-rect.top)*1000/rect.height)};
  schedule();
 }
 function dispose(){
  disposed=true;enabled=false;stop();
  root.removeEventListener('keydown',down);root.removeEventListener('keyup',up);
  root.removeEventListener('focusout',focusOut);
  scene.removeEventListener('pointerdown',focusScene);
  document.defaultView?.removeEventListener('blur',stop);
  signal?.removeEventListener('abort',dispose);
  marker.remove();
  if(addTab&&scene.getAttribute('tabindex')==='0')scene.removeAttribute('tabindex');
 }
 if(!disposed){
  root.addEventListener('keydown',down);root.addEventListener('keyup',up);root.addEventListener('focusout',focusOut);
  scene.addEventListener('pointerdown',focusScene);
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

// Render-only projection. Positions and interactions remain in unscaled world coordinates.
export function assemblyPerspective(profile,position){
 if(!profile||!validMapPerspective(profile))return null;
 const a=profile.near,b=profile.far;
 const dx=b.point.x-a.point.x,dy=b.point.y-a.point.y;
 const depth=clamp(((position.x-a.point.x)*dx+(position.y-a.point.y)*dy)*1000/(dx*dx+dy*dy))/1000;
 const t=depth*depth*(3-2*depth);
 const actorHeight=(a.actorHeight+(b.actorHeight-a.actorHeight)*depth)/1000;
 const zoom=1000/(a.viewWidth+(b.viewWidth-a.viewWidth)*t);
 const offset=v=>Math.max(-100*(zoom-1),Math.min(0,v));
 return {depth,actorHeight,zoom,x:offset(50-position.x/10*zoom),
  y:offset(50-(position.y/10-actorHeight*50)*zoom)};
}

function rearAvatar(doc){
 // Temporary silhouette used to evaluate depth, not a released Seojin asset.
 const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg');
 svg.setAttribute('viewBox','0 0 56 135');svg.setAttribute('aria-hidden','true');
 for(const [fill,d] of [
  ['#17202a','M8 38h10v-9h-3V17h6V8h8V0h8v10h5v17h-4v10h9v7h5v17h4v24H45l1 34h4v16H35v-16h-4v-13h-6v16h-5v13H7v-15h5L11 88H1V57h3V44h4z'],
  ['#344c54','M10 43l18-6 16 5 6 15 2 23-10-8-3 16 5 29-15 2-13-3 4-32-7-12-7 7V60z'],
  ['#526974','M12 46l15-7 16 7-6 18-17 9-9-2 3-14z'],
  ['#9e7056','M11 73l17 2 15-3v6l-14 4-18-3z'],
  ['#4b484b','M19 30l3-13 12-5 6 5-6 4-5 8-9 4z'],
  ['#41515d','M11 123h8v5h-8zm25 1h9v4h-9z'],
 ]){
  const path=doc.createElementNS(ns,'path');path.setAttribute('fill',fill);path.setAttribute('d',d);svg.append(path);
 }
 return svg;
}

export function mountAssemblyPerspective(scene,controls,graph,signal,overlay){
 const profiles=new Map(graph.regions.filter(r=>r.perspective&&validMapPerspective(r.perspective)).map(r=>[r.id,r.perspective]));
 if(!profiles.size)return null;
 const doc=scene.ownerDocument,viewport=doc.createElement('div');
 viewport.className='assembly-perspective-viewport';scene.replaceWith(viewport);viewport.append(scene);
 if(overlay)viewport.append(overlay);
 const control=name=>{const b=doc.createElement('button');b.type='button';b.className='prop-control';b.setAttribute('aria-label',name);controls.append(b);return b;};
 const camera=control('원근 카메라'),visibility=control('캐릭터 표시');
 let enabled=true,visible=true,last=null,avatar=null;
 function paint(state){
  last=state;
  const marker=scene.querySelector('.assembly-actor');
  if(!marker)return;
  const profile=profiles.get(state.regionId), value=enabled&&assemblyPerspective(profile,state.position);
  camera.hidden=visibility.hidden=!profile;
  camera.textContent='원근 카메라 · '+(enabled?'ON':'OFF');
  visibility.textContent='캐릭터 표시 · '+(visible?'ON':'OFF');
  camera.setAttribute('aria-pressed',String(enabled));visibility.setAttribute('aria-pressed',String(visible));
  scene.style.transform=value?'translate('+value.x+'%,'+value.y+'%) scale('+value.zoom+')':'';
  scene.dataset.perspective=value?'on':'off';
  marker.hidden=Boolean(profile&&!visible);
  if(!profile){delete marker.dataset.perspectiveAvatar;marker.style.height='';if(avatar?.parentNode===marker)avatar.remove();return;}
  marker.dataset.perspectiveAvatar='';marker.style.height=((value?.actorHeight??profile.far.actorHeight/1000)*100)+'%';
  avatar??=rearAvatar(doc);if(avatar.parentNode!==marker)marker.append(avatar);
 }
 camera.addEventListener('click',()=>{enabled=!enabled;if(last)paint(last);scene.focus({preventScroll:true});},{signal});
 visibility.addEventListener('click',()=>{visible=!visible;if(last)paint(last);scene.focus({preventScroll:true});},{signal});
 return {paint};
}
