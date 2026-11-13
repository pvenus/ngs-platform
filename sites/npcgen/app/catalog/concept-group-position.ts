import type {ConceptGroup} from '../../lib/concept-hierarchy';
/** Boundary index matches backend remove-then-insert displayOrder exactly. */
export function groupPositionOptions(groups:ConceptGroup[],mode:'add'|'update',targetId?:string){
 const current=groups.findIndex(group=>group.id===targetId),others=mode==='update'?groups.filter(group=>group.id!==targetId):groups;
 if(mode==='update'&&current<0)return [];
 return Array.from({length:others.length+1},(_,displayOrder)=>{
  const before=others[displayOrder],after=others[displayOrder-1],verb=mode==='add'?'추가':'이동';
  let label=!others.length?'첫 그룹으로 추가':displayOrder===0?`맨 앞 · ${before.title} 앞에 ${verb}`:displayOrder===others.length?`맨 뒤 · ${after.title} 뒤에 ${verb}`:`${after.title} 뒤 · ${before.title} 앞에 ${verb}`;
  if(mode==='update'&&displayOrder===current)label=`현재 위치 · ${after?after.title+' 뒤':'맨 앞'}${before?' / '+before.title+' 앞':' / 맨 뒤'} (변경 없음)`;
  return {displayOrder,label};
 });
}
export function previewGroupOrder(groups:ConceptGroup[],mode:'add'|'update',targetId:string|undefined,title:string,displayOrder:number){
 const others=groups.filter(group=>mode==='add'||group.id!==targetId).map(group=>({id:group.id,title:group.title,target:false}));
 if(!Number.isInteger(displayOrder)||displayOrder<0||displayOrder>others.length||mode==='update'&&!groups.some(group=>group.id===targetId))return [];
 others.splice(displayOrder,0,{id:mode==='add'?'preview.new':targetId!,title:title.trim()||(mode==='add'?'새 그룹':'선택 그룹'),target:true});return others;
}
export type GroupPositionIntent={expectedRevision:string;placement:'start'|'end'|'before'|'after';anchorGroupId?:string};
export function groupPositionIntent(groups:ConceptGroup[],mode:'add'|'update',targetId:string|undefined,displayOrder:number,expectedRevision:string):GroupPositionIntent{
 const others=groups.filter(group=>mode==='add'||group.id!==targetId);
 if(mode==='update'&&!groups.some(group=>group.id===targetId))throw Error('GROUP_NOT_FOUND');
 if(!Number.isInteger(displayOrder)||displayOrder<0||displayOrder>others.length)throw Error('GROUP_ORDER_INVALID');
 return displayOrder===0?{expectedRevision,placement:'start'}:displayOrder===others.length?{expectedRevision,placement:'end'}:{expectedRevision,placement:'before',anchorGroupId:others[displayOrder].id};
}
/** Compatibility bridge: canonical API accepts displayOrder and baseRevision only. */
export function resolveGroupPosition(groups:ConceptGroup[],mode:'add'|'update',targetId:string|undefined,intent:GroupPositionIntent,currentRevision:string){
 if(intent.expectedRevision!==currentRevision)throw Error('BASE_REVISION_CONFLICT');
 if(mode==='update'&&!groups.some(group=>group.id===targetId))throw Error('GROUP_NOT_FOUND');
 if(mode==='update'&&intent.anchorGroupId===targetId&&targetId)throw Error('GROUP_POSITION_SELF_REFERENCE');
 const others=groups.filter(group=>mode==='add'||group.id!==targetId);
 if(intent.placement==='start')return 0;if(intent.placement==='end')return others.length;
 const at=others.findIndex(group=>group.id===intent.anchorGroupId);if(at<0)throw Error('GROUP_POSITION_ANCHOR_MISSING');
 return at+(intent.placement==='after'?1:0);
}
