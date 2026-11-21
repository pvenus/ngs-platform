import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,
 readdirSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';

const filenames=['project.json','icon.png'];
const freshness=60_000;
const pdsGroupLimit=64;
const fileLimit={'project.json':64*1024,'icon.png':2*1024*1024};
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const hashPattern=/^[a-f0-9]{64}$/;
const png=Buffer.from([137,80,78,71,13,10,26,10]);
const uid=()=>process.getuid();
const unavailable=()=>Error('PROJECT_FOLDERS_UNAVAILABLE');
export const validProjectId=id=>typeof id==='string'&&id===id.trim()&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id);

function exists(path){
 try{return lstatSync(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}
}
function directory(path,create=false){
 if(create&&!exists(path)){
  if(realpathSync(dirname(path))!==dirname(path))throw unavailable();
  try{mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 const st=exists(path);
 if(!st)return null;
 if(!st.isDirectory()||st.uid!==uid()||(st.mode&0o077)||realpathSync(path)!==path)throw unavailable();
 return path;
}
function read(path){
 let fd;
 try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
 catch(e){if(e.code==='ENOENT')return null;throw e;}
 try{
  const st=fstatSync(fd);
  if(!st.isFile()||st.uid!==uid()||(st.mode&0o077))throw unavailable();
  return readFileSync(fd);
 }finally{closeSync(fd);}
}
function replace(dir,name,bytes){
 directory(dir);
 // Do not silently write through, or overwrite, an externally placed link.
 read(join(dir,name));
 const temp=join(dir,'.project-folder-'+randomUUID());
 const fd=openSync(temp,'wx',0o600);
 try{
  try{writeFileSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,join(dir,name));
 }finally{
  try{unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}
 }
}
export function validateProjectFolderFile(name,bytes){
 if(bytes.length>fileLimit[name])throw unavailable();
 if(name==='icon.png'){
  if(!bytes.subarray(0,8).equals(png))throw unavailable();
  return;
 }
 let body;
 try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw unavailable();}
 if(!body||typeof body!=='object'||Array.isArray(body))throw unavailable();
 return body;
}

// Call only the dedicated endpoints on the existing local PDS service origin.
export function projectFolderPDS(origin='http://127.0.0.1:8030'){
 const base=new URL(origin);
 if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port||origin!==base.origin)throw unavailable();
 async function fetchFile(path,{body,limit}={}){
  const response=await fetch(base.origin+path,{method:body?'POST':'GET',redirect:'error',
   headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,
   signal:AbortSignal.timeout(15_000)});
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw unavailable();}
  if(!limit)return response.json();
  const reader=response.body?.getReader();
  if(!reader)throw unavailable();
  const chunks=[];
  let length=0;
  while(true){
   const {value,done}=await reader.read();
   if(done)break;
   length+=value.byteLength;
   if(length>limit){await reader.cancel().catch(()=>{});throw unavailable();}
   chunks.push(value);
  }
  return Buffer.concat(chunks,length);
 }
 return {
  discover:()=>fetchFile('/v1/project-folders'),
  compare:groups=>fetchFile('/v1/project-folders/compare',{body:{groups}}),
  download:(id,name,hash)=>fetchFile('/v1/project-folders/'+encodeURIComponent(id)+'/files/'+name+'?sha256='+hash,{limit:fileLimit[name]}),
 };
}

