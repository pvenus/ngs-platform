/** Opt-in PDS push reception for the separate Local MCP. Only the NGS replica is writable. */
import {createHash,randomUUID} from 'node:crypto';
import {closeSync,fsyncSync,openSync,readFileSync,realpathSync,renameSync,unlinkSync,writeSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join} from 'node:path';
import {localReplicaFilePrimitives as fs,moveReplicaFileToTrash,validFolderPath} from './local-recursive-folders.mjs';

const policy=new URL('../../../dev/catalog-read-policy.json',import.meta.url);
const idleTimeout=120_000,maxFile=Number.MAX_SAFE_INTEGER,chunkSize=1024*1024,maxInventoryBytes=16*1024*1024;
export const maxFileSyncRpcBytes=4*Math.ceil(chunkSize/3)+32*1024;
export const fileSyncChunkTool='ngs_file_sync_file_chunk';
const scopePattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;
const hashPattern=/^[a-f0-9]{64}$/u;
const safeScope=value=>typeof value==='string'&&value===value.trim()&&scopePattern.test(value);
const rpcString={type:'string'},int=(maximum)=>({type:'integer',minimum:0,maximum});
const rpcTool=(name,description,fields)=>({name,description,inputSchema:{type:'object',additionalProperties:false,properties:fields,required:Object.keys(fields)}});
const syncId=rpcString;
export const fileSyncTools=Object.freeze([
 rpcTool('ngs_file_sync_begin','Start one local project-replica cycle and get the current hash inventory.',{scope:rpcString}),
 rpcTool(fileSyncChunkTool,'Send one ordered bounded chunk for a file selected by unchanged PDS MCP reads.',{
  syncId,path:rpcString,sha256:rpcString,size:int(maxFile),offset:int(maxFile),dataBase64:rpcString}),
 rpcTool('ngs_file_sync_remove','Recoverably move one exact prior local replica file after live source absence confirmation.',{syncId,path:rpcString,sha256:rpcString}),
 rpcTool('ngs_file_sync_finish','End a finished local replica file cycle.',{syncId}),
 rpcTool('ngs_file_sync_abort','Cancel the current incomplete replica file transfer.',{syncId}),
]);
const exact=(obj,...keys)=>obj&&typeof obj==='object'&&!Array.isArray(obj)&&Object.keys(obj).length===keys.length&&keys.every(k=>Object.hasOwn(obj,k));
const fail=(error='NGS_FILE_SYNC_INVALID',status=400)=>{throw Object.assign(Error(error),{status});};
const stale=()=>fail('NGS_FILE_SYNC_REPLICA_CHANGED',409);

export function localFileSyncReceiverFromEnv(env=process.env){
 const mode=env.NGS_FILE_SYNC_MODE??'pull';
 if(!['pull','push'].includes(mode))throw Error('NGS_FILE_SYNC_CONFIG_INVALID');
 if(mode==='pull')return undefined;
 const configured=env.NGS_FILE_SYNC_PROJECTS?.split(',')??[];
 const allowed=new Set(JSON.parse(readFileSync(policy)).projects?.map(row=>row.id));
 if(!configured.length||configured.some(id=>!allowed.has(id)))throw Error('NGS_FILE_SYNC_SCOPE_DENIED');
 const root=env.NGS_PROJECT_CATALOG_ROOT??join(homedir(),'Workspaces','NGS','data','project-catalog');
 return createLocalFileSyncReceiver({root,projects:configured});
}

