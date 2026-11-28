/** Viewer owns an independent instance of the same R2/D1 replica as Local NGS. */
import {mkdirSync,lstatSync,realpathSync,rmdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {openViewerMiniflareReplica} from './viewer-miniflare-runtime.mjs';
import {verifyNtfsRoot} from './windows-storage.mjs';

const nativeWindows=process.platform==='win32';
const invalid=()=>Error('VIEWER_REPLICA_PRIVATE_DIRECTORY_REQUIRED');
const canonical=p=>nativeWindows?realpathSync.native(p).toLowerCase()===p.toLowerCase():realpathSync(p)===p;
function privateFolder(path,create){
 if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)throw invalid();
 if(nativeWindows){verifyNtfsRoot(path,{create});return;}
 if(create){
  if(!canonical(dirname(path)))throw invalid();
  try{mkdirSync(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 }
 const stat=lstatSync(path);
 if(stat.uid!==process.getuid()||!stat.isDirectory()||stat.isSymbolicLink()||!canonical(path)||(stat.mode&0o077))throw invalid();
}
function lock(path){
 const dir=join(path,'writer');const owner=join(dir,'owner');
 try{mkdirSync(dir,{mode:0o700});}catch(e){
  if(e.code!=='EEXIST')throw e;
  if(lstatSync(dir).isSymbolicLink()||!canonical(dir)||!lstatSync(owner).isFile())throw invalid();
  const pid=Number(readFileSync(owner,'utf8'));
  if(!Number.isSafeInteger(pid)||pid<1)throw invalid();
  try{process.kill(pid,0);throw invalid();}catch(error){if(error.code!=='ESRCH')throw error;}
  unlinkSync(owner);rmdirSync(dir);mkdirSync(dir,{mode:0o700});
 }
 writeFileSync(owner,String(process.pid),{flag:'wx',mode:0o600});
 return ()=>{unlinkSync(owner);rmdirSync(dir);};
}
export async function openViewerReplica(root,{create=false,load}={}){
 privateFolder(root,create);
 const storage=join(root,'miniflare-replica');
 privateFolder(storage,true);
 const release=lock(storage);
 try{
  const object=await openViewerMiniflareReplica({persistRoot:storage,verifyRoot:path=>privateFolder(path,false),load});
  return {replica:object.replica,close:async()=>{try{await object.close();}finally{release();}}};
 }catch(e){release();throw e;}
}
