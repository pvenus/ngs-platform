/** Portable project workspace DTOs. The selected store is injected by the frontend. */
import {validConceptGroupId} from './local-concept-category-contract.mjs';
import {validWorkspacePath,workspaceItemId as itemId,workspaceItemIds,readReplicaObject,hashReplicaBytes,replicaUnavailable as unavailable} from './workspace-read-storage.mjs';

const error=(code,status)=>Object.assign(Error(code),{status});
const invalid=()=>error('PROJECT_WORKSPACE_INPUT_INVALID',400);
const missing=()=>error('PROJECT_WORKSPACE_ITEM_NOT_FOUND',404);
export const workspaceTabs=Object.freeze(['concept','npcs','motion-presets']);
const tabs=new Set(workspaceTabs);
export const workspaceMediaLimit=8*1024*1024;
const mediaLimit=workspaceMediaLimit;
const label=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim().slice(0,160):fallback;
const select=(v,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]]));
const pngHead=new Uint8Array([137,80,78,71,13,10,26,10]);

function ordered(ids,order){
 const distinct=new Set(ids);
 return [...(Array.isArray(order)?order.filter(id=>distinct.delete(id)):[]),...distinct];
}
function conceptHierarchy(index){
 const hierarchy=index?.document?.hierarchy;
 if(hierarchy?.schemaVersion!=='npc-concept-groups.v1'||!Array.isArray(hierarchy.groups)||!hierarchy.groups.length||
    hierarchy.groups.length>100||!Array.isArray(index.sectionIds)||index.sectionIds.some(id=>!itemId(id))||
    new Set(index.sectionIds).size!==index.sectionIds.length)return null;
 const seen=new Set(),categories=new Set(index.sectionIds),active=new Map();
 const archive=hierarchy.archivedCategoryIds??[];
 if(!Array.isArray(archive)||archive.some(id=>!categories.has(id))||new Set(archive).size!==archive.length)return null;
 const archived=new Set(archive),groups=[];
 for(const group of hierarchy.groups){
  if(!group||!validConceptGroupId(group.id)||seen.has(group.id)||typeof group.title!=='string'||
     !group.title.trim()||[...group.title].length>100||!Array.isArray(group.categoryIds))return null;
  seen.add(group.id);groups.push({id:group.id,title:group.title});
  for(const id of group.categoryIds){
   if(!categories.has(id)||active.has(id)||archived.has(id))return null;
   active.set(id,group.id);
  }
 }
 if(active.size+archived.size!==categories.size)return null;
 return {groups,active,archived};
}
function conceptMarkdownIndex(index){
 const value=index?._markdownSections;
 if(value===undefined)return new Map();
 if(!value||typeof value!=='object'||Array.isArray(value)||!Array.isArray(index.sectionIds))throw unavailable();
 const ids=new Set(index.sectionIds),result=new Map();
 for(const [id,row] of Object.entries(value)){
  if(!itemId(id)||!ids.has(id)||!row||typeof row!=='object'||Array.isArray(row)||
     Object.keys(row).sort().join(',')!=='mode,priority,sha256,title'||
     !['structured','authored'].includes(row.mode)||!Number.isSafeInteger(row.priority)||
     typeof row.sha256!=='string'||!/^[a-f0-9]{64}$/.test(row.sha256)||
     typeof row.title!=='string'||!row.title.trim())throw unavailable();
  result.set(id,row);
 }
 return result;
}
function structuredDisplay(source){
 let fence=0;
 return source.split('\n').filter(line=>{
  if(fence){
   const end=/^ {0,3}(`{3,})\s*$/.exec(line);
   if(end&&end[1].length>=fence)fence=0;
   return true;
  }
  const begin=/^ {0,3}(`{3,})[^`]*$/.exec(line);
  if(begin)fence=begin[1].length;
  // These metadata markers belong to the migration format, not the displayed planning text.
  return !/^<!-- ngs\/(category|field):\{.*\} -->$/.test(line);
 }).join('\n');
}
async function findItems(root,tab,conceptIndex,conceptState,markdownIndex){
 const dirs=tab!=='motion-presets', parent=tab==='concept'?'concept/sections':dirs?'npcs':'motion-presets/presets';
 const index=tab==='concept'?conceptIndex:tab==='npcs'?await readReplicaObject(root,tab+'/metadata.json'):null;
 // Only the published canonical Concept index defines visible categories.
 // A removed category's directory can still exist until scoped sync catches up.
 const ids=tab==='concept'?(index?.sectionIds??[]).filter(id=>!conceptState?.archived.has(id)):
  ordered(await workspaceItemIds(root,parent,dirs),index?.characterOrder);
 const rows=[];
 for(const id of ids){
  if(id==='assets')continue;
  const path=parent+'/'+id+(dirs?'/metadata.json':'.json'),markdown=tab==='concept'?markdownIndex.get(id):null;
  const meta=markdown?{id,title:markdown.title,priority:markdown.priority}:await readReplicaObject(root,path);
  const identity=tab==='motion-presets'?meta?.presetId:meta?.id;
  if(identity!==id)continue;
  const item={id,label:label(tab==='concept'?meta.title:tab==='npcs'?meta.name:meta.label,id),scope:dirs?'binari/'+parent+'/'+id:null};
  if(tab==='concept'&&conceptState?.active.has(id)){
   item.groupId=conceptState.active.get(id);
   if(typeof meta.title==='string'&&meta.title.trim()&&[...meta.title.trim()].length<=120)item.title=meta.title.trim();
  }
  rows.push({item,path,meta,markdown,folder:parent+'/'+id});
 }
 return rows;
}
const conceptKeys=['id','title','description','priority','summary','fieldIds'];
const fieldKeys=['id','label','title','priority','status','summary','value'];
export const npcKeys=Object.freeze(['id','name','role','kind','chapters','status','summary','publicFace','actualTruth','arc',
 'behavior','belief','desire','fear','relationships','traits','values','voice','numericProfile','openQuestions']);
const planKeys=['id','name','content'];
const motionDirectionKeys=['n','ne','e','se','s','sw','w','nw'];
const metaRow=(path,label,body)=>({path,label,kind:'json',body});
function isHashMedia(path,extension){return typeof path==='string'&&path.length===64+extension.length&&
 /^[a-f0-9]{64}$/.test(path.slice(0,64))&&path.endsWith(extension);}
async function publishedMedia(project,path){
 const result=await project.head(path);
 return !!result&&Number.isSafeInteger(result.size)&&result.size>=0&&result.size<=mediaLimit;
}
async function motionDirectionRows(root,meta){
 const entries=Array.isArray(meta.directions)?meta.directions.slice(0,8):[];
 return Promise.all(motionDirectionKeys.map(async direction=>{
  const matches=entries.filter(row=>row?.direction===direction);
  const d=matches.length===1?matches[0]:null;
  const path=d&&isHashMedia(d.assetId,'.mp4')&&d.sha256===d.assetId.slice(0,64)?'motion-presets/assets/'+d.assetId:null;
  return {direction,path:path&&await publishedMedia(root,path)?path:null};
 }));
}
async function visibleFiles(root,tab,{item,path,meta,markdown,folder}){
 const sub=folder+(tab==='concept'?'/fields':'/planning');
 const rows=[metaRow(path,item.label,select(meta,tab==='concept'?conceptKeys:npcKeys))];
 if(markdown){
  const documentPath=folder+'/content.md',bytes=await root.readBytes(documentPath,1024*1024);
  if(!bytes||await hashReplicaBytes(bytes)!==markdown.sha256)throw unavailable();
  let source;
  try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw unavailable();}
  return [{path:documentPath,label:'카테고리 본문',kind:'markdown',
   body:{markdown:markdown.mode==='structured'?structuredDisplay(source):source}}];
 }
 for(const id of ordered(await workspaceItemIds(root,sub,false),tab==='concept'?meta.fieldIds:meta.planningCategoryOrder)){
  const file=sub+'/'+id+'.json',doc=await readReplicaObject(root,file);
  if(doc?.id===id)rows.push(metaRow(file,label(doc.label??doc.name??doc.title,id),select(doc,tab==='concept'?fieldKeys:planKeys)));
 }
 if(tab==='npcs'&&isHashMedia(meta.activePortraitId,'.png')&&Array.isArray(meta.portraits)&&
    meta.portraits.some(p=>p?.assetId===meta.activePortraitId)){
  for(const prefix of [folder+'/assets/','npcs/assets/']){
   const file=prefix+meta.activePortraitId;
   if(await publishedMedia(root,file)){
    rows.push({path:file,label:'대표 포트레이트',kind:'image',sha:meta.activePortraitId.slice(0,64)});
    break;
   }
  }
 }
 return rows;
}
export async function workspaceRead({openProject,query,authorize}){
 const projectId=query.get('projectId'),tab=query.get('tab'),id=query.get('item'),file=query.get('file');
 const keys=[...query.keys()];
 if(keys.length!==new Set(keys).size||keys.some(k=>!['projectId','tab','item','file'].includes(k))
    ||!projectId||!tabs.has(tab)||id!==null&&!itemId(id)||file!==null&&(!id||!validWorkspacePath(file)))throw invalid();
 await authorize(projectId);
 if(projectId!=='binari')throw missing();
 const project=await openProject(projectId),conceptIndex=project&&tab==='concept'?await readReplicaObject(project,'concept/metadata.json'):null;
 if(conceptIndex&&(!Array.isArray(conceptIndex.sectionIds)||conceptIndex.sectionIds.some(id=>!itemId(id))||
    new Set(conceptIndex.sectionIds).size!==conceptIndex.sectionIds.length))throw unavailable();
 const conceptState=conceptHierarchy(conceptIndex);
 if(conceptIndex?.document?.hierarchy!==undefined&&!conceptState)throw unavailable();
 const markdownIndex=conceptMarkdownIndex(conceptIndex);
 const items=project?await findItems(project,tab,conceptIndex,conceptState,markdownIndex):[];
 const common={projectId,tab,scope:projectId+'/'+tab,items:items.map(row=>row.item)};
 if(tab==='concept')common.groups=conceptState?.groups??[];
 if(id===null)return {json:common};
 const selection=items.find(row=>row.item.id===id);
 if(!selection)throw missing();
 const directions=tab==='motion-presets'?await motionDirectionRows(project,selection.meta):null;
 const files=directions?directions.flatMap(({direction,path})=>path?
  [{path,label:direction.toUpperCase(),kind:'video',sha:path.slice(-68,-4)}]:[]):await visibleFiles(project,tab,selection);
 if(file===null)return {json:{...common,item:selection.item,
  ...(directions?{motionPreset:{presetId:selection.item.id,label:selection.item.label,
   posePreset:['idle','combat'].includes(selection.meta.posePreset)?selection.meta.posePreset:null,directions}}:{}),
  files:files.map(({path,label,kind})=>({path,label,kind}))}};
 const row=files.find(r=>r.path===file);
 if(!row)throw missing();
 if(row.kind==='json'||row.kind==='markdown')return {json:row.body};
 const bytes=await project.readBytes(row.path,mediaLimit);
 if(!bytes)throw missing();
 if(await hashReplicaBytes(bytes)!==row.sha)throw unavailable();
 if(row.kind==='image'&&(bytes.length<8||!pngHead.every((v,i)=>bytes[i]===v))
    ||row.kind==='video'&&new TextDecoder().decode(bytes.subarray(4,8))!=='ftyp')throw unavailable();
 return {bytes,mime:row.kind==='image'?'image/png':'video/mp4'};
}
