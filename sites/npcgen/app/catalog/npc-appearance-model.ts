import type {RecordData} from './adapter';
export type AppearanceAct={id:string;actId:string;title:string;chapters:{id:string;title:string;npcIds:string[]}[];npcIds:string[]};
export type Appearance={npcId:string;actId:string;chapterId?:string;scope:'act'|'chapter';source:'user-common'|'npc-chapters'|'story-link'};
const records=(v:unknown):RecordData[]=>Array.isArray(v)?v.filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[];
const strings=(v:unknown):string[]=>Array.isArray(v)?v.filter((x):x is string=>typeof x==='string'&&!!x):[];
/** A read-only view of appearance links. Never allocates or edits an NPC identity.
 * Legacy chapter IDs are resolved only inside the document's explicit act, or
 * when globally unambiguous. Listing every chapter never implies a common role.
 */
export function npcAppearances(story:RecordData,npcDocument:RecordData,npcs:RecordData[]){
 const archived=new Set(strings(story.archivedStoryIds));
 const acts:AppearanceAct[]=(story.storyId?[story,...records(story.storylines)]:records(story.storylines)).filter(a=>a.storyId&&!archived.has(String(a.storyId))).map(a=>{const hidden=new Set(strings(a.archivedChapterIds));return {id:String(a.storyId),actId:String(a.actId||''),title:String(a.title||a.storyId),npcIds:strings(a.npcIds),chapters:records(a.chapters).filter(c=>!hidden.has(String(c.id))).map(c=>({id:String(c.id),title:String(c.title||c.id),npcIds:strings(c.npcIds)}))};});
 const links:Appearance[]=[],unclassified=new Set<string>();
 for(const npc of npcs){
  const id=String(npc.id),explicitAct=String(npc.actId||npcDocument.actId||''),eligible=explicitAct?acts.filter(a=>a.actId===explicitAct||a.id===explicitAct):acts;
  let unresolved=false;
  for(const chapterId of strings(npc.chapters)){
   const matches=eligible.filter(a=>a.chapters.some(c=>c.id===chapterId));
   if(matches.length!==1){unresolved=true;continue;}
   links.push({npcId:id,actId:matches[0].id,chapterId,scope:'chapter',source:'npc-chapters'});
  }
  for(const act of acts)for(const chapter of act.chapters)if(chapter.npcIds.includes(id))links.push({npcId:id,actId:act.id,chapterId:chapter.id,scope:'chapter',source:'story-link'});
  // Explicit user instruction, keyed by stable identity, never by display name.
  if(id==='character.seojin')for(const act of acts)if(act.npcIds.includes(id)||links.some(l=>l.npcId===id&&l.actId===act.id))links.push({npcId:id,actId:act.id,scope:'act',source:'user-common'});
  if(unresolved||!links.some(l=>l.npcId===id))unclassified.add(id);
 }
 const common=new Set(links.filter(l=>l.scope==='act').map(l=>l.actId+'|'+l.npcId));
 const appearances=[...new Map(links.filter(l=>l.scope==='act'||!common.has(l.actId+'|'+l.npcId)).map(l=>[[l.npcId,l.actId,l.chapterId||''].join('|'),l])).values()];
 return {acts,appearances,unclassified};
}
export function scopeNpcs(model:ReturnType<typeof npcAppearances>,npcs:RecordData[],actId:string,chapterId:string){
 const commonIds=new Set(model.appearances.filter(l=>l.actId===actId&&l.scope==='act').map(l=>l.npcId));
 const chapterIds=new Set(model.appearances.filter(l=>l.actId===actId&&l.scope==='chapter'&&(chapterId==='all'||l.chapterId===chapterId)).map(l=>l.npcId));
 return {common:npcs.filter(n=>commonIds.has(String(n.id))),scoped:npcs.filter(n=>!commonIds.has(String(n.id))&&(chapterId==='unclassified'?model.unclassified.has(String(n.id)):chapterIds.has(String(n.id))))};
}
