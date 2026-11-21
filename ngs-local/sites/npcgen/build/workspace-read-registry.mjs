/** All file-backed workspace audiences receive identical route contracts. */
import {workspaceRead} from './project-workspace-view.mjs';
export const workspaceReadRegistry=Object.freeze({
 '/api/project-workspace':'project',
 '/api/npc-workspace':'npc',
});
export function workspaceReadRoute(pathname){
 return Object.hasOwn(workspaceReadRegistry,pathname)?workspaceReadRegistry[pathname]:null;
}
export async function dispatchWorkspaceRead({pathname,query,openProject,authorize,npcRead}){
 const route=workspaceReadRoute(pathname);
 if(!route)return null;
 const handler=route==='project'?workspaceRead:npcRead;
 if(typeof handler!=='function')throw Object.assign(Error('PROJECT_WORKSPACE_REPLICA_UNAVAILABLE'),{status:503});
 return handler({query,openProject,authorize});
}
