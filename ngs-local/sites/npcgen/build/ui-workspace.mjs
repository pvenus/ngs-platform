/** Read exact published R2/Filex replica files; never browse mutable staging or local authoring paths. */
import {uiId,uiKind,uiSha,uiText,uiPath,uiMaxPng} from './ui-asset-contract.mjs';
import {hashReplicaBytes,readReplicaObject,workspaceItemIds,replicaUnavailable} from './workspace-read-storage.mjs';
const fail=(message,status)=>Object.assign(Error(message),{status});
const root='ui/assets';
const bounded=(n,max)=>Number.isSafeInteger(n)&&n>=1&&n<=max;
const png=[137,80,78,71,13,10,26,10];
const details=(id,r)=>{
 if(!r||r.schemaVersion!=='ngs.ui-asset-result.v1'||r.projectId!=='binari'||r.officialRequestId!==id||!uiKind(r.kind)||
  !uiText(r.title,120)||!uiSha(r.sha256)||!bounded(r.bytes,uiMaxPng)||!bounded(r.width,4096)||!bounded(r.height,4096)||
  !(r.origin==='manual'&&r.designSha256===null||r.origin==='imagegen'&&uiSha(r.designSha256)))return null;
 const url=uiPath+'?'+new URLSearchParams({projectId:'binari',id,sha256:r.sha256});
 return {id,title:r.title,kind:r.kind,sha256:r.sha256,bytes:r.bytes,width:r.width,height:r.height,origin:r.origin,designSha256:r.designSha256,url};
};
async function asset(project,id){
 const manifest=await readReplicaObject(project,root+'/'+id+'/manifest.json',16*1024);
 if(manifest===null)return null;
 const row=details(id,manifest);
 if(!row)throw replicaUnavailable();
 const h=await project.head(root+'/'+id+'/asset.png');
 return h?.size===row.bytes?row:null;
}
export async function uiWorkspaceRead({query,openProject,authorize}){
 const id=query.get('id'),expected=query.get('sha256'),fields=[...query.keys()];
 if(query.get('projectId')!=='binari'||(id!==null&&!uiId(id))||
  (expected!==null&&(!uiSha(expected)||id===null))||
  new Set(fields).size!==fields.length||fields.some(k=>!['projectId','id','sha256'].includes(k)))throw fail('NGS_UI_QUERY_INVALID',400);
 if(await authorize('binari','ui-assets')===false)throw fail('PROJECT_OR_RESOURCE_DENIED',403);
 const project=await openProject('binari');
 if(!project)throw replicaUnavailable();
 if(id){
  const row=await asset(project,id);
  if(!row||expected!==null&&row.sha256!==expected)throw fail('NGS_UI_ASSET_NOT_FOUND',404);
  if(expected===null)return {json:{asset:row}};
  const data=await project.readBytes(root+'/'+id+'/asset.png',row.bytes);
  if(!(data instanceof Uint8Array)||data.length!==row.bytes||data.length<33||!png.every((v,i)=>data[i]===v)||await hashReplicaBytes(data)!==expected)throw replicaUnavailable();
  const header=new DataView(data.buffer,data.byteOffset,data.byteLength);
  if(header.getUint32(16)!==row.width||header.getUint32(20)!==row.height||data[24]!==8||data[25]!==6)throw replicaUnavailable();
  return {bytes:data,mime:'image/png'};
 }
 const ids=(await workspaceItemIds(project,root,true)).filter(uiId).reverse();
 const assets=[];
 for(let i=0;i<ids.length;i+=8)assets.push(...(await Promise.all(ids.slice(i,i+8).map(id=>asset(project,id)))).filter(Boolean));
 return {json:{projectId:'binari',assets}};
}
