import {mapPoint,validMapGraph} from './map-contract.mjs';

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
export function orderedMapChain(regions){
 if(!Array.isArray(regions)||regions.length<2||regions.length>24||new Set(regions.map(r=>r.id)).size!==regions.length)
  throw Error('MAP_WARP_ORDER_INVALID');
 return regions.slice(1).map((to,i)=>({id:'order-'+(i+1),from:regions[i].id,to:to.id,label:to.name,hit:null,spawn:null}));
}
export function createMapWarp(graph,{start={x:500,y:850}}={}){
 if(!validMapGraph(graph)||!mapPoint(start))throw Error('MAP_WARP_GRAPH_INVALID');
 const edges=new Map(graph.regions.map(r=>[r.id,[]]));
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
   let first=null;
   for(const e of edges.get(regionId)){
    if(blocked.has(e.id)){if(!inside(e.hit,next))blocked.delete(e.id);continue;}
    if(inside(e.hit,position))continue;
    const t=entryFraction(position,next,e.hit);
    if(t!==null&&(!first||t<first.t))first={edge:e,t};
   }
   if(!first){position=next;return {...snapshot(),warp:null};}
   const e=first.edge,from=regionId;
   regionId=e.to;position={...e.spawn};blockLandingExits();
   // No leftover delta is transferred to the new screen; a single input
   // update can never cascade across several portals.
   return {...snapshot(),warp:{id:e.id,from,to:regionId}};
  },
 });
}