export function createLocalFileSyncReceiver({root,projects,now=()=>performance.now(),wall=Date.now}){
 if(typeof root!=='string'||!isAbsolute(root)||realpathSync(root)!==root||!fs.directory(root)||
   !Array.isArray(projects)||!projects.length||projects.some(id=>!safeScope(id))||new Set(projects).size!==projects.length)
  throw Error('NGS_FILE_SYNC_CONFIG_INVALID');
 const allowed=new Set(projects),inventories=new Map();
 let active=null,busy=false,closed=false;
 function discard(){
  const file=active?.file;
  if(!file)return;
  active.file=null;
  try{if(file.fd!==null)closeSync(file.fd);}
  finally{if(file.temp&&fs.stat(file.temp))unlinkSync(file.temp);}
 }
 function expire(){
  if(!busy&&active&&now()-active.touched>=idleTimeout){
   try{discard();}finally{active=null;}
  }
 }
 const timer=setInterval(()=>{try{expire();}catch{/* do not expose replica paths */}},15_000);
 timer.unref();
 const owned=(scope,relative,create=false)=>{
  const parent=dirname(relative);
  return fs.directory(root,parent==='.'?scope:scope+'/'+parent,create);
 };
 async function current(scope,relative){
  return owned(scope,relative)?await fs.digest(join(root,scope,relative)):null;
 }
 async function begin(args){
  if(!exact(args,'scope')||!safeScope(args.scope)||!allowed.has(args.scope))fail('NGS_FILE_SYNC_SCOPE_DENIED',403);
  if(active)fail('NGS_FILE_SYNC_BUSY',409);
  // A fresh scan replaces the project hash table even when all bytes match
  // the last push. Only the selected project is touched.
  const files=await fs.inventory(root,args.scope),inventoryAt=wall();
  if(!Number.isSafeInteger(inventoryAt)||inventoryAt<0)fail('NGS_FILE_SYNC_UNAVAILABLE',503);
  let manifestBytes=2;
  const rows=[...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,sha256])=>{
   const row={path,sha256};manifestBytes+=Buffer.byteLength(JSON.stringify(row))+1;
   if(manifestBytes>maxInventoryBytes)fail('NGS_FILE_SYNC_UNAVAILABLE',503);
   return row;
  });
  inventories.set(args.scope,{files,inventoryAt,updatedAt:inventoryAt});
  active={syncId:'ngs.sync.'+randomUUID(),scope:args.scope,inventory:inventories.get(args.scope),file:null,written:0,removed:new Map(),uploaded:new Set(),touched:now()};
  return {syncId:active.syncId,scope:active.scope,inventoryAt,files:rows};
 }
 async function chunk(args,s){
  if(!exact(args,'syncId','path','sha256','size','offset','dataBase64')||!validFolderPath(args.path)||
    !validFolderPath(s.scope+'/'+args.path)||typeof args.sha256!=='string'||args.sha256.length!==64||!hashPattern.test(args.sha256)||
    !Number.isSafeInteger(args.size)||args.size<0||args.size>maxFile||!Number.isSafeInteger(args.offset)||
    args.offset<0||args.offset>args.size||typeof args.dataBase64!=='string'||args.dataBase64.length>4*Math.ceil(chunkSize/3))
   fail();
  const bytes=Buffer.from(args.dataBase64,'base64');
  if(bytes.toString('base64')!==args.dataBase64||bytes.length>chunkSize||bytes.length>args.size-args.offset||
    !bytes.length&&args.size!==0)fail();
  const {path,sha256,size,offset}=args;
  if(s.removed.has(path))stale();
  if(!s.file){
   if(offset!==0)fail('NGS_FILE_SYNC_OFFSET_INVALID',409);
   const before=await current(s.scope,path);
   const seen=s.inventory.files.get(path);
   const same=before?.hash===sha256;
   if(!same&&before?.hash!==seen)stale();
   const file={path,sha256,size,offset:0,before,hash:createHash('sha256'),fd:null,temp:null};
   if(!same){
    const stage=fs.directory(root,'.file-sync-stage',true);
    file.temp=join(stage,'.incoming-'+randomUUID());file.fd=openSync(file.temp,'wx',0o600);
   }
   s.file=file;
  }
  const f=s.file;
  if(f.path!==path||f.sha256!==sha256||f.size!==size||offset!==f.offset)fail('NGS_FILE_SYNC_OFFSET_INVALID',409);
  try{
   if(f.fd!==null)for(let i=0;i<bytes.length;){const written=writeSync(f.fd,bytes,i,bytes.length-i,null);if(!written)fail('NGS_FILE_SYNC_UNAVAILABLE',503);i+=written;}
   f.hash.update(bytes);f.offset+=bytes.length;
   s.touched=now();
   if(f.offset<size)return {nextOffset:f.offset};
   if(f.hash.digest('hex')!==sha256)fail('NGS_FILE_SYNC_CONTENT_MISMATCH',409);
   const live=await current(s.scope,path);
   if(live?.hash!==sha256){
    if(f.fd===null||live?.pin!==f.before?.pin)stale();
    const dest=join(root,s.scope,path),folder=owned(s.scope,path,true);
    if(!folder)stale();
    const header=path==='project.json'||path==='icon.png';
    if(header&&size>(path==='project.json'?64*1024:2*1024*1024))fail('NGS_FILE_SYNC_CONTENT_MISMATCH',409);
    if(header)fs.validateProjectFolderFile(path,readFileSync(f.temp));
    fsyncSync(f.fd);closeSync(f.fd);f.fd=null;
    if(owned(s.scope,path)!==folder||fs.pin(fs.checkedFile(dest))!==(f.before?.pin??null))stale();
    renameSync(f.temp,dest);f.temp=null;s.written++;
   }
   s.inventory.files.set(path,sha256);s.inventory.updatedAt=wall();s.uploaded.add(path);
   discard();
   return {nextOffset:null};
  }catch(e){discard();throw e;}
 }
 async function remove(args,s){
  if(!exact(args,'syncId','path','sha256')||!validFolderPath(args.path)||!validFolderPath(s.scope+'/'+args.path)||
    typeof args.sha256!=='string'||args.sha256.length!==64||!hashPattern.test(args.sha256))fail();
  const {path,sha256}=args;
  if(s.file||s.uploaded.has(path))stale();
  if(s.removed.get(path)===sha256){
   // Do not assert replay absence if a new file appeared since the move.
   if(await current(s.scope,path))stale();
   s.touched=now();return {removed:false};
  }
  if(s.inventory.files.get(path)!==sha256)stale();
  let removed;
  try{removed=await moveReplicaFileToTrash(root,s.scope+'/'+path,sha256);}
  catch(e){if(e?.message==='FOLDER_SYNC_COMPARE_REQUIRED')stale();throw e;}
  s.inventory.files.delete(path);s.inventory.updatedAt=wall();
  s.removed.set(path,sha256);s.touched=now();
  return {removed};
 }
 return {
  async call(name,args){
   if(closed||busy)fail('NGS_FILE_SYNC_BUSY',409);
   expire();busy=true;
   try{
    if(name==='ngs_file_sync_begin')return await begin(args);
    const s=active;
    if(!s||args?.syncId!==s.syncId)fail('NGS_FILE_SYNC_INVALID_SESSION',409);
    if(name===fileSyncChunkTool)return await chunk(args,s);
    if(name==='ngs_file_sync_remove')return await remove(args,s);
    if(!exact(args,'syncId'))fail();
    if(name==='ngs_file_sync_abort'){discard();active=null;return {ok:true};}
    if(name==='ngs_file_sync_finish'){
     if(s.file)fail('NGS_FILE_SYNC_INCOMPLETE',409);
     active=null;return {ok:true,written:s.written};
    }
    fail();
   }finally{busy=false;if(closed){try{discard();}finally{active=null;}}}
  },
  close(){closed=true;clearInterval(timer);inventories.clear();if(!busy){try{discard();}finally{active=null;}}},
 };
}
