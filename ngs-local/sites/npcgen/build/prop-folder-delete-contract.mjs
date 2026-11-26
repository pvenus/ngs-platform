import {exactPropKeys as exact,propSlug,propSha,propRevision} from './prop-workspace-contract.mjs';
export const fileDeleteType='file.delete',fileDeleteSchema='ngs.file-delete.v1';
export const propsDeleteRoot='canonical-files/binari/props';
export function validPropFolderDelete(p){
 const t=p?.target,x=p?.expected;
 return exact(p,['schemaVersion','projectId','target','expected'])&&p.schemaVersion===fileDeleteSchema&&p.projectId==='binari'&&
  exact(t,['root','path','kind'])&&t.root===propsDeleteRoot&&t.kind==='directory'&&propSlug(t.path)&&
  exact(x,['revision','sha256'])&&propRevision(x.revision)&&x.revision<=2147483647&&propSha(x.sha256);
}
export function propFolderDeletePayload({id,expected}){
 const out={schemaVersion:fileDeleteSchema,projectId:'binari',target:{root:propsDeleteRoot,path:id,kind:'directory'},expected};
 if(!validPropFolderDelete(out))throw Error('NGS_PROP_FOLDER_DELETE_PAYLOAD_INVALID');
 return out;
}

export const npcDeleteRoot='canonical-files/binari/npcs';
export const isNpcCreationTask=id=>typeof id==='string'&&/^workflow\.task\.[a-f0-9]{64}$/u.test(id);
export function validNpcFolderDelete(p){
 const t=p?.target,x=p?.expected;
 return exact(p,['schemaVersion','projectId','target','expected'])&&p.schemaVersion===fileDeleteSchema&&p.projectId==='binari'&&
  exact(t,['root','path','kind'])&&t.root===npcDeleteRoot&&t.kind==='directory'&&typeof t.path==='string'&&
  /^(?:character|npc|entity|enemy)\.[a-z0-9._-]{2,80}$/u.test(t.path)&&exact(x,['creationTaskId'])&&isNpcCreationTask(x.creationTaskId);
}
export function npcFolderDeletePayload({id,expected}){
 const out={schemaVersion:fileDeleteSchema,projectId:'binari',target:{root:npcDeleteRoot,path:id,kind:'directory'},expected};
 if(!validNpcFolderDelete(out))throw Error('NGS_NPC_FOLDER_DELETE_PAYLOAD_INVALID');
 return out;
}
