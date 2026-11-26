import {exactPropKeys as exact,propSlug,propSha,propRevision} from './prop-workspace-contract.mjs';
export const fileDeleteType='file.delete',fileDeleteSchema='ngs.file-delete.v1';
export const propsDeleteRoot='canonical-files/binari/props';
export function validPropFolderDelete(p){
 const t=p?.target,x=p?.expected;
 return exact(p,['schemaVersion','projectId','target','expected'])&&p.schemaVersion===fileDeleteSchema&&p.projectId==='binari'&&
  exact(t,['root','path','kind'])&&t.root===propsDeleteRoot&&t.kind==='directory'&&propSlug(t.path)&&
  exact(x,['revision','sha256'])&&propRevision(x.revision)&&propSha(x.sha256);
}
export function propFolderDeletePayload({id,expected}){
 const out={schemaVersion:fileDeleteSchema,projectId:'binari',target:{root:propsDeleteRoot,path:id,kind:'directory'},expected};
 if(!validPropFolderDelete(out))throw Error('NGS_PROP_FOLDER_DELETE_PAYLOAD_INVALID');
 return out;
}
