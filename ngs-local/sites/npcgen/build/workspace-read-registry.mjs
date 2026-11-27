/** All file-backed workspace audiences receive identical route contracts. */
import {assemblyPath} from './assembly-contract.mjs';
import {assemblyWorkspaceRead} from './assembly-workspace.mjs';
import {mapPath,mapWorkspaceRead} from './map-workspace.mjs';
import {cinematicWorkspaceRead} from './cinematic-workspace.mjs';
import {backgroundPath} from './cinematic-sequence-contract.mjs';
import {backgroundWorkspaceRead} from './background-workspace.mjs';
import {cinematicPath} from './cinematic-contract.mjs';
import {workspaceRead} from './project-workspace-view.mjs';
import {propWorkspaceRead} from './prop-workspace.mjs';
import {npcWorkspaceRead} from './npc-workspace.mjs';
export const workspaceReadRegistry=Object.freeze({
 '/api/project-workspace':'project',
 '/api/npc-workspace':'npc',
 '/api/prop-workspace':'prop',
 [cinematicPath]:'cinematic',
 [backgroundPath]:'background',
 [mapPath]:'map',
 [assemblyPath]:'assembly',
});
const resourceGrants=Object.freeze({concept:'concept',npcs:'npcs','motion-presets':'npcs'});
export function workspaceReadResource(view){
 return Object.hasOwn(resourceGrants,view)?resourceGrants[view]:null;
}
export function workspaceReadRoute(pathname){
 return Object.hasOwn(workspaceReadRegistry,pathname)?workspaceReadRegistry[pathname]:null;
}
export async function dispatchWorkspaceRead({pathname,query,openProject,authorize,npcRead=npcWorkspaceRead,mediaCache=false}){
 const route=workspaceReadRoute(pathname);
 if(!route)return null;
 const handler=route==='project'?workspaceRead:route==='prop'?propWorkspaceRead:route==='cinematic'?cinematicWorkspaceRead:route==='background'?backgroundWorkspaceRead:route==='map'?mapWorkspaceRead:route==='assembly'?assemblyWorkspaceRead:npcRead;
 if(typeof handler!=='function')throw Object.assign(Error('PROJECT_WORKSPACE_REPLICA_UNAVAILABLE'),{status:503});
 return handler({query,openProject,authorize,...(route==='npc'?{mediaCache}:{})});
}
