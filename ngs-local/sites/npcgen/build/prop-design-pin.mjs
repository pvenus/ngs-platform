/** Identical project-replica proof for Local and Space. No browser-supplied source paths. */
import {hashReplicaBytes} from './workspace-read-storage.mjs';
import {propSha} from './prop-workspace-contract.mjs';

const concept='concept/',master='expression',prop='category.add.26710502f5713d99018b77a29384d5da';
const visualFields=[['visualStyle','ngs.character-style-contract.v1'],['visualProhibitions','ngs.character-style-constraints.v1']];
const title='프랍 디자인 설계',headings=['형태와 식별','재료와 색','상태 사이의 일관성','납품과 검수'];
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const bounded=(s,max)=>typeof s==='string'&&s.isWellFormed()&&s.trim().length>0&&encoder.encode(s).length<=max&&
 !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u.test(s);
const shaText=s=>hashReplicaBytes(encoder.encode(s));
const jsonHash=v=>shaText(JSON.stringify(v));
const need=v=>{if(!v)throw Error('PROP_DESIGN_REPLICA_INVALID');};
const eq=(v,w)=>JSON.stringify(v)===JSON.stringify(w);
const record=v=>v&&typeof v==='object'&&!Array.isArray(v);

export async function propDesignPin(openProject,projectId){
 try{
  const src=await openProject(projectId);
  need(projectId==='binari'&&src);
  const signatures=new Map();
  async function read(path,max){
   const raw=await src.readBytes(concept+path,max);
   need(raw instanceof Uint8Array&&raw.length>0&&raw.length<=max);
   const hash=await hashReplicaBytes(raw);
   signatures.set(path,{hash,max});
   return {text:decoder.decode(raw),hash};
  }
  const readJSON=async(path,max=2*1024*1024)=>JSON.parse((await read(path,max)).text);
  const index=await readJSON('metadata.json'),h=index.document?.hierarchy;
  const groups=h?.groups,ids=index.sectionIds,archived=h?.archivedCategoryIds??[],archivedItems=h?.archivedItems??[];
  need(Array.isArray(groups)&&Array.isArray(ids)&&Array.isArray(archived)&&Array.isArray(archivedItems)&&groups.every(g=>Array.isArray(g?.categoryIds)));
  const art=groups.filter(g=>g.id==='group.art-design');
  need(art.length===1);
  for(const id of [master,prop])
   need(ids.filter(x=>x===id).length===1&&!archived.includes(id)&&art[0].categoryIds.includes(id)&&
    groups.flatMap(g=>g.categoryIds).filter(x=>x===id).length===1);
  const markers=index._markdownSections??{};
  const propMarker=markers[prop];
  need(record(markers)&&propMarker?.mode==='authored'&&propMarker.title===title&&propSha(propMarker.sha256));
  const propBytes=await read('sections/'+prop+'/content.md',24000);
  need(propBytes.hash===propMarker.sha256&&bounded(propBytes.text,24000)&&
   propBytes.text.split(/\r?\n/u)[0]==='# '+title&&
   eq([...propBytes.text.matchAll(/^## (.+)$/gmu)].map(m=>m[1]),headings));

  let fields;
  const base='sections/'+master+'/';
  if(Object.hasOwn(markers,master)){
   const marker=markers[master];
   need(marker?.mode==='structured'&&propSha(marker.sha256));
   const raw=await read(base+'content.md',1024*1024);
   need(raw.hash===marker.sha256);
   // Mirrors Filex concept_markdown.parse (structured migration, not authored Markdown).
   const meta=/^<!-- ngs\/category:(\{[^\n]*\}) -->\n/u.exec(raw.text);
   need(meta);
   const category=JSON.parse(meta[1]);
   need(category.id===master&&category.title===marker.title);
   const rows=[...raw.text.slice(meta[0].length).matchAll(/^<!-- ngs\/field:(\{[^\n]*\}) -->\n(#+ [^\n]*\n)?(`{3,})text\n([\s\S]*?)\n\3\n/gmu)]
    .map(match=>({...JSON.parse(match[1]),value:match[4]}));
   need(eq(rows.map(x=>x.id),category.fieldIds));
   fields=rows;
  }else{
   const metadata=await readJSON(base+'metadata.json');
   need(metadata.id===master&&Array.isArray(metadata.fieldIds));
   fields=await Promise.all(visualFields.map(async ([id])=>{
    need(metadata.fieldIds.filter(x=>x===id).length===1);
    const r=await readJSON(base+'fields/'+id+'.json',64*1024);
    need(r.id===id);return r;
   }));
  }
  const masterParts=[];
  for(const [id,schema] of visualFields){
   const selected=fields.filter(x=>x.id===id);
   need(selected.length===1&&!archivedItems.some(x=>x?.categoryId===master&&x?.itemId===id));
   const text=selected[0].value;
   need(bounded(text,12000)&&JSON.parse(text)?.schemaVersion===schema);
   masterParts.push({id,sha256:await shaText(text),text});
  }
  // Replica sync commits one file at a time; never combine a mixed revision.
  // Check project membership/index last after re-verifying both source payloads.
  for(const [path,{hash,max}] of [...signatures].sort(([a],[b])=>
   Number(a==='metadata.json')-Number(b==='metadata.json'))){
   const meta=typeof src.head==='function'?await src.head(concept+path):null;
   if(meta?.sha256!==undefined)need(meta.sha256===hash);
   else {
    const raw=await src.readBytes(concept+path,max);
    need(raw instanceof Uint8Array&&await hashReplicaBytes(raw)===hash);
   }
  }
  // Python Filex digest canonicalizes keys; id, sha256, text above are in that order.
  return {designContextSha256:await jsonHash([['master-design',master,await jsonHash(masterParts)],['prop-design',prop,propBytes.hash]])};
 }catch{
  throw Object.assign(Error('PROP_DESIGN_REPLICA_UNAVAILABLE'),{status:503});
 }
}
