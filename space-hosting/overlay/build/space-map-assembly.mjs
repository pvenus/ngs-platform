export {mapAssemblyAction,validWorkspaceMapAssemblyCommand as validSpaceMapAssemblyCommand,admitWorkspaceMapAssembly as admitSpaceMapAssembly}
 from '../ngs-local/sites/npcgen/build/workspace-map-assembly-admission.mjs';

export function spaceMapAssemblyCapabilities(grant,writable,cinematicSceneDelete=false){
 if(grant?.projectId!=='binari'||!['owner','editor','viewer'].includes(grant.role))return {};
 const editable=writable&&['owner','editor'].includes(grant.role);
 return {mapReadEnabled:true,assemblyReadEnabled:true,
  ...(editable?{mapEnabled:true,assemblyEnabled:true,fileUpdateEnabled:true,mapDeleteEnabled:true,assemblyDeleteEnabled:true,
   npcFolderDeleteEnabled:true,propFolderDeleteEnabled:true,backgroundDeleteEnabled:true,...(cinematicSceneDelete?{cinematicDeleteEnabled:true}:{})}:{})};
}
