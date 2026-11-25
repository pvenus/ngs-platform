/** Private Node FS adapter. Business projection is shared with Space. */
import {closeSync,constants,fstatSync,lstatSync,openSync,readSync,readdirSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {validWorkspacePath,replicaUnavailable as unavailable} from './workspace-read-storage.mjs';
import {dispatchWorkspaceRead} from './workspace-read-registry.mjs';
import {npcKeys,workspaceMediaLimit as mediaLimit} from './project-workspace-view.mjs';

const uid=process.getuid(),jsonLimit=2*1024*1024,maxFiles=32768;
const own=st=>st.uid===uid&&!(st.mode&0o077);
const pin=s=>s&&[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');

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
function head(root,relative){
 if(!validWorkspacePath(relative))throw unavailable();
 if(!safeDirectory(root,dirname(relative)))return null;
 const st=stat(join(root,relative));
 if(!st)return null;
 if(!st.isFile()||!sameOwner(st)||st.nlink!==1n||st.size>BigInt(Number.MAX_SAFE_INTEGER))return null;
 return {size:Number(st.size),modifiedAtMs:Number(st.mtimeNs/1_000_000n)};
}
function children(root,relative){
 if(relative&&!validWorkspacePath(relative))throw unavailable();
 const dir=safeDirectory(root,relative);
 if(!dir)return [];
 const rows=readdirSync(dir,{withFileTypes:true});
 if(safeDirectory(root,relative)!==dir||rows.length>4096)throw unavailable();
 return rows.flatMap(row=>validWorkspacePath(row.name)&&!row.name.includes('/')&&(row.isFile()||row.isDirectory())?
  [{name:row.name,kind:row.isDirectory()?'directory':'file'}]:[]);
}
function listFiles(root,prefix){
 const files=[];
 function walk(path){
  for(const {name,kind} of children(root,path)){
   const relative=path?path+'/'+name:name;
   if(kind==='directory'){walk(relative);continue;}
   const meta=head(root,relative);
   if(!meta)continue;
   if(files.length>=maxFiles)throw unavailable();
   files.push({path:relative,size:meta.size});
  }
 }
 walk(prefix);return files;
}
function publishedMedia(root,relative){
 try{const meta=head(root,relative);return !!meta&&meta.size<=mediaLimit;}catch{return false;}
}
export function openLocalWorkspaceProject(root,projectId){
 if(!validWorkspacePath(projectId)||projectId.includes('/'))throw unavailable();
 const directory=safeDirectory(root,projectId);
 if(!directory)return null;
 return Object.freeze({
  head:relative=>head(directory,relative),
  listChildren:relative=>children(directory,relative),
  listFiles:relative=>listFiles(directory,relative),
  readBytes(relative,max){
   if(!validWorkspacePath(relative)||!Number.isSafeInteger(max)||max<1)throw unavailable();
   return readBytes(directory,relative,max);
  },
 });
}
export function localProjectWorkspace({root,query,authorize}){
 return dispatchWorkspaceRead({pathname:'/api/project-workspace',openProject:id=>openLocalWorkspaceProject(root,id),query,authorize});
}
// Compatibility for consumers still reading this private Node FS adapter.
export const localWorkspaceReplica=Object.freeze({safeDirectory,readBytes,readObject,publishedMedia,mediaLimit,npcKeys});
