/** SceneInputSession hit/eligibility port from historical Kernel2.AssemblyKernel.cs.
 * See POINTER-PROVENANCE.md for the exact reused script and adapted C# logic.
 */
const priority=new Map([['talk',0],['inspect',1],['move',2],['choice',3]]);
const validText=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max;
const validRect=rect=>rect!=null&&['x','y','width','height'].every(k=>Number.isFinite(rect[k]))&&
 rect.x>=-4&&rect.x<=4&&rect.y>=-4&&rect.y<=4&&rect.width>0&&rect.width<=4&&rect.height>0&&rect.height<=4;
const ordinal=(a,b)=>a<b?-1:a>b?1:0;
const route=(frame,id)=>id?frame.routes?.find(edge=>edge?.trigger==='choice:'+id):undefined;
function eligible(frame,target){
 if(target.visible===false||target.enabled===false||frame.ended||frame.paused||frame.dialogueOpen||
    (frame.phase??'idle')!=='idle')return false;
 if(target.kind==='talk')return !frame.encounterPresent||frame.canTalk===true;
 const choice=route(frame,target.choiceId);
 if(target.kind==='move'){
  if(!choice)return false;
  if(!frame.encounterPresent)return true;
  const pending=route(frame,frame.pendingChoiceId);
  return frame.canMove===true&&!!pending&&pending.target===choice.target;
 }
 return !frame.encounterPresent&&(!target.choiceId||!!choice);
}
export function eligibleSceneTargets(frame){
 if(!frame||!Array.isArray(frame.targets)||frame.targets.length>128||
    (frame.routes!==undefined&&(!Array.isArray(frame.routes)||frame.routes.length>64)))return [];
 const ids=new Set(),selected=[];
 for(const target of frame.targets){
  if(!target||!validText(target.id,160)||ids.has(target.id)||!priority.has(target.kind)||
     !validRect(target.rect)||(target.choiceId!==undefined&&target.choiceId!==''&&!validText(target.choiceId,160)))return [];
  ids.add(target.id);
  if(eligible(frame,target))selected.push(target);
 }
 return selected.sort((a,b)=>priority.get(a.kind)-priority.get(b.kind)||ordinal(a.id,b.id));
}
export function hitScene(frame,x,y){
 if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1||y<0||y>1)return null;
 return eligibleSceneTargets(frame).find(({kind,rect})=>kind!=='choice'&&x>=rect.x&&x<=rect.x+rect.width&&
  y>=rect.y&&y<=rect.y+rect.height)??null;
}
export function activateSceneTarget(frame,id){
 return eligibleSceneTargets(frame).find(target=>target.id===id)??null;
}
// The legacy collector checks node/sequence/encounter revision on release.
// Prototype callers can also pair that with this immutable input token.
export function sceneInputToken(frame){
 return frame&&validText(frame.node,160)&&Number.isSafeInteger(frame.sequence)&&frame.sequence>=0&&
  Number.isSafeInteger(frame.revision)&&frame.revision>=0
  ?JSON.stringify([frame.node,frame.sequence,frame.revision]):null;
}
export function readScenePointer(event,collector=globalThis.ngsAssemblyWeb){
 const point=collector?.release(event.clientX,event.clientY,event.pointerId);
 return Array.isArray(point)&&point.length===2&&point.every(Number.isFinite)?point:null;
}
