/** Private, managed Space -> local Binari replica. No network or request authority. */
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,constants,fstatSync,fsyncSync,lstatSync,mkdirSync,openSync,readFileSync,
 readSync,readdirSync,realpathSync,renameSync,rmdirSync,rmSync,unlinkSync,statfsSync,writeFileSync,writeSync} from 'node:fs';
import {release} from 'node:os';
import {basename,dirname,isAbsolute,join,resolve} from 'node:path';
import {validWorkspacePath} from '../../ngs-local/sites/npcgen/build/workspace-read-storage.mjs';

import {verifyNtfsRoot,windowsFileSegment,windowsP2Path} from './windows-storage.mjs';

export const mirrorChunkBytes=1024*1024;
const manifestBytes=16*mirrorChunkBytes, maxFiles=32_768, maxFile=5*1024**4;
const recoveryBytes=64*mirrorChunkBytes;
const hashRE=/^[a-f0-9]{64}$/u, passRE=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u;
const scopeNames=new Set(['project','concept','npcs','motion-presets','props','cinematics','assembly','audio']);
const uid=process.getuid?.();
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const assert=(ok,code,status=409)=>{if(!ok)throw Object.assign(Error(code),{status});};
const integer=(x,min,max)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const stat=p=>{try{return lstatSync(p,{bigint:true});}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const inode=s=>s&&[s.dev,s.ino].join(':');
const pin=s=>s&&[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const nativeWindows=process.platform==='win32';
const sameOwner=(s,privateMode=true)=>s&&(nativeWindows||Number(s.uid)===uid&&!(Number(s.mode)&(privateMode?0o077:0o022)));
const privateFile=s=>s?.isFile()&&sameOwner(s)&&s.nlink===1n;
const hash=()=>createHash('sha256');
const pathKey=p=>nativeWindows?p?.toLowerCase():p;
const readFlags=constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0);

function ownedDirectory(path,{create=false,privateMode=true}={}){
 let s=stat(path);
 if(!s&&create){
  try{mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  s=stat(path);
 }
 if(!s)return false;
 assert(s.isDirectory()&&sameOwner(s,privateMode)&&pathKey((nativeWindows?realpathSync.native:realpathSync)(path))===pathKey(path),'VIEWER_P2_UNSAFE_DIRECTORY');
 return true;
}

function inspect(path,{digests=false}={}){
 const s=stat(path);
 if(!s)return null;
 assert(privateFile(s)&&(!nativeWindows||pathKey(realpathSync.native(path))===pathKey(path)),'VIEWER_P2_UNSAFE_FILE');
 let sha256;
 if(digests){
  const fd=openSync(path,readFlags);
  try{
   assert(pin(fstatSync(fd,{bigint:true}))===pin(s),'VIEWER_P2_FILE_CHANGED');
   const stream=hash(),buffer=Buffer.allocUnsafe(mirrorChunkBytes);
   for(let n;(n=readSync(fd,buffer,0,buffer.length,null));)stream.update(buffer.subarray(0,n));
   assert(pin(fstatSync(fd,{bigint:true}))===pin(s)&&pin(stat(path))===pin(s),'VIEWER_P2_FILE_CHANGED');
   sha256=stream.digest('hex');
  }finally{closeSync(fd);}
 }
 return {pin:pin(s),size:Number(s.size),...(digests?{sha256}:{})};
}

function readJson(path,max){
 const file=inspect(path);
 if(!file)return null;
 assert(file.size<=max,'VIEWER_P2_UNSAFE_METADATA');
 const fd=openSync(path,readFlags);
 try{
  assert(pin(fstatSync(fd,{bigint:true}))===file.pin,'VIEWER_P2_FILE_CHANGED');
  const bytes=readFileSync(fd);
  assert(pin(fstatSync(fd,{bigint:true}))===file.pin&&pin(stat(path))===file.pin&&bytes.length===file.size,
   'VIEWER_P2_FILE_CHANGED');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }finally{closeSync(fd);}
}

function atomicJson(path,value){
 const temp=join(dirname(path),'.json-'+randomUUID());
 const fd=openSync(temp,'wx',0o600);
 try{
  try{writeFileSync(fd,JSON.stringify(value));fsyncSync(fd);}finally{closeSync(fd);}
  renameSync(temp,path);
 }finally{rmSync(temp,{force:true});}
}

export function replicaPathResource(path){
 const [part,child]=path.split('/');
 if(path==='project.json'||path==='icon.png')return 'project';
 if(part==='cinematics'&&child==='assemblies')return 'assembly';
 return path.includes('/')&&scopeNames.has(part)&&!['project','assembly'].includes(part)?part:null;
}
const allowedBy=(resource,resources)=>resources.has(resource);

const validFile=x=>exact(x,['path','sha256','size'])&&validWorkspacePath(x.path)&&
 typeof x.sha256==='string'&&hashRE.test(x.sha256)&&integer(x.size,0,maxFile);

export function validateMirrorManifest(value){
 const supplied=Object.hasOwn(value??{},'resources');
 assert(exact(value,supplied?['projectId','files','resources']:['projectId','files'])&&value.projectId==='binari'&&
  Array.isArray(value.files)&&value.files.length<=maxFiles,'VIEWER_MIRROR_BAD_MANIFEST',400);
 const resources=supplied?value.resources:[];
 assert(Array.isArray(resources)&&resources.length<=scopeNames.size&&resources.every(r=>scopeNames.has(r))&&
  new Set(resources).size===resources.length,'VIEWER_MIRROR_BAD_RESOURCES',400);
 const alias=new Map(),paths=new Set(),parents=new Set(),scope=new Set(resources);
 let length=0;
 for(const file of value.files){
  assert(validFile(file)&&replicaPathResource(file.path)&&!paths.has(file.path),'VIEWER_MIRROR_BAD_FILE',400);
  if(nativeWindows)assert(file.path.split('/').every(windowsFileSegment),'VIEWER_P2_NTFS_UNSAFE_NAME',400);
  if(supplied)assert(allowedBy(replicaPathResource(file.path),scope),'VIEWER_MIRROR_FILE_OUTSIDE_GRANT',400);
  paths.add(file.path);length+=Buffer.byteLength(JSON.stringify(file));
  assert(length<=manifestBytes,'VIEWER_MIRROR_MANIFEST_TOO_LARGE',413);
  const parts=file.path.split('/');
  let key='',name='';
  for(let i=0;i<parts.length;i++){
   name+=(i===0?'':'/')+parts[i];
   key+=(i===0?'':'/')+parts[i].normalize('NFD').toLowerCase();
   assert(!alias.has(key)||alias.get(key)===name,'VIEWER_MIRROR_LOCAL_PATH_ALIAS',400);
   alias.set(key,name);
   if(i<parts.length-1)parents.add(name);
  }
 }
 for(const path of paths)assert(!parents.has(path),'VIEWER_MIRROR_FILE_IS_PARENT',400);
 return {projectId:'binari',files:value.files.map(x=>({...x})),...(supplied?{resources:[...resources]}:{})};
}

// Separate classification from filesystem operations so tests can exercise
// fail-closed Windows paths even on the POSIX development host.
export function mirrorRuntime({platform,kernel,wslEnvironment,userId}){
 if(platform==='win32')return 'ntfs';
 const onWsl=platform==='linux'&&(/microsoft|wsl/iu.test(kernel)||wslEnvironment);
 if(!onWsl)return 'posix';
 assert(/wsl2|microsoft-standard/iu.test(kernel)&&Number.isInteger(userId)&&userId>0,
  'VIEWER_P2_REQUIRES_WSL2_LINUX_FILESYSTEM',400);
 return 'wsl2';
}
export function assertMirrorWslFilesystem(type){
 // Linux's ext2/3/4 magic; the default WSL2 distro VHD is ext4.
 assert(type===0xef53,'VIEWER_P2_REQUIRES_WSL2_LINUX_FILESYSTEM',400);
}
export async function openMirror(root,{create=false}={}){
 if(nativeWindows){
  assert(windowsP2Path(root),'VIEWER_P2_NTFS_PATH_REQUIRED',400);
  verifyNtfsRoot(root,{create,deep:true});
 }
 const onWsl=mirrorRuntime({platform:process.platform,kernel:release(),
  wslEnvironment:Boolean(process.env.WSL_DISTRO_NAME||process.env.WSL_INTEROP),userId:uid})==='wsl2';
 assert((nativeWindows||uid!==undefined)&&typeof root==='string'&&isAbsolute(root)&&resolve(root)===root&&
  ownedDirectory(root,{privateMode:false}),'VIEWER_P2_DIRECTORY_REQUIRED',400);
 // Windows-mounted NTFS and network paths may expose synthetic Unix modes.
 // Do not accept those as equivalent to a native Linux filesystem.
 if(onWsl)assertMirrorWslFilesystem(statfsSync(root).type);
 const device=stat(root).dev;
 const directory=(path,opts)=>{
  if(onWsl||nativeWindows){
   const s=stat(path);
   if(s)assert(s.dev===device,'VIEWER_P2_UNSAFE_DIRECTORY');
  }
  return ownedDirectory(path,opts);
 };
 const projectRoot=join(root,'binari'), internal=join(root,'.ngs-viewer'), statePath=join(internal,'replica.json'),
  markerPath=join(internal,'managed.json'),lockPath=join(internal,'writer-lock');
 assert(directory(internal,{create:true}),'VIEWER_P2_UNSAFE_DIRECTORY');
 const rootId=inode(stat(root)),internalId=inode(stat(internal));
 const ownerMarker=join(lockPath,'owner-'+process.pid+'-'+randomUUID());
 // An exact unique owner entry permits safe stale cleanup after a process
 // crash. Never clear an uninitialized lease or a live/unknown PID.
 try{mkdirSync(lockPath,{mode:0o700});}catch(e){
  if(e.code!=='EEXIST')throw e;
  const busy=()=>assert(false,'VIEWER_P2_ALREADY_OPEN');
  if(!directory(lockPath))busy();
  const staleId=inode(stat(lockPath)), names=readdirSync(lockPath);
  const owner=names.length===1&&/^owner-([1-9][0-9]*)-([a-f0-9-]+)$/u.exec(names[0]);
  if(!owner||!passRE.test(owner[2])||!integer(Number(owner[1]),1,2147483647))busy();
  const previous=join(lockPath,names[0]);
  if(!inspect(previous))busy();
  let gone=false;
  try{process.kill(Number(owner[1]),0);}catch(probe){gone=probe.code==='ESRCH';}
  if(!gone||inode(stat(lockPath))!==staleId)busy();
  try{unlinkSync(previous);rmdirSync(lockPath);mkdirSync(lockPath,{mode:0o700});}
  catch{busy();}
 }
 const lockId=inode(stat(lockPath));
 const unlock=()=>{
  if(inode(stat(lockPath))!==lockId)return;
  try{unlinkSync(ownerMarker);}catch(e){if(e.code!=='ENOENT')throw e;}
  rmdirSync(lockPath);
 };
 try{writeFileSync(ownerMarker,'',{flag:'wx',mode:0o600});}catch(e){unlock();throw e;}
 let current=null, projectId,closed=false,active=null,poisoned=false;
 const scoped=()=>{
  assert(!closed&&!poisoned&&directory(root,{privateMode:false})&&inode(stat(root))===rootId&&
   directory(internal)&&inode(stat(internal))===internalId&&directory(projectRoot)&&
   inode(stat(projectRoot))===projectId&&inode(stat(lockPath))===lockId&&privateFile(stat(ownerMarker)),'VIEWER_P2_SCOPE_CHANGED');
 };
 const target=(path,create=false)=>{
  scoped();
  if(nativeWindows)assert(path.split('/').every(windowsFileSegment),'VIEWER_P2_NTFS_UNSAFE_NAME');
  let currentDir=projectRoot;
  const parts=path.split('/');
  for(const part of parts.slice(0,-1)){
   currentDir=join(currentDir,part);
   if(!directory(currentDir,{create}))return null;
  }
  return join(currentDir,parts.at(-1));
 };
 const clean=stage=>{
  scoped();
  assert(dirname(stage)===internal&&/^sync-[0-9a-f-]+$/u.test(basename(stage))&&
   directory(stage),'VIEWER_P2_UNSAFE_STAGE');
  rmSync(stage,{recursive:true});
 };
 const validateState=state=>{
  assert(exact(state,['id','manifest','managed'])&&passRE.test(state.id)&&
   Array.isArray(state.managed)&&state.managed.length<=maxFiles*2,
   'VIEWER_P2_UNSAFE_METADATA');
  validateMirrorManifest(state.manifest);
  const paths=new Set();
  for(const x of state.managed){
   assert(exact(x,['path','sha256','size','pin'])&&validFile({path:x.path,sha256:x.sha256,size:x.size})&&
    typeof x.pin==='string'&&/^(?:-?[0-9]+:){4}-?[0-9]+$/u.test(x.pin)&&!paths.has(x.path),'VIEWER_P2_UNSAFE_METADATA');
   paths.add(x.path);
  }
 };
 const rollback=(stage,plan)=>{
  assert(exact(plan,['id','ops'])&&passRE.test(plan.id)&&Array.isArray(plan.ops)&&plan.ops.length<=maxFiles*2,
   'VIEWER_P2_UNSAFE_JOURNAL');
  for(const [i,op] of [...plan.ops.entries()].reverse()){
   assert((exact(op,['path','old','next'])||exact(op,['path','old','next','staged'])&&integer(op.staged,0,maxFiles*2))&&validWorkspacePath(op.path)&&
    (op.old===null||hashRE.test(op.old))&&(op.next===null||hashRE.test(op.next)),
    'VIEWER_P2_UNSAFE_JOURNAL');
   const backup=join(stage,'backup-'+i), staged=join(stage,'change-'+(op.staged??i));
   const original=inspect(backup,{digests:true});
   const p=target(op.path);
   if(original){
    assert(p&&original.sha256===op.old,'VIEWER_P2_ROLLBACK_CONFLICT');
    const installed=inspect(p,{digests:true});
    if(installed)assert(installed.sha256===op.next,'VIEWER_P2_ROLLBACK_CONFLICT');
    renameSync(backup,p);
   }else if(op.old===null&&op.next!==null&&!stat(staged)&&p){
    const installed=inspect(p,{digests:true});
    if(installed){
     assert(installed.sha256===op.next,'VIEWER_P2_ROLLBACK_CONFLICT');
     unlinkSync(p);
    }
   }
  }
 };
 try{
  const marker=readJson(markerPath,4096);
  if(marker===null){
   assert(stat(projectRoot)===null,'VIEWER_P2_UNMANAGED_BINARI');
   mkdirSync(projectRoot,{mode:0o700});projectId=inode(stat(projectRoot));
   atomicJson(markerPath,{schema:'ngs-viewer.managed.v1',projectId});
  }else{
   assert(exact(marker,['schema','projectId'])&&marker.schema==='ngs-viewer.managed.v1'&&directory(projectRoot)&&
    marker.projectId===inode(stat(projectRoot)),'VIEWER_P2_UNMANAGED_BINARI');
   projectId=marker.projectId;
  }
  scoped();
  current=readJson(statePath,recoveryBytes);
  if(current)validateState(current);
  for(const name of readdirSync(internal)){
   if(nativeWindows&&/^ngs-sync-spool-[A-Za-z0-9]{6}$/u.test(name)){
    const spool=join(internal,name);
    assert(directory(spool),'VIEWER_P2_UNSAFE_STAGE');
    rmSync(spool,{recursive:true});continue;
   }
   if(name.startsWith('.json-')&&passRE.test(name.slice(6))){if(inspect(join(internal,name)))unlinkSync(join(internal,name));continue;}
   if(!name.startsWith('sync-')||!passRE.test(name.slice(5)))continue;
   const stage=join(internal,name);
   assert(directory(stage),'VIEWER_P2_UNSAFE_STAGE');
   const journal=readJson(join(stage,'commit.json'),recoveryBytes);
   if(journal){
    assert(journal.id===name.slice(5),'VIEWER_P2_UNSAFE_JOURNAL');
    if(journal.id!==current?.id)rollback(stage,journal);
   }
   clean(stage);
  }
 }catch(e){unlock();throw e;}

 function pass(id){
  scoped();
  assert(active?.id===id,'VIEWER_MIRROR_UNKNOWN_SYNC');
  return active;
 }
 function begin(manifest){
  scoped();assert(!active,'VIEWER_MIRROR_SYNC_IN_PROGRESS');
  const m=validateMirrorManifest(manifest), previous=new Map((current?.managed??[]).map(x=>[x.path,x]));
  const activePaths=new Set(m.files.map(x=>x.path)), coverage=new Set(m.resources??[]);
  const kept=new Map(previous), changes=new Map(), entries=[], ops=[];
  const observe=(path,old)=>{
   const p=target(path),disk=p&&inspect(p);
   if(!disk)return null;
   if(!old)return disk;
   if(disk.pin===old.pin&&disk.size===old.size)return {...disk,sha256:old.sha256};
   return inspect(p,{digests:true});
  };
  for(const row of m.files){
   const old=previous.get(row.path),disk=observe(row.path,old);
   assert(!disk||old,'VIEWER_P2_UNKNOWN_FILE');
   assert(!disk||disk.sha256===old.sha256,'VIEWER_P2_LOCALLY_EDITED_FILE');
   const item={...row,disk};
   entries.push(item);
   if(disk&&disk.sha256===row.sha256&&disk.size===row.size){
    kept.set(row.path,{...row,pin:disk.pin});continue;
   }
   const work={...item,index:ops.length,offset:0,stream:hash(),sealed:false};
   changes.set(row.path,work);ops.push({path:row.path,old:disk?.sha256??null,next:row.sha256,disk});
  }
  for(const [path,old] of previous){
   if(activePaths.has(path)||!allowedBy(replicaPathResource(path),coverage))continue;
   const disk=observe(path,old);
   if(disk&&disk.sha256===old.sha256&&disk.size===old.size)
    ops.push({path,old:old.sha256,next:null,disk});
   kept.delete(path); // Locally edited and nonmatching files survive, outside our management.
  }
  const id=randomUUID(),stage=join(internal,'sync-'+id);
  mkdirSync(stage,{mode:0o700});
  try{
   for(const work of changes.values()){
    if(work.size!==0)continue;
    assert(work.stream.digest('hex')===work.sha256,'VIEWER_MIRROR_HASH_MISMATCH',400);
    writeFileSync(join(stage,'change-'+work.index),Buffer.alloc(0),{flag:'wx',mode:0o600});
    work.sealed=true;
   }
  }catch(e){clean(stage);throw e;}
  active={id,stage,m,kept,changes,entries,ops};
  return {syncId:id,files:[...changes.values()].map(({path,sha256,size})=>({path,sha256,size}))};
 }
 function append(id,path,offset,bytes){
  const a=pass(id), work=a.changes.get(path);
  assert(work&&!work.sealed&&!work.failed&&integer(offset,0,maxFile)&&offset===work.offset,
   'VIEWER_MIRROR_CHUNK_OFFSET');
  assert(bytes instanceof Uint8Array&&bytes.byteLength>0&&bytes.byteLength<=mirrorChunkBytes&&
   offset+bytes.byteLength<=work.size,'VIEWER_MIRROR_BAD_CHUNK',400);
  assert(directory(a.stage),'VIEWER_P2_UNSAFE_STAGE');
  const p=join(a.stage,'change-'+work.index),flags=constants.O_WRONLY|(constants.O_NOFOLLOW??0)|
   (offset===0?constants.O_CREAT|constants.O_EXCL:0);
  const fd=openSync(p,flags,0o600);
  try{
   const s=fstatSync(fd,{bigint:true});
   assert(privateFile(s)&&Number(s.size)===offset&&(!work.pin||pin(s)===work.pin),'VIEWER_P2_STAGE_CHANGED');
   for(let written=0;written<bytes.byteLength;){
    const n=writeSync(fd,bytes,written,bytes.byteLength-written,offset+written);
    assert(n>0,'VIEWER_MIRROR_SHORT_WRITE',503);written+=n;
   }
   work.stream.update(bytes);work.offset+=bytes.byteLength;
   if(work.offset===work.size){
    assert(work.stream.digest('hex')===work.sha256,'VIEWER_MIRROR_HASH_MISMATCH',400);
    fsyncSync(fd);work.sealed=true;
   }
   work.pin=pin(fstatSync(fd,{bigint:true}));
  }catch(e){work.failed=true;throw e;}finally{closeSync(fd);}
  return {offset:work.offset};
 }
 function inventory(){
  scoped();
  if(nativeWindows)verifyNtfsRoot(root,{deep:true});
  const rows=[];
  for(const row of current?.managed??[]){
   const p=target(row.path),disk=p&&inspect(p);
   if(!disk)continue;
   if(disk.pin!==row.pin)assert(inspect(p,{digests:true}).sha256===row.sha256,'VIEWER_P2_LOCALLY_EDITED_FILE');
   rows.push({path:row.path,sha256:row.sha256});
  }
  return rows;
 }
 function reset(id,path){
  const a=pass(id),work=a.changes.get(path);
  assert(work,'VIEWER_MIRROR_UNKNOWN_FILE');
  const staged=join(a.stage,'change-'+work.index);
  if(inspect(staged))unlinkSync(staged);
  work.offset=0;work.stream=hash();work.sealed=false;work.failed=false;delete work.pin;
  if(work.size===0){
   assert(work.stream.digest('hex')===work.sha256,'VIEWER_MIRROR_HASH_MISMATCH',400);
   writeFileSync(staged,Buffer.alloc(0),{flag:'wx',mode:0o600});
   work.sealed=true;
  }
 }
 function finish(id,{failed=new Set(),confirmed=null}={}){
  const a=pass(id);
  if(nativeWindows)verifyNtfsRoot(root,{deep:true});
  assert(directory(a.stage),'VIEWER_P2_UNSAFE_STAGE');
  const checked=new Set(),previous=new Map((current?.managed??[]).map(row=>[row.path,row]));
  const ops=a.ops.flatMap((op,staged)=>op.next===null?
   confirmed&&!confirmed.has(op.path)?[]:[{...op,staged}]:
   failed.has(op.path)?[]:[{...op,staged}]);
  const manifestFiles=[];
  for(const item of a.entries){
   const {path,size,sha256}=item;
   if(!failed.has(path)){manifestFiles.push({path,size,sha256});continue;}
   // A definite transfer failure does not suppress independent successful files
   // or advertise its uninstalled replacement.
   const prior=previous.get(path);
   if(prior&&item.disk){a.kept.set(path,prior);manifestFiles.push({path,size:prior.size,sha256:prior.sha256});}
   else a.kept.delete(path);
  }
  if(confirmed)for(const op of a.ops){
   if(op.next!==null||confirmed.has(op.path))continue;
   const prior=previous.get(op.path);
   if(prior&&op.disk){a.kept.set(op.path,prior);manifestFiles.push({path:prior.path,size:prior.size,sha256:prior.sha256});}
  }
  for(const item of [...a.entries,...ops]){
   if(checked.has(item.path))continue;checked.add(item.path);
   const p=target(item.path),got=p&&inspect(p);
   assert((got?.pin??null)===(item.disk?.pin??null),'VIEWER_P2_FILE_CHANGED');
  }
  for(const work of a.changes.values()){
   if(failed.has(work.path))continue;
   const staged=inspect(join(a.stage,'change-'+work.index));
   assert(work.sealed&&!work.failed&&staged&&staged.size===work.size&&(!work.pin||staged.pin===work.pin),
    'VIEWER_MIRROR_TRANSFER_INCOMPLETE');
  }
  const journal={id,ops:ops.map(({path,old,next,staged})=>({path,old,next,staged}))};
  atomicJson(join(a.stage,'commit.json'),journal);
  try{
   for(const [i,op] of ops.entries()){
    const p=target(op.path,op.next!==null);
    const observed=p&&inspect(p);
    assert((observed?.pin??null)===(op.disk?.pin??null),'VIEWER_P2_FILE_CHANGED');
    if(observed)renameSync(p,join(a.stage,'backup-'+i));
    if(op.next!==null){
     renameSync(join(a.stage,'change-'+op.staged),p);
     const {path,size,sha256}=a.changes.get(op.path);
     a.kept.set(path,{path,size,sha256,pin:inspect(p).pin});
    }
   }
   const manifest={...a.m,files:manifestFiles},state={id,manifest,managed:[...a.kept.values()]};
   validateState(state);
   atomicJson(statePath,state);current=state;
  }catch(error){
   try{rollback(a.stage,journal);clean(a.stage);}
   catch{poisoned=true;}
   active=null;throw error;
  }
  active=null;
  try{clean(a.stage);}catch{/* Next open removes committed staging. */}
  return {files:manifestFiles.length,changed:ops.filter(op=>op.next!==null).length,removed:ops.filter(op=>op.next===null).length};
 }
 function abort(id){
  const a=pass(id);clean(a.stage);active=null;
 }
 function close(){
  if(closed)return;
  try{if(active&&!poisoned)abort(active.id);}
  finally{closed=true;unlock();}
 }
 // Read only bytes pinned by the successful Windows mirror commit.
 // Case-insensitive paths are already canonicalized by the manifest guard.
 function windowsProject(){
  const snapshot=current;
  if(!snapshot)return null;
  const placed=new Map(snapshot.managed.map(row=>[row.path,row]));
  const lookup=relative=>{
   if(!validWorkspacePath(relative))return null;
   const row=placed.get(relative);
   if(!row)return null;
   const p=target(relative),file=p&&inspect(p);
   return file?.pin===row.pin&&file.size===row.size?{p,file}:null;
  };
  return Object.freeze({
   head(relative){const v=lookup(relative);return v?{size:v.file.size,modifiedAtMs:0}:null;},
   readBytes(relative,max){
    const v=lookup(relative);
    if(!v||!Number.isSafeInteger(max)||max<1||v.file.size>max)return null;
    const fd=openSync(v.p,readFlags);
    try{
     assert(pin(fstatSync(fd,{bigint:true}))===v.file.pin,'VIEWER_P2_FILE_CHANGED');
     const bytes=readFileSync(fd);
     assert(pin(fstatSync(fd,{bigint:true}))===v.file.pin&&lookup(relative)?.file.pin===v.file.pin&&
      bytes.length===v.file.size,'VIEWER_P2_FILE_CHANGED');
     return bytes;
    }finally{closeSync(fd);}
   },
  });
 }
 return Object.freeze({projectRoot,...(nativeWindows?{openProject:windowsProject,privateSpoolRoot:()=>{scoped();return internal;}}:{}),inventory,begin,append,reset,finish,abort,close,snapshot:()=>current?structuredClone(current.manifest):null});
}
