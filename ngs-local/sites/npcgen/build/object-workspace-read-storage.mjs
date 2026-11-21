/** Object-backed adapter for the shared file port (R2 or local S3 replica). */
import {validWorkspacePath,replicaUnavailable} from './workspace-read-storage.mjs';
const sha=/^[a-f0-9]{64}$/;
const digest=value=>typeof value==='string'&&value.length===64&&sha.test(value);
function checkedMeta(object,max=Number.MAX_SAFE_INTEGER){
 if(object===null)return null;
 if(!object||!Number.isSafeInteger(object.size)||object.size<0||object.size>max||
    !digest(object.customMetadata?.sha256)||typeof object.etag!=='string'||!object.etag)throw replicaUnavailable();
 return object;
}
export function openObjectWorkspaceProject(replica,id){
 if(id!=='binari')return null;
 if(!replica)throw replicaUnavailable();
 const inventories=new Map();
 function listFiles(prefix=''){
  if(prefix&&!validWorkspacePath(prefix))throw replicaUnavailable();
  if(!inventories.has(prefix))inventories.set(prefix,Promise.resolve().then(()=>replica.list(prefix)).then(rows=>{
   if(!Array.isArray(rows)||rows.length>32768||rows.some(row=>!validWorkspacePath(row?.path)||!digest(row?.sha256)))
    throw replicaUnavailable();
   if(new Set(rows.map(row=>row.path)).size!==rows.length||prefix&&rows.some(row=>!row.path.startsWith(prefix+'/')))
    throw replicaUnavailable();
   return rows;
  }));
  return inventories.get(prefix);
 }
 async function head(path){
  if(!validWorkspacePath(path))throw replicaUnavailable();
  const object=checkedMeta(await replica.head(path));return object?{size:object.size,sha256:object.customMetadata.sha256}:null;
 }
 return Object.freeze({
  head,listFiles,
  async listChildren(prefix){
   const rows=await listFiles(prefix),seen=new Map(),start=prefix?prefix.length+1:0;
   for(const {path} of rows){
    const relative=path.slice(start),slash=relative.indexOf('/');
    const name=slash<0?relative:relative.slice(0,slash),kind=slash<0?'file':'directory';
    if(seen.has(name)&&seen.get(name)!==kind)throw replicaUnavailable();
    seen.set(name,kind);
    if(seen.size>4096)throw replicaUnavailable();
   }
   return [...seen].map(([name,kind])=>({name,kind}));
  },
  async readBytes(path,max){
   if(!validWorkspacePath(path)||!Number.isSafeInteger(max)||max<1)throw replicaUnavailable();
   const before=checkedMeta(await replica.head(path),max);
   if(!before)return null;
   const found=checkedMeta(await replica.get(path,{onlyIf:{etagMatches:before.etag}}),max);
   if(!found||found.etag!==before.etag||found.size!==before.size||found.customMetadata.sha256!==before.customMetadata.sha256||
      typeof found.arrayBuffer!=='function')throw replicaUnavailable();
   const bytes=new Uint8Array(await found.arrayBuffer());
   if(bytes.length!==before.size)throw replicaUnavailable();
   return bytes;
  },
 });
}
