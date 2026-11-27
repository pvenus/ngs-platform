import {mapDecorPinKey,mapDecorationRotation,validPropZOrder,propZMin} from './map-contract.mjs';
/** Convert source PNG pixels to map units; viewport zoom never changes a placement. */
export const spriteRoles=['table','bowl','well','lid'];
export const spriteParents={table:'altar',bowl:'altar',well:'well',lid:'well',spirit:'spirit'};
export const exactScale=s=>Number.isInteger(s)&&s>=10&&s<=300;
export const scaleOf=(scale,role)=>exactScale(scale?.[role])?scale[role]:100;
export const decorationZOrder=row=>validPropZOrder(row?.zOrder)?row.zOrder:0;
const defaultPuzzleZ={table:-100,bowl:-99,well:-100,lid:-99,spirit:100};
export const puzzleZOrder=(values,role)=>validPropZOrder(values?.[role])?values[role]:defaultPuzzleZ[role]??0;
export function paintPropDepth(node,value,kind='decoration'){
 const tie=kind==='spirit'?2:kind==='puzzle'?1:0;
 if(node)node.style.zIndex=String(((validPropZOrder(value)?value:0)-propZMin)*3+tie+1);
}
export const imageSize=art=>Number.isInteger(art?.width)&&art.width>0&&Number.isInteger(art?.height)&&art.height>0;
export function assemblySpriteBox({role,layout,attachments,scale,asset,region}){
 const base=layout?.[spriteParents[role]];
 if(!base||base.regionId!==region?.id||!imageSize(asset)||!imageSize(region))return null;
 const offset=(role==='bowl'||role==='lid')?attachments?.[role]:null;
 const size=scaleOf(scale,role);
 return {x:base.x+(offset?.x??0),y:base.y+(offset?.y??0),width:asset.width*size/region.width,height:asset.height*size/region.height};
}
export function applyAssemblySpriteBox(element,box){
 element.hidden=!box;
 if(box)Object.assign(element.style,{left:box.x+'%',top:box.y+'%',width:box.width+'%',height:box.height+'%'});
}

/** Map decoration is visual only. Anchor = bottom center in natural-map permille. */
export function decorationArt(prop,pin){
 if(prop?.propId!==pin.propId||prop.source?.revision!==pin.revision||prop.source?.sha256!==pin.sha256)return null;
 const lane=key=>{
  const x=prop.media?.[key];
  return x?.mediaType==='image/png'&&imageSize(x)&&typeof x.url==='string'&&x.url.startsWith('/api/prop-workspace?')?x:null;
 };
 return {pixel:lane('pixel'),cinematic:lane('spirit'),detail:lane('detail')};
}
export function decorationBox(row,art,region,spirit){
 const mode=spirit?'cinematic':'pixel';
 if((row.visibility!=='both'&&row.visibility!==mode)||!imageSize(region))return null;
 const asset=art?.[mode];
 if(!imageSize(asset))return null;
 return {src:asset.url,x:row.anchor.x/10,y:row.anchor.y/10,width:asset.width*row.scale/region.width,height:asset.height*row.scale/region.height,rotation:mapDecorationRotation(row),flipX:row.flipX===true,flipY:row.flipY===true,zOrder:decorationZOrder(row)};
}
export function paintDecoration(node,box,kind='decoration'){
 applyAssemblySpriteBox(node,box);
 if(box){
  paintPropDepth(node,box.zOrder,kind);
  // The image's bottom center remains pinned to its placement marker.
  node.style.transformOrigin='50% 100%';
  const translateY=box.flipY?' translateY(-100%)':'';
  const mirror=box.flipX||box.flipY?' scale('+(box.flipX?-1:1)+','+(box.flipY?-1:1)+')':'';
  node.style.transform='translate(-50%,-100%) rotate('+box.rotation+'deg)'+translateY+mirror;
  if(node.getAttribute('src')!==box.src)node.src=box.src;
 }
}
export function renderMapDecorations(host,placements,loaded,region,spirit,keyOf){
 host.replaceChildren(...placements.filter(p=>p.regionId===region?.id).flatMap(p=>{
  const box=decorationBox(p,loaded.get(keyOf(p.prop)),region,spirit);
  if(!box)return [];
  const img=document.createElement('img');img.className='map-decor-sprite';
  img.alt='';img.draggable=false;img.dataset.decorationId=p.id;paintDecoration(img,box);return [img];
 }));
}

export const missingDecorationImage=(row,art)=>!art||(row.visibility==='both'?!(art.pixel&&art.cinematic):!art[row.visibility]);
export function decorationsLoader(request,projectId){
 const cache=new Map(),pending=new Map(),catalog=new Map();
 let active=0;const queue=[];
 function dequeue(){
  while(active<4&&queue.length){
   const job=queue.shift();active++;
   Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{active--;dequeue();});
  }
 }
 const schedule=work=>new Promise((resolve,reject)=>{queue.push({work,resolve,reject});dequeue();});
 function read(pin){
  const key=mapDecorPinKey(pin);
  if(cache.has(key))return Promise.resolve();
  if(!pending.has(key))pending.set(key,schedule(async()=>{
   try{
    let prop=catalog.get(pin.propId);
    if(!prop){
     ({prop}=await request('/api/prop-workspace?'+new URLSearchParams({projectId,propId:pin.propId})));
     if(prop)catalog.set(pin.propId,prop);
    }
    cache.set(key,decorationArt(prop,pin));
   }catch{/* unavailable decoration does not stop play; next load may retry */}
  }).finally(()=>pending.delete(key)));
  return pending.get(key);
 }
 return {cache,load:async rows=>{await Promise.all(rows.map(row=>read(row.prop)));return cache;}};
}
