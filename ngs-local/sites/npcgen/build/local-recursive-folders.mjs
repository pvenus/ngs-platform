/** Local PDS replica. File contents stream; the comparison retains only path/size/hash metadata. */
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,createReadStream,createWriteStream,fstatSync,lstatSync,mkdirSync,mkdtempSync,
 openSync,readFileSync,readdirSync,realpathSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {validateProjectFolderFile} from './local-project-folders.mjs';

const minute=60_000;
const maxFile=64*1024*1024,maxEntries=32768;
const sha=/^[a-f0-9]{64}$/;
const invalid=()=>Error('FOLDER_SYNC_UNAVAILABLE');
const stale=()=>Error('FOLDER_SYNC_COMPARE_REQUIRED');
const validHash=value=>typeof value==='string'&&value.length===64&&sha.test(value);
export const validFolderPath=value=>typeof value==='string'&&Buffer.byteLength(value)<=4096
 &&value.split('/').length<=64&&value.split('/').every(part=>part.length&&Buffer.byteLength(part)<=255
  &&!part.startsWith('.')&&!/[\\\x00-\x1f\x7f]/.test(part)&&Buffer.from(part).toString()===part);

function stat(path){
 try{return lstatSync(path,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
const pin=s=>s&&[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
function checkedDir(path,create){
 if(create&&!stat(path)){
  if(realpathSync(dirname(path))!==dirname(path))throw invalid();
  try{mkdirSync(path,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 }
 const s=stat(path);
 if(!s)return null;
 if(!s.isDirectory()||Number(s.uid)!==process.getuid()||Boolean(s.mode&0o077n)||realpathSync(path)!==path)throw invalid();
 return path;
}
function directory(root,relative='',create=false){
 let cursor=checkedDir(root,create);
 for(const component of relative?relative.split('/'):[]){
  if(!cursor)return null;
  cursor=checkedDir(join(cursor,component),create);
 }
 return cursor;
}
function checkedFile(path){
 const info=stat(path);
 if(!info)return null;
 if(!info.isFile()||Number(info.uid)!==process.getuid()||Boolean(info.mode&0o077n)||info.nlink!==1n
    ||info.size>BigInt(maxFile))throw invalid();
 return info;
}

async function digest(path){
 const info=checkedFile(path);
 if(!info)return null;
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  if(pin(fstatSync(fd,{bigint:true}))!==pin(info))throw invalid();
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(path,{fd,autoClose:false}))hash.update(chunk);
  if(pin(fstatSync(fd,{bigint:true}))!==pin(info)||pin(checkedFile(path))!==pin(info))throw invalid();
  return {hash:hash.digest('hex'),pin:pin(info)};
 }finally{closeSync(fd);}
}
async function inventory(root,scope){
 const home=directory(root,scope);
 const result=new Map();
 async function walk(relative,dir){
  for(const item of readdirSync(dir,{withFileTypes:true})){
   const path=relative?relative+'/'+item.name:item.name;
   if(!validFolderPath(path))continue;
   if(item.isDirectory()){
    const child=checkedDir(join(dir,item.name));
    if(child)await walk(path,child);
   }else if(item.isFile()){
    const current=await digest(join(dir,item.name));
    if(!current)throw invalid();
    if(result.size>=maxEntries)throw invalid();
    result.set(path,current.hash);
   }
  }
 }
 if(home)await walk('',home);
 return result;
}
// Use the same private path, file identity, and integrity checks for offline
// replica reception. Cross-process writer exclusivity is an activation gate.
export const localReplicaFilePrimitives=Object.freeze({stat,pin,directory,checkedFile,digest,inventory,validateProjectFolderFile});
const groupName=path=>path.includes('/')?path.split('/')[0]:'';
function standardized(answer,scope,local){
 if(!answer||Object.keys(answer).sort().join(',')!=='deleted,groups,scope'||answer.scope!==scope||
  !Array.isArray(answer.groups)||!Array.isArray(answer.deleted))throw invalid();
 const found=new Map(),unique=new Set();
 const checkedPath=path=>validFolderPath(path)&&validFolderPath(scope?scope+'/'+path:path);
 let count=0;
 for(const group of answer.groups){
  if(!group||typeof group!=='object')throw invalid();
  const {folder,files}=group;
  if(Object.keys(group).sort().join(',')!=='files,folder'||typeof folder!=='string'
   ||folder!==''&&(!validFolderPath(folder)||folder.includes('/'))
   ||found.has(folder)||!Array.isArray(files)||!files.length)throw invalid();
  const entries=[];
  for(const row of files){
   if(!row||++count>maxEntries||Object.keys(row).sort().join(',')!=='path,sha256,size'||!checkedPath(row.path)
    ||groupName(row.path)!==folder||unique.has(row.path)||!validHash(row.sha256)
    ||!Number.isSafeInteger(row.size)||row.size<0||row.size>maxFile||local.get(row.path)===row.sha256)throw invalid();
   unique.add(row.path);entries.push({...row,action:'write'});
  }
  found.set(folder,entries);
 }
 for(const row of answer.deleted){
  if(!row||++count>maxEntries||Object.keys(row).sort().join(',')!=='path,sha256'||!checkedPath(row.path)
   ||unique.has(row.path)||!validHash(row.sha256)||local.get(row.path)!==row.sha256)throw invalid();
  unique.add(row.path);
  const folder=groupName(row.path),entries=found.get(folder)??[];
  entries.push({...row,action:'remove'});found.set(folder,entries);
 }
 return found;
}

function makePool(limit){
 let active=0;
 const pending=[];
 function next(){
  while(active<limit&&pending.length){
   const {run,resolve,reject}=pending.shift();
   active++;
   Promise.resolve().then(run).then(resolve,reject).finally(()=>{active--;next();});
  }
 }
 return run=>new Promise((resolve,reject)=>{pending.push({run,resolve,reject});next();});
}

export function createRecursiveFolderSync({root,pds,projectCatalog,readableProjects,now=()=>performance.now()}){
 const allowed=new Set(readableProjects),scopeRuns=new Map(),operations=new Map(),locks=new Map();
 const transferCapacity=2; // The OPS/PDS chunk endpoint rejects a third concurrent file read.
 const transfer=makePool(transferCapacity),compareTransfer=makePool(1);
 const type=scope=>scope.split('/').length>=3?'item':'tab';
 const upperKey=projectId=>JSON.stringify(['upper',projectId]);
 const innerKey=scope=>JSON.stringify([type(scope),scope]);
 const currentSince=when=>Number.isFinite(when)&&now()-when<minute;
 const classifyScope=scope=>typeof scope!=='string'||!validFolderPath(scope)
  ||scope.split('/').length<2||!allowed.has(scope.split('/')[0]);
 const inflight=op=>op.phase==='comparing'||[...op.groups.values()].some(group=>group.state==='applying')
  ||(currentSince(op.planAt)&&[...op.groups.values()].some(group=>group.state==='ready'));
 function current(key){
  const op=operations.get(key);
  if(!op)return null;
  if(inflight(op)||currentSince(op.admittedAt))return op;
  operations.delete(key);
  return null;
 }
 function sweep(){for(const id of operations.keys())current(id);}
 function admit(key){
  const found=current(key);
  if(found)return {op:found,created:false};
  // No await between checking and recording admission. This instance is
  // created once by the local server, shared by all its browser sessions.
  const op={admittedAt:now(),phase:'comparing',groups:new Map()};
  operations.set(key,op);
  return {op,created:true};
 }
 const outcome=()=>({groups:[],unavailable:[]});
 function prepareGroup(op,folder,files,local){
  if(!files?.length)return;
  op.groups.set(folder,{state:'ready',count:files.length,completed:0,files,
   local:new Map(files.map(row=>[row.path,local.get(row.path)]))});
 }
 function prepare(op,run){
  op.ready=Promise.resolve().then(run).then(()=>{
   op.planAt=now();
   op.phase='compared';
  },error=>{
   op.error=error;
   op.phase='failed';
  });
 }
 function projectStatus(projectId){
  const op=current(upperKey(projectId));
  if(!op)return {needsRefresh:true};
  const group=op.groups.get(projectId);
  if(op.phase==='failed'||group?.state==='failed')return {needsRefresh:false,refreshState:'failed'};
  if(op.phase==='comparing'||['ready','applying'].includes(group?.state))return {needsRefresh:false,refreshState:'refreshing'};
  return {needsRefresh:false};
 }
 function list(allowed){
  return projectCatalog.list(allowed).map(project=>({...project,...projectStatus(project.projectId)}));
 }
 function refreshes(readable){
  const active=[];
  for(const projectId of allowed){
   if(!readable(projectId))continue;
   const op=current(upperKey(projectId)),group=op?.groups.get(projectId);
   if(group?.state==='applying')active.push({projectId,phase:'downloading',completed:group.completed,total:group.count});
   else if(op?.phase==='comparing'||group?.state==='ready')active.push({projectId,phase:'comparing'});
  }
  return active;
 }
 async function compareScope(scope){
  if(scopeRuns.has(scope))return scopeRuns.get(scope);
  const run=(async()=>{
   const local=new Map(),badProjects=new Set();
   if(scope){
    for(const [path,hash] of await inventory(root,scope))local.set(path,hash);
   }else for(const project of allowed){
    try{
     const projectFiles=await inventory(root,project);
     if(local.size+projectFiles.size>maxEntries||[...projectFiles.keys()].some(path=>!validFolderPath(project+'/'+path)))throw invalid();
     for(const [path,hash] of projectFiles)local.set(project+'/'+path,hash);
    }catch{badProjects.add(project);}
   }
   const provided=[...local].map(([path,sha256])=>({path,sha256}));
   const all=standardized(await compareTransfer(()=>pds.compare(scope,provided,{includeDeleted:true})),scope,local);
   return {local,all,badProjects};
  })().finally(()=>scopeRuns.delete(scope));
  scopeRuns.set(scope,run);
  return run;
 }
 async function compareTop(projectIds){
  if(projectIds.some(id=>!allowed.has(id)))throw invalid();
  sweep();
  const targets=projectIds.map(projectId=>({projectId,...admit(upperKey(projectId))}));
  // All requested keys are admitted before even the shared root inventory
  // begins. An unrequested sibling never acquires a timestamp from this call.
  const needed=targets.filter(row=>row.created);
  if(needed.length){
   const batch=Promise.resolve().then(()=>compareScope(''));
   for(const {projectId,op} of needed)prepare(op,async()=>{
    const reviewed=await batch;
    if(reviewed.badProjects.has(projectId))throw invalid();
    const files=reviewed.all.get(projectId),hasLocal=[...reviewed.local.keys()].some(path=>groupName(path)===projectId);
    if(!files?.length&&!hasLocal)throw invalid(); // No local card or changed files.
    prepareGroup(op,projectId,files,reviewed.local);
   });
  }
  const result=outcome();
  await Promise.all(targets.map(({op})=>op.ready));
  for(const {projectId,op} of targets){
   const group=op.groups.get(projectId);
   if(op.phase==='failed'||group?.state==='failed')result.unavailable.push(projectId);
   else if(['ready','applying'].includes(group?.state))result.groups.push({projectId,count:group.count});
  }
  return result;
 }
 async function compareInner(scope){
  if(classifyScope(scope))throw invalid();
  sweep();
  const {op,created}=admit(innerKey(scope));
  if(created)prepare(op,async()=>{
   const {all,local}=await compareScope(scope);
   for(const [folder,files] of all)prepareGroup(op,folder,files,local);
  });
  await op.ready;
  if(op.phase==='failed')throw op.error;
  const result={scope,...outcome()};
  for(const [folder,group] of op.groups){
   if(group.state==='failed')result.unavailable.push(folder);
   else if(['ready','applying'].includes(group.state))result.groups.push({folder,count:group.count});
  }
  return result;
 }
 async function locked(path,run){
  const previous=locks.get(path)||Promise.resolve();
  const next=previous.catch(()=>{}).then(run);
  locks.set(path,next);
  try{return await next;}finally{if(locks.get(path)===next)locks.delete(path);}
 }
 async function writeFile(scope,row,expected){
  const relative=scope?scope+'/'+row.path:row.path;
  if(!validFolderPath(relative))throw invalid();
  const path=join(root,relative);
  const parent=dirname(relative),relativeParent=parent==='.'?'':parent;
  return await locked(path,async()=>{
   const folder=directory(root,relativeParent,true);
   const before=await digest(path);
   if(before?.hash===row.sha256)return false; // Another scope already published identical bytes.
   if(before?.hash!==expected)throw stale();
   const temp=join(folder,'.folder-download-'+randomUUID());
   const hashes=createHash('sha256');
   let size=0;
   const response=await pds.file(scope,row.path,row.sha256,row.size);
   if(!response.body||response.headers.get('content-length')!==String(row.size)){
    if(response.body?.destroy)response.body.destroy();
    else await response.body?.cancel().catch(()=>{});
    throw invalid();
   }
   const verify=new Transform({transform(chunk,_encoding,callback){
    size+=chunk.length;
    if(size>row.size)return callback(invalid());
    hashes.update(chunk);callback(null,chunk);
   }});
   try{
    const source=response.body.getReader?Readable.fromWeb(response.body):response.body;
    await pipeline(source,verify,createWriteStream(temp,{flags:'wx',mode:0o600}));
    if(size!==row.size||hashes.digest('hex')!==row.sha256)throw invalid();
    const projectFile=relative.split('/');
    if(projectFile.length===2&&['project.json','icon.png'].includes(projectFile[1])){
     // The UI has a stricter contract for these two bounded header files.
     const limit=projectFile[1]==='project.json'?64*1024:2*1024*1024;
     if(size>limit)throw invalid();
     validateProjectFolderFile(projectFile[1],readFileSync(temp));
    }
    if(directory(root,relativeParent)!==folder||pin(checkedFile(path))!==(before?.pin??null))throw stale();
    renameSync(temp,path);
    return true;
   }finally{if(stat(temp))unlinkSync(temp);}
  });
 }
 async function recheckGroupRemovals(scope,files){
  const local=new Map(files.filter(row=>row.action==='remove').map(row=>[row.path,row.sha256]));
  if(!local.size)return;
  const manifest=[...local].map(([path,sha256])=>({path,sha256}));
  const reviewed=standardized(await compareTransfer(()=>pds.compare(scope,manifest,{includeDeleted:true})),scope,local);
  const confirmed=new Map([...reviewed.values()].flat().filter(row=>row.action==='remove').map(row=>[row.path,row.sha256]));
  if([...local].some(([path,sha])=>confirmed.get(path)!==sha))throw stale();
 }
 async function moveToTrash(scope,row){
  const relative=scope?scope+'/'+row.path:row.path;
  if(!validFolderPath(relative))throw invalid();
  const parent=dirname(relative),relativeParent=parent==='.'?'':parent,path=join(root,relative);
  return await locked(path,async()=>{
   const folder=directory(root,relativeParent);
   if(!folder)return false; // Already absent; never create a source directory for a deletion.
   const before=await digest(path);
   if(!before)return false;
   if(before.hash!==row.sha256)throw stale();
   const trash=checkedDir(join(root,'.deleted-sync'),true);
   if(!trash)throw invalid();
   const staging=checkedDir(mkdtempSync(join(trash,'entry-')),false);
   const target=join(staging,'content'),receipt=join(staging,'receipt.json');
   writeFileSync(receipt,JSON.stringify({relativePath:relative,sha256:row.sha256}),{flag:'wx',mode:0o600,flush:true});
   const current=checkedFile(path);
   if(!current||pin(current)!==before.pin||directory(root,relativeParent)!==folder||
      checkedDir(trash,false)!==trash||checkedDir(staging,false)!==staging||
      stat(staging).dev!==current.dev||stat(target))throw stale();
   renameSync(path,target); // Same-volume atomic, recoverable move. No user bytes are unlinked.
   return true;
  });
 }
 async function apply(scope,folder,id){
  const op=current(id);
  if(!op)throw stale();
  await op.ready;
  if(op.phase==='failed')throw op.error;
  const group=op.groups.get(folder);
  if(!group){
   if(scope)throw stale();
   return 'cached';
  }
  if(group.state==='completed')return 'cached';
  if(group.state==='failed')throw group.error;
  if(group.state==='applying')return group.job;
  if(current(id)!==op)throw stale();
  // First transfer for this planned group wins. Revealing a group status to
  // another authorized page never gives it a second transfer.
  group.state='applying';
  group.transferStartedAt=now();
  group.job=Promise.resolve().then(async()=>{
   async function applyEntries(entries,remove){
    let cursor=0,failure;
    async function consumer(){
     while(!failure&&cursor<entries.length){
      const row=entries[cursor++];
      try{
       // Local moves share the exact path lock, not the PDS chunk pool;
       // don't queue fresh delete evidence behind unrelated downloads.
       const changed=remove?await moveToTrash(scope,row):await transfer(()=>writeFile(scope,row,group.local.get(row.path)));
       if(changed){
        group.completed++;
        if(!scope&&remove&&row.path===folder+'/project.json')group.projectHeaderRemoved=true;
       }
      }catch(error){failure??=error;}
     }
    }
    await Promise.all(Array.from({length:Math.min(entries.length,transferCapacity)},consumer));
    if(failure)throw failure;
   }
   try{
    const removals=group.files.filter(row=>row.action==='remove');
    await recheckGroupRemovals(scope,removals);
    await applyEntries(removals,true);
    await applyEntries(group.files.filter(row=>row.action==='write'),false);
    group.state='completed';
    return 'refreshed';
   }catch(error){
    group.state='failed';
    group.error=error;
    throw error;
   }finally{
    delete group.files;
    delete group.local;
   }
  });
  return group.job;
 }
 async function applyTop(projectId){
  if(!allowed.has(projectId))throw invalid();
  const key=upperKey(projectId);
  const status=await apply('',projectId,key);
  const project=list(id=>id===projectId)[0]??null;
  const group=current(key)?.groups.get(projectId);
  return {projectId,status:!project&&group?.state==='completed'&&group.projectHeaderRemoved?'removed':status,project};
 }
 async function applyInner(scope,folder){
  if(classifyScope(scope)||typeof folder!=='string'||folder&&(!validFolderPath(folder)||folder.includes('/')))throw invalid();
  return {scope,folder,status:await apply(scope,folder,innerKey(scope))};
 }
 return {compareTop,applyTop,compareInner,applyInner,list,refreshes};
}
