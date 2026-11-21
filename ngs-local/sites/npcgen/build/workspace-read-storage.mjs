/** Portable replica contract. A frontend selects the project-scoped adapter. */
const encoder=new TextEncoder();
const jsonLimit=2*1024*1024;
export function replicaUnavailable(){return Object.assign(Error('PROJECT_WORKSPACE_REPLICA_UNAVAILABLE'),{status:503});}
export function validWorkspacePath(value){
 return typeof value==='string'&&value.length<=4096&&value.isWellFormed()&&encoder.encode(value).length<=4096&&
  value.split('/').length<=64&&value.split('/').every(part=>part.length&&encoder.encode(part).length<=255&&
   !part.startsWith('.')&&!/[\\\x00-\x1f\x7f]/.test(part));
}
export async function readReplicaObject(project,path,max=jsonLimit){
 if(!validWorkspacePath(path)||!Number.isSafeInteger(max)||max<2)throw replicaUnavailable();
 const bytes=await project.readBytes(path,max);
 if(bytes===null)return null;
 if(!(bytes instanceof Uint8Array)||bytes.length>max)throw replicaUnavailable();
 try{
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(value&&typeof value==='object'&&!Array.isArray(value))return value;
 }catch{}
 throw replicaUnavailable();
}
export async function hashReplicaBytes(bytes){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function workspaceItemIds(project,relative,wantDir){
 const rows=await project.listChildren(relative);
 if(!Array.isArray(rows)||rows.length>4096)throw replicaUnavailable();
 return rows.flatMap(({name,kind})=>{
  const id=wantDir?name:typeof name==='string'&&name.endsWith('.json')?name.slice(0,-5):null;
  return workspaceItemId(id)&&(wantDir?kind==='directory':kind==='file')?[id]:[];
 }).sort();
}
export const workspaceItemId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)&&validWorkspacePath(value);
