import type {RecordData} from './adapter';
export type NpcRequestTarget={npcId:string;mode:'add'|'modify';categoryId:string;categoryLabel:string;tab:'planning'};
export function npcRequestTarget(npc:RecordData,mode:'add'|'modify',field:string,label:string):NpcRequestTarget{
 if(!npc.id||mode==='modify'&&!field)throw Error('NPC_REQUEST_TARGET_REQUIRED');
 return {npcId:String(npc.id),mode,categoryId:mode==='add'?'':field.startsWith('category.')?field.slice(9):field.startsWith('field:')?field:'field:'+field,categoryLabel:label,tab:'planning'};
}
export function openNpcCategoryRequest(target:NpcRequestTarget){const url=new URL(location.href);url.searchParams.set('npcIntakeTarget',JSON.stringify(target));history.replaceState(history.state,'',url);window.dispatchEvent(new CustomEvent('npc-category-intake-open',{detail:target}));}
