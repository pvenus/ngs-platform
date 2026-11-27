/** Convert source PNG pixels to map units; viewport zoom never changes a placement. */
export const spriteRoles=['table','bowl','well','lid'];
export const spriteParents={table:'altar',bowl:'altar',well:'well',lid:'well'};
export const exactScale=s=>Number.isInteger(s)&&s>=10&&s<=300;
export const scaleOf=(scale,role)=>exactScale(scale?.[role])?scale[role]:100;
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
