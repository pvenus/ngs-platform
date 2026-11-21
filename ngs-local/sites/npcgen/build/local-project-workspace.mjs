/** Read-only workspace DTOs over the private, already materialized MCP replica. */
import {createHash} from 'node:crypto';
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {validConceptGroupId} from './local-concept-category-contract.mjs';
import {validFolderPath} from './local-recursive-folders.mjs';

const error=(code,status)=>Object.assign(Error(code),{status});
const invalid=()=>error('PROJECT_WORKSPACE_INPUT_INVALID',400);
const unavailable=()=>error('PROJECT_WORKSPACE_REPLICA_UNAVAILABLE',503);
const missing=()=>error('PROJECT_WORKSPACE_ITEM_NOT_FOUND',404);
const tabs=new Set(['concept','npcs','motion-presets']);
const itemId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)&&validFolderPath(value);
const uid=process.getuid();
const jsonLimit=2*1024*1024, mediaLimit=8*1024*1024;
const own=st=>st.uid===uid&&!(st.mode&0o077);
const pin=s=>s&&[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const label=(value,fallback)=>typeof value==='string'&&value.trim()?value.trim().slice(0,160):fallback;
const select=(v,keys)=>Object.fromEntries(keys.filter(k=>Object.hasOwn(v,k)).map(k=>[k,v[k]]));
const pngHead=Buffer.from([137,80,78,71,13,10,26,10]);

function stat(path){
 try{return lstatSync(path,{bigint:true});}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function sameOwner(st){return own({uid:Number(st.uid),mode:Number(st.mode)});}
function safeDirectory(root,relative=''){
 let path=root;
 for(const part of ['',...(relative?relative.split('/'):[])]){
  if(part)path=join(path,part);
  const st=stat(path);
  if(!st)return null;
  if(!st.isDirectory()||!sameOwner(st)||realpathSync(path)!==path)throw unavailable();
 }
 return path;
}
function readBytes(root,relative,limit){
 const dir=safeDirectory(root,dirname(relative));
 if(!dir)return null;
 const path=join(root,relative),before=stat(path);
 if(!before)return null;
 if(!before.isFile()||!sameOwner(before)||before.nlink!==1n||before.size>BigInt(limit))throw unavailable();
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(pin(fstatSync(fd,{bigint:true}))!==pin(before))throw unavailable();
  const out=Buffer.alloc(Number(before.size));
  let count=0;
  while(count<out.length){
   const n=readInto(fd,out,count);
   if(!n)throw unavailable();
   count+=n;
  }
  if(pin(fstatSync(fd,{bigint:true}))!==pin(before)||safeDirectory(root,dirname(relative))!==dir
     ||pin(stat(path))!==pin(before))throw unavailable();
  return out;
 }finally{closeSync(fd);}
}
function readInto(fd,buffer,offset){return readSync(fd,buffer,offset,buffer.length-offset,offset);}
function readObject(root,relative){
 const bytes=readBytes(root,relative,jsonLimit);
 if(!bytes)return null;
 try{
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
 }catch{}
 throw unavailable();
}
function list(root,relative,wantDir){
 const path=safeDirectory(root,relative);
 if(!path)return [];
 const rows=readdirSync(path,{withFileTypes:true});
 if(safeDirectory(root,relative)!==path||rows.length>4096)throw unavailable();
 return rows.flatMap(row=>{
  const id=wantDir?row.name:row.name.endsWith('.json')?row.name.slice(0,-5):null;
  return itemId(id)&&(wantDir?row.isDirectory():row.isFile())?[id]:[];
 }).sort();
}
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
function findItems(root,tab,conceptIndex,conceptState,markdownIndex){
 const dirs=tab!=='motion-presets', parent=tab==='concept'?'concept/sections':dirs?'npcs':'motion-presets/presets';
 const index=tab==='concept'?conceptIndex:tab==='npcs'?readObject(root,tab+'/metadata.json'):null;
 // Only the local copy of the canonical Concept index defines visible categories.
 // A removed category's directory can still exist until scoped sync catches up.
 const ids=tab==='concept'?(index?.sectionIds??[]).filter(id=>!conceptState?.archived.has(id)):
  ordered(list(root,parent,dirs),index?.characterOrder);
 return ids.filter(id=>id!=='assets').flatMap(id=>{
  const path=parent+'/'+id+(dirs?'/metadata.json':'.json'),markdown=tab==='concept'?markdownIndex.get(id):null;
  const meta=markdown?{id,title:markdown.title,priority:markdown.priority}:readObject(root,path);
  const identity=tab==='motion-presets'?meta?.presetId:meta?.id;
  if(identity!==id)return [];
  const item={id,label:label(tab==='concept'?meta.title:tab==='npcs'?meta.name:meta.label,id),scope:dirs?'binari/'+parent+'/'+id:null};
  if(tab==='concept'&&conceptState?.active.has(id)){
   item.groupId=conceptState.active.get(id);
   if(typeof meta.title==='string'&&meta.title.trim()&&[...meta.title.trim()].length<=120)item.title=meta.title.trim();
  }
  return [{item,path,meta,markdown,folder:parent+'/'+id}];
 });
}
const conceptKeys=['id','title','description','priority','summary','fieldIds'];
const fieldKeys=['id','label','title','priority','status','summary','value'];
const npcKeys=['id','name','role','kind','chapters','status','summary','publicFace','actualTruth','arc',
 'behavior','belief','desire','fear','relationships','traits','values','voice','numericProfile','openQuestions'];
const planKeys=['id','name','content'];
const motionDirectionKeys=['n','ne','e','se','s','sw','w','nw'];
const metaRow=(path,label,body)=>({path,label,kind:'json',body});
function isHashMedia(path,extension){return typeof path==='string'&&path.length===64+extension.length&&
 /^[a-f0-9]{64}$/.test(path.slice(0,64))&&path.endsWith(extension);}
function publishedMedia(root,path){
 const target=safeDirectory(root,dirname(path));
 if(!target)return false;
 const st=stat(join(root,path));
 return Boolean(st?.isFile()&&sameOwner(st)&&st.nlink===1n&&st.size<=BigInt(mediaLimit));
}
function motionDirectionRows(root,meta){
 const entries=Array.isArray(meta.directions)?meta.directions.slice(0,8):[];
 return motionDirectionKeys.map(direction=>{
  const matches=entries.filter(row=>row?.direction===direction);
  const d=matches.length===1?matches[0]:null;
  const path=d&&isHashMedia(d.assetId,'.mp4')&&d.sha256===d.assetId.slice(0,64)?'motion-presets/assets/'+d.assetId:null;
  return {direction,path:path&&publishedMedia(root,path)?path:null};
 });
}
function visibleFiles(root,tab,{item,path,meta,markdown,folder}){
 const sub=folder+(tab==='concept'?'/fields':'/planning');
 const rows=[metaRow(path,item.label,select(meta,tab==='concept'?conceptKeys:npcKeys))];
 if(markdown){
  const documentPath=folder+'/content.md',bytes=readBytes(root,documentPath,1024*1024);
  if(!bytes||createHash('sha256').update(bytes).digest('hex')!==markdown.sha256)throw unavailable();
  let source;
  try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw unavailable();}
  return [{path:documentPath,label:'카테고리 본문',kind:'markdown',
   body:{markdown:markdown.mode==='structured'?structuredDisplay(source):source}}];
 }
 for(const id of ordered(list(root,sub,false),tab==='concept'?meta.fieldIds:meta.planningCategoryOrder)){
  const file=sub+'/'+id+'.json',doc=readObject(root,file);
  if(doc?.id===id)rows.push(metaRow(file,label(doc.label??doc.name??doc.title,id),select(doc,tab==='concept'?fieldKeys:planKeys)));
 }
 if(tab==='npcs'&&isHashMedia(meta.activePortraitId,'.png')&&Array.isArray(meta.portraits)&&
    meta.portraits.some(p=>p?.assetId===meta.activePortraitId)){
  for(const prefix of [folder+'/assets/','npcs/assets/']){
   const file=prefix+meta.activePortraitId;
   if(publishedMedia(root,file)){
    rows.push({path:file,label:'대표 포트레이트',kind:'image',sha:meta.activePortraitId.slice(0,64)});
    break;
   }
  }
 }
 return rows;
}
export function localProjectWorkspace({root,query,authorize}){
 const projectId=query.get('projectId'),tab=query.get('tab'),id=query.get('item'),file=query.get('file');
 const keys=[...query.keys()];
 if(keys.length!==new Set(keys).size||keys.some(k=>!['projectId','tab','item','file'].includes(k))
    ||!projectId||!tabs.has(tab)||id!==null&&!itemId(id)||file!==null&&(!id||!validFolderPath(file)))throw invalid();
 authorize(projectId);
 if(projectId!=='binari')throw missing();
 const project=safeDirectory(root,projectId),conceptIndex=project&&tab==='concept'?readObject(project,'concept/metadata.json'):null;
 if(conceptIndex&&(!Array.isArray(conceptIndex.sectionIds)||conceptIndex.sectionIds.some(id=>!itemId(id))||
    new Set(conceptIndex.sectionIds).size!==conceptIndex.sectionIds.length))throw unavailable();
 const conceptState=conceptHierarchy(conceptIndex);
 if(conceptIndex?.document?.hierarchy!==undefined&&!conceptState)throw unavailable();
 const markdownIndex=conceptMarkdownIndex(conceptIndex);
 const items=project?findItems(project,tab,conceptIndex,conceptState,markdownIndex):[];
 const common={projectId,tab,scope:projectId+'/'+tab,items:items.map(row=>row.item)};
 if(tab==='concept')common.groups=conceptState?.groups??[];
 if(id===null)return {json:common};
 const selection=items.find(row=>row.item.id===id);
 if(!selection)throw missing();
 const directions=tab==='motion-presets'?motionDirectionRows(project,selection.meta):null;
 const files=directions?directions.flatMap(({direction,path})=>path?
  [{path,label:direction.toUpperCase(),kind:'video',sha:path.slice(-68,-4)}]:[]):visibleFiles(project,tab,selection);
 if(file===null)return {json:{...common,item:selection.item,
  ...(directions?{motionPreset:{presetId:selection.item.id,label:selection.item.label,
   posePreset:['idle','combat'].includes(selection.meta.posePreset)?selection.meta.posePreset:null,directions}}:{}),
  files:files.map(({path,label,kind})=>({path,label,kind}))}};
 const row=files.find(r=>r.path===file);
 if(!row)throw missing();
 if(row.kind==='json'||row.kind==='markdown')return {json:row.body};
 const bytes=readBytes(project,row.path,mediaLimit);
 if(!bytes)throw missing();
 if(createHash('sha256').update(bytes).digest('hex')!==row.sha)throw unavailable();
 if(row.kind==='image'&&!bytes.subarray(0,8).equals(pngHead)
    ||row.kind==='video'&&bytes.subarray(4,8).toString()!=='ftyp')throw unavailable();
 return {bytes,mime:row.kind==='image'?'image/png':'video/mp4'};
}

// Same replica containment, ownership, size and stable-file checks for typed NPC records.
export const localWorkspaceReplica=Object.freeze({safeDirectory,readBytes,readObject,publishedMedia,mediaLimit,npcKeys:Object.freeze(npcKeys)});
