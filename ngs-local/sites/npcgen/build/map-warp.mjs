import {mapPoint,validMapGraph,mapColliderShape,mapColliderRotation} from './map-contract.mjs';

const inside=(r,p)=>p.x>=r.x&&p.x<=r.x+r.width&&p.y>=r.y&&p.y<=r.y+r.height;
const clamp=n=>Math.min(1000,Math.max(0,n));

// Find the first intersection on the movement segment, even when a frame
// skipped over a narrow doorway. The player footpoint uses image coordinates.
export function entryFraction(a,b,r){
 let enter=0,leave=1;
 for(const [key,width] of [['x','width'],['y','height']]){
  const d=b[key]-a[key],lo=r[key],hi=lo+r[width];
  if(d===0){if(a[key]<lo||a[key]>hi)return null;continue;}
  const t=(lo-a[key])/d, u=(hi-a[key])/d;
  enter=Math.max(enter,Math.min(t,u));leave=Math.min(leave,Math.max(t,u));
  if(enter>leave)return null;
 }
 return enter;
}
// Rotate in image space, not in the square coordinate grid. The supplied
// aspect is the pinned background width / height, independent of viewport.
function localPoint(c,p,aspect){
 const {x,y,width,height}=c.rect, theta=mapColliderRotation(c)*Math.PI/180;
 const dx=(p.x-x-width/2)*aspect,dy=p.y-y-height/2;
 const cos=Math.cos(theta),sin=Math.sin(theta);
 return {x:(dx*cos+dy*sin)/aspect+width/2,y:-dx*sin+dy*cos+height/2};
}
export function colliderEntryFraction(c,a,b,aspect=1){
 const p=localPoint(c,a,aspect),q=localPoint(c,b,aspect);
 const {width,height}=c.rect;
 if(mapColliderShape(c)==='rect'){
  const bounds={x:0,y:0,width,height};
  return inside(bounds,p)?null:entryFraction(p,q,bounds);
 }
 const x=2*p.x/width-1,y=2*p.y/height-1;
 const dx=2*(q.x-p.x)/width,dy=2*(q.y-p.y)/height;
 const outside=x*x+y*y-1;
 if(outside<=0)return null;
 const length=dx*dx+dy*dy,dot=x*dx+y*dy;
 const discriminant=dot*dot-length*outside;
 if(length===0||dot>=0||discriminant<0)return null;
 const t=outside/(-dot+Math.sqrt(discriminant));
 return t>=0&&t<=1?t:null;
}
export function orderedMapChain(regions){
 if(!Array.isArray(regions)||regions.length<2||regions.length>24||new Set(regions.map(r=>r.id)).size!==regions.length)
  throw Error('MAP_WARP_ORDER_INVALID');
 return regions.slice(1).map((to,i)=>({id:'order-'+(i+1),from:regions[i].id,to:to.id,label:to.name,hit:null,spawn:null}));
}
export function createMapWarp(graph,{start={x:500,y:850},aspectForRegion=()=>1}={}){
 if(!validMapGraph(graph)||!mapPoint(start))throw Error('MAP_WARP_GRAPH_INVALID');
 const edges=new Map(graph.regions.map(r=>[r.id,[]]));
 const walls=new Map(graph.regions.map(r=>[r.id,[]]));
 for(const collider of graph.colliders??[])walls.get(collider.regionId).push(collider);
 for(const e of graph.connections)edges.get(e.from).push(e);
 let regionId=graph.startRegionId,position={...start},blocked=new Set();
 const snapshot=()=>({regionId,position:{...position}});
 const blockLandingExits=()=>{blocked=new Set(edges.get(regionId).filter(e=>inside(e.hit,position)).map(e=>e.id));};
 blockLandingExits();
 return Object.freeze({
  snapshot,
  move(x,y){
   if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('MAP_WARP_POSITION_INVALID');
   const next={x:clamp(x),y:clamp(y)};
   if(position.x===next.x&&position.y===next.y)return {...snapshot(),warp:null};
   let wall=null;
   const ratio=aspectForRegion(regionId),aspect=Number.isFinite(ratio)&&ratio>0?ratio:1;
   for(const collider of walls.get(regionId)){
    // A start or portal landing inside a wall may leave it. Once outside,
    // the same rectangle protects against any re-entry.
    const t=colliderEntryFraction(collider,position,next,aspect);
    if(t!==null&&(wall===null||t<wall))wall=t;
   }
   let first=null;
   for(const e of edges.get(regionId)){
    if(blocked.has(e.id))continue;
    if(inside(e.hit,position))continue;
    const t=entryFraction(position,next,e.hit);
    if(t!==null&&(!first||t<first.t))first={edge:e,t};
   }
   if(wall!==null&&(!first||wall<=first.t)){
    const dx=next.x-position.x,dy=next.y-position.y;
    // Leave the footpoint strictly outside the inclusive wall boundary.
    const travel=Math.max(0,wall-1e-6/Math.hypot(dx,dy));
    position={x:position.x+dx*travel,y:position.y+dy*travel};
    for(const e of edges.get(regionId))if(!inside(e.hit,position))blocked.delete(e.id);
    return {...snapshot(),warp:null};
   }
   if(!first){
    position=next;
    for(const e of edges.get(regionId))if(!inside(e.hit,position))blocked.delete(e.id);
    return {...snapshot(),warp:null};
   }
   const e=first.edge,from=regionId;
   regionId=e.to;position={...e.spawn};blockLandingExits();
   // No leftover delta is transferred to the new screen; a single input
   // update can never cascade across several portals.
   return {...snapshot(),warp:{id:e.id,from,to:regionId}};
  },
 });
}
