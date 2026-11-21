/** Private local replica filesystem primitives shared by NGS and its MCP receiver. */
import {createHash} from 'node:crypto';
import {closeSync,constants,createReadStream,fstatSync,lstatSync,mkdirSync,mkdtempSync,
 openSync,readdirSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {validateProjectFolderFile} from './local-project-folders.mjs';

const maxFile=Number.MAX_SAFE_INTEGER,maxEntries=32768;
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
/** Move exact replica bytes into a same-volume recovery receipt. Callers serialize writers. */
export async function moveReplicaFileToTrash(root,relative,sha256){
 if(!validFolderPath(relative)||!validHash(sha256))throw invalid();
 const parent=dirname(relative),relativeParent=parent==='.'?'':parent,path=join(root,relative);
 const folder=directory(root,relativeParent);
 if(!folder)return false; // Already absent; never create a source directory for a deletion.
 const before=await digest(path);
 if(!before)return false;
 if(before.hash!==sha256)throw stale();
 const trash=checkedDir(join(root,'.deleted-sync'),true);
 if(!trash)throw invalid();
 const staging=checkedDir(mkdtempSync(join(trash,'entry-')),false);
 const target=join(staging,'content'),receipt=join(staging,'receipt.json');
 writeFileSync(receipt,JSON.stringify({relativePath:relative,sha256}),{flag:'wx',mode:0o600,flush:true});
 const current=checkedFile(path);
 if(!current||pin(current)!==before.pin||directory(root,relativeParent)!==folder||
    checkedDir(trash,false)!==trash||checkedDir(staging,false)!==staging||
    stat(staging).dev!==current.dev||stat(target))throw stale();
 renameSync(path,target); // Same-volume atomic, recoverable move. No user bytes are unlinked.
 return true;
}

// Use the same private path, file identity, and integrity checks for offline
// replica reception. Cross-process writer exclusivity is an activation gate.
export const localReplicaFilePrimitives=Object.freeze({stat,pin,directory,checkedFile,digest,inventory,validateProjectFolderFile});
