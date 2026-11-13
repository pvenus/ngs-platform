import {requirePrivateIdentitySection} from './private-identity-state.mjs';
const issued=new WeakSet();
const fail=()=>{throw Object.assign(Error('PORTRAIT_AUTHORITY_DENIED'),{status:403})};
/** Called only after the existing server authentication resolves a participant. */
export function issuePortraitAuthority(actorId,policy){if(!policy||!Array.isArray(policy.participants)||policy.enabled!==true||policy.projectId!=='binari'||policy.siteProjectId!==requirePrivateIdentitySection('siteProjectId')||policy.policyRevision!==3||policy.participants.length!==3||new Set(policy.participants.map(p=>p.canonicalActor)).size!==3)fail();const grant=policy.participants.find(p=>p.canonicalActor===actorId);if(!grant||!['owner','viewer'].includes(grant.role))fail();const value=Object.freeze({actorId,projectId:'binari',siteProjectId:policy.siteProjectId,policyRevision:3,role:grant.role,npcIds:Object.freeze(['character.seojin'])});issued.add(value);return value;}
/** Local-only NPC selection scope. Existing admitted participant and exact runtime identity remain required. */
export function issueLocalPortraitAuthority(principal,policy,runtime){
 const base=issuePortraitAuthority(principal?.actorId,policy),approval=runtime?.writeAuthorization;
 if(runtime.npcSelectionScope!=='existing-project-npcs'||runtime.projectId!==base.projectId||approval?.approved!==true||approval.operation!=='portrait.generation.confirm'||approval.provider!=='local'||principal?.provider!=='local'||approval.subject!==principal.subject||approval.projectId!==base.projectId||approval.resource!=='npcs')fail();
 const value=Object.freeze({...base,provider:'local',npcSelectionScope:'existing-project-npcs'});issued.add(value);return value;
}
export function assertPortraitAuthority(value){if(!value||!issued.has(value))fail();return value;}