export function createLocalProjectFolders({
 root=join(homedir(),'Workspaces','NGS','data','project-catalog'),pds=projectFolderPDS(),now=Date.now,diskFreshness=true,
}={}){
 root=resolve(root);
 const comparisons=new Map(),plans=new Map(),refreshes=new Map();
 let discovered,discovery;
 const folder=(id,create=false)=>{
  if(!validProjectId(id))throw unavailable();
  return directory(root,create)?directory(join(root,id),create):null;
 };
 const fresh=at=>Number.isFinite(at)&&at>=0&&at<=now()&&now()-at<freshness;
 const refreshedAt=dir=>{
  const raw=dir&&read(join(dir,'.last-refresh'));
  return raw&&/^[0-9]+$/.test(raw.toString())?Number(raw):NaN;
 };
 function summary(projectId,dir){
  const bytes=dir&&read(join(dir,'project.json'));
  if(!bytes)return null;
  const data=validateProjectFolderFile('project.json',bytes);
  const name=[data.name,data.displayName,data.title].find(v=>typeof v==='string'&&v.trim())?.trim()??projectId;
  const icon=read(join(dir,'icon.png'));
  if(icon)validateProjectFolderFile('icon.png',icon);
  const iconUrl=icon?'/api/project-folders/icon?'+new URLSearchParams({projectId,sha256:sha256(icon)}):null;
  return {projectId,name,iconUrl,needsRefresh:(!diskFreshness||!fresh(refreshedAt(dir)))};
 }
 function list(allowed){
  if(!directory(root))return [];
  return readdirSync(root).filter(id=>validProjectId(id)&&allowed(id)).sort()
   .map(id=>summary(id,folder(id))).filter(Boolean);
 }
 function icon(projectId,hash){
  const dir=folder(projectId),bytes=dir&&read(join(dir,'icon.png'));
  if(!bytes||sha256(bytes)!==hash)return null;
  validateProjectFolderFile('icon.png',bytes);
  return bytes;
 }
 function discover(){
  if(discovered&&fresh(discovered.at))return Promise.resolve(discovered.ids);
  if(discovery)return discovery;
  discovery=(async()=>{
   const response=await pds.discover(),ids=response?.projects;
   if(!Array.isArray(ids)||ids.some(id=>!validProjectId(id))||new Set(ids).size!==ids.length)throw unavailable();
   discovered={at:now(),ids:Object.freeze([...ids].sort())};
   return discovered.ids;
  })().finally(()=>{discovery=undefined;});
  return discovery;
 }
 function localHashes(projectId){
  const dir=folder(projectId),local=new Map();
  if(dir)for(const name of filenames){
   const bytes=read(join(dir,name));
   if(bytes)local.set(name,sha256(bytes));
  }
  return local;
 }
 const expirePlans=()=>{for(const [id,plan] of plans)if(!fresh(plan.at))plans.delete(id);};
 function validateComparison(answer,requested){
  if(!answer||Object.keys(answer).sort().join(',')!=='groups,unavailable'
      ||!Array.isArray(answer.groups)||!Array.isArray(answer.unavailable))throw unavailable();
  const unsynced=new Set(),changed=new Map();
  for(const id of answer.unavailable){
   if(!requested.has(id)||unsynced.has(id))throw unavailable();
   unsynced.add(id);
  }
  for(const group of answer.groups){
   const id=group?.projectId;
   if(!group||Object.keys(group).sort().join(',')!=='files,projectId'
      ||!requested.has(id)||changed.has(id)||unsynced.has(id)
      ||!Array.isArray(group.files)||group.files.length===0||group.files.length>filenames.length)throw unavailable();
   const files=new Map(),local=requested.get(id);
   for(const row of group.files){
    if(!row||Object.keys(row).sort().join(',')!=='name,sha256'||!filenames.includes(row.name)
     ||typeof row.sha256!=='string'||row.sha256.length!==64||!hashPattern.test(row.sha256)
     ||files.has(row.name)||local.get(row.name)===row.sha256)throw unavailable();
    files.set(row.name,row.sha256);
   }
   changed.set(id,filenames.filter(name=>files.has(name)).map(name=>({name,sha256:files.get(name)})));
  }
  return {changed,unsynced};
 }
 async function compareWithPDS(requested){
  let review;
  try{
   const groups=[...requested].map(([projectId,local])=>({projectId,files:[...local].map(([name,sha256])=>({name,sha256}))}));
   review=validateComparison(await pds.compare(groups),requested);
  }catch{return new Map([...requested.keys()].map(id=>[id,{state:'unavailable'}]));}
  const at=Math.floor(now()),results=new Map();
  for(const [id,local] of requested){
   if(review.unsynced.has(id)){results.set(id,{state:'unavailable'});continue;}
   try{
    const current=localHashes(id);
    if(filenames.some(name=>current.get(name)!==local.get(name)))throw unavailable();
    const files=review.changed.get(id);
    if(files){
     plans.set(id,{at,files,local});
     results.set(id,{state:'changed',files});
    }else{
     if(!local.has('project.json'))throw unavailable();
     replace(folder(id),'.last-refresh',Buffer.from(String(at)));
     results.set(id,{state:'unchanged'});
    }
   }catch{results.set(id,{state:'unavailable'});}
  }
  return results;
 }
 async function compare(projectIds){
  expirePlans();
  const pending=new Map(),requested=new Map();
  for(const projectId of projectIds){
   const plan=plans.get(projectId);
   if(comparisons.has(projectId)){pending.set(projectId,comparisons.get(projectId));continue;}
   if(plan){pending.set(projectId,{state:'changed',files:plan.files});continue;}
   try{
    if(!fresh(refreshedAt(folder(projectId))))requested.set(projectId,localHashes(projectId));
   }catch{pending.set(projectId,{state:'unavailable'});}
  }
  const entries=[...requested];
  for(let index=0;index<entries.length;index+=pdsGroupLimit){
   const chunk=new Map(entries.slice(index,index+pdsGroupLimit));
   const batch=compareWithPDS(chunk);
   for(const id of chunk.keys()){
    const result=batch.then(results=>results.get(id)).finally(()=>comparisons.delete(id));
    comparisons.set(id,result);
    pending.set(id,result);
   }
  }
  const result={groups:[],unavailable:[]};
  for(const projectId of projectIds){
   const row=await pending.get(projectId);
   if(row?.state==='changed')result.groups.push({projectId,files:row.files});
   if(row?.state==='unavailable')result.unavailable.push(projectId);
  }
  return result;
 }
 function refresh(projectId){
  if(refreshes.has(projectId))return refreshes.get(projectId);
  expirePlans();
  const run=(async()=>{
   let dir=folder(projectId);
   if(fresh(refreshedAt(dir)))return {projectId,status:'cached',project:summary(projectId,dir)};
   const plan=plans.get(projectId);
   if(!plan)throw Error('PROJECT_FOLDER_COMPARE_REQUIRED');
   try{
    const downloads=new Map();
    for(const {name,sha256:hash} of plan.files){
     const bytes=await pds.download(projectId,name,hash);
     if(!Buffer.isBuffer(bytes)||sha256(bytes)!==hash)throw unavailable();
     validateProjectFolderFile(name,bytes);
     downloads.set(name,bytes);
    }
    // Verify the whole group before any replacement; a stale local or remote hash is not re-used.
    dir=folder(projectId);
    if(!fresh(plan.at))throw Error('PROJECT_FOLDER_COMPARE_REQUIRED');
    for(const name of filenames){
     const current=dir&&read(join(dir,name));
     if((current?sha256(current):undefined)!==plan.local.get(name))throw Error('PROJECT_FOLDER_COMPARE_REQUIRED');
     const expected=downloads.get(name)??current;
     if(expected)validateProjectFolderFile(name,expected);
    }
    dir=folder(projectId,true);
    for(const [name,bytes] of downloads)replace(dir,name,bytes);
    replace(dir,'.last-refresh',Buffer.from(String(Math.floor(now()))));
    return {projectId,status:'refreshed',project:summary(projectId,dir)};
   }finally{if(plans.get(projectId)===plan)plans.delete(projectId);}
  })().finally(()=>refreshes.delete(projectId));
  refreshes.set(projectId,run);
  return run;
 }
 return {list,discover,compare,refresh,icon};
}
