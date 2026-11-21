/** Local filesystem binding for the shared NPC presentation. */
import {npcWorkspaceRead} from './npc-workspace.mjs';
import {openLocalWorkspaceProject} from './local-project-workspace.mjs';

export {isOptionalNpcMediaScope} from './npc-workspace.mjs';
export const localNpcWorkspace=({root,query,authorize})=>npcWorkspaceRead({
 openProject:projectId=>openLocalWorkspaceProject(root,projectId),query,authorize,
});
