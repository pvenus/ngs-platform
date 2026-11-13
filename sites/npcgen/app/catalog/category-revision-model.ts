import {validateCategoryRevision} from '../../lib/category-revision-contract';
import {documentOf,object,rows,textValue,type Snapshot,type Proposal,type Json} from './adapter';
export type CategoryTarget={area:string;label:string;resource:string;selection:string;targetId:string;targetLabel:string;category:string;projectId:string;sourceRevision:string;contentHash:string;authorizationScope:string};
export function pinCategoryTarget(area:string,label:string,selected:string,snapshot:Snapshot,q:URLSearchParams):CategoryTarget|null{
 const doc=documentOf(snapshot,area);let resource=area,id=selected,selection=selected,targetLabel=label,category='';
 if(area==='concept'){const records=rows(doc.sections).sort((a,b)=>Number(a.priority)-Number(b.priority)),groups=rows(object(doc.hierarchy).groups),group=groups.find(g=>g.id===q.get('conceptGroup'))||groups.find(g=>Array.isArray(g.categoryIds)&&g.categoryIds.includes(selected));if(group&&Array.isArray(group.categoryIds)&&!group.categoryIds.length)return null;const available=group?records.filter(r=>Array.isArray(group.categoryIds)&&group.categoryIds.includes(String(r.id))):records,record=available.find(r=>r.id===selected)||available[0];id=String(record?.id||'');targetLabel=(group?textValue(group.title)+' › ':'')+textValue(record?.title);selection=id;}
 else if(area==='story'){const records=doc.storyId?[doc,...rows(doc.storylines)]:rows(doc.storylines),record=records.find(r=>(r.id||r.storyId)===selected)||records[0];id=String(record?.id||record?.storyId||'');targetLabel=textValue(record?.title);selection=id;}
 else if(area==='npcs'){const record=rows(doc.characters).find(r=>r.id===selected)||rows(doc.characters)[0];id=String(record?.id||'');targetLabel=textValue(record?.name);category=q.get('npcTab')||'portraits';if(category==='planning')category=q.get('npcCategoryNpc')===id?q.get('npcCategory')||'overview':'overview';selection=category==='traits'?'traits':category==='portraits'?'portraits':'planning';}
 else {const records=rows(doc.items),record=records.find(r=>r.resource===selected)||records[0];resource=String(record?.resource||selected||'');id=String(object(snapshot.documents[resource]).id||(resource.startsWith('knowledge.entry.')?resource.slice('knowledge.entry.'.length):record?.id)||resource);targetLabel=textValue(record?.title||label);selection='whole';}
 if(!id||!resource||!snapshot.authorizationScope)return null;
 return {area,label,resource,selection,targetId:id,targetLabel,category,projectId:snapshot.projectId,sourceRevision:snapshot.sourceRevision,contentHash:snapshot.contentHash,authorizationScope:snapshot.authorizationScope};
}
const immutable=new Set(['id','storyId','schemaVersion','projectId','sourcePath','__proto__','constructor','prototype']);
/** Pure review adapter. Caller supplies an independently reviewed, exact field map.
 * No model inference, storage, submission or authorization occurs here. */
export function compileReviewedCategory(target:CategoryTarget,requirements:string,whole:Json,changes:Record<string,Json>,idempotencyKey:string):Proposal{
 if(requirements.trim().length<5||requirements.length>4000)throw Error('CATEGORY_REQUIREMENTS_INVALID');
 if(!idempotencyKey||!Object.keys(changes).length)throw Error('REVIEWED_CHANGES_REQUIRED');
 if(Object.keys(changes).some(k=>immutable.has(k)))throw Error('FIELD_NOT_EDITABLE');
 if(target.area==='docs'||target.resource.startsWith('knowledge.category.'))throw Error('RESOURCE_NOT_EDITABLE');
 const cloned=JSON.parse(JSON.stringify(whole));let operation='document.update',payload:any;
 if(target.resource.startsWith('knowledge.entry.')){const allowed=new Set(['title','purpose','content','data','triggers','authority','status','maxReadChars']);if(cloned.id!==target.targetId||Object.keys(changes).some(k=>!allowed.has(k)))throw Error('TARGET_INVALID');operation='knowledge.update';payload={changes};}
 else {
  if(!['concept','story','npcs'].includes(target.resource))throw Error('RESOURCE_NOT_EDITABLE');
  const document=cloned.document??cloned,found:any[]=[];function walk(v:any){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if((v.id??v.storyId)===target.targetId)found.push(v);Object.values(v).forEach(walk);}}walk(document);
  if(found.length!==1)throw Error('TARGET_NOT_UNIQUE');const entity=found[0];
  if(target.area==='npcs'){const groups:Record<string,string[]>={overview:['summary','publicFace','actualTruth'],motivation:['desire','fear','values','belief'],expression:['behavior','voice'],relationships:['relationships'],continuity:['arc','stateKeys','openQuestions','sourceRefs'],basic:['name','kind','role','status','chapters'],traits:['traits','numericProfile'],judgment:['numericProfile']};const allowed=groups[target.category];if(!allowed||Object.keys(changes).some(k=>!allowed.includes(k)))throw Error('CATEGORY_SCOPE_MISMATCH');}
  if(Object.keys(changes).some(k=>!(k in entity)))throw Error('FIELD_NOT_EDITABLE');Object.assign(entity,JSON.parse(JSON.stringify(changes)));payload={document};
 }
 return {projectId:target.projectId,baseRevision:target.sourceRevision,baseHash:target.contentHash,operation,targetId:operation==='document.update'?target.resource:target.targetId,logicalResourceId:target.resource,payload:{...payload,note:requirements.trim().slice(0,210),categoryReview:{targetId:target.targetId,category:target.category,requirements}},idempotencyKey};
}

export function buildCategoryRevision(target:CategoryTarget,requirements:string,idempotencyKey:string):Proposal{const payload=validateCategoryRevision(target.resource,target.targetId,{schemaVersion:'npc-category-revision.v1',categoryId:target.category||target.targetId,categoryLabel:target.targetLabel,requirements,note:requirements.trim().slice(0,210)});return {projectId:target.projectId,baseRevision:target.sourceRevision,baseHash:target.contentHash,operation:'category.revision.request',targetId:target.targetId,logicalResourceId:target.resource,payload,idempotencyKey};}
