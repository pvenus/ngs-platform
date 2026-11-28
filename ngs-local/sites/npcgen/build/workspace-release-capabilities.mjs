import {propTypes} from './prop-workspace-contract.mjs';

// Product capabilities are part of the deployed artifact, not host settings
// or role grants. Only list features whose request path ships on every target.
const ordinaryWrites=Object.freeze({
 mapEnabled:true,assemblyEnabled:true,fileUpdateEnabled:true,
 mapDeleteEnabled:true,assemblyDeleteEnabled:true,npcFolderDeleteEnabled:true,
 propFolderDeleteEnabled:true,backgroundDeleteEnabled:true,cinematicDeleteEnabled:true,
});
export const workspaceReleaseCapabilities=Object.freeze({
 ...ordinaryWrites,
 cinematicEnabled:true,cinematicSequenceEnabled:true,cinematicPlaybackEnabled:true,
 cinematicSourceEnabled:true,cinematicRemoveEnabled:true,
 backgroundSourceEnabled:true,backgroundPixelEnabled:true,backgroundAnimationEnabled:true,
 propAnimationRemoveEnabled:true,propActions:Object.freeze(Object.keys(propTypes)),
 npcBasicPortraitEnabled:true,poseSelectionV2Enabled:true,
 audioFullLengthEnabled:true,audioSeparationEnabled:true,
});
