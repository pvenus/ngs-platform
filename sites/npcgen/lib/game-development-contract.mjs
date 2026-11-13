/** Game development has a single deliverable, never a candidate comparison. */
export const gameDevelopmentRoles=Object.freeze(['game-feature-build','game-scene-feature-build','game-presentation-build','puzzle-type-build']);
export const isGameDevelopment=role=>gameDevelopmentRoles.includes(role);
export function gameDevelopmentView(raw){
 const role=raw?.request?.role;if(!isGameDevelopment(role))return null;
 const v=raw.developmentWorkflow;
 if(v?.schemaVersion!=='ngs.game-development-workflow.v1'||v.mode!=='single-development'||v.requestedResults!==1||v.alternativeGeneration!==false||![0,1].includes(v.modelCalls)||raw.candidateSet!==undefined||raw.candidates!==undefined||raw.resultCount!==undefined)throw Error('GAME_DEVELOPMENT_SINGLE_CONTRACT_REQUIRED');
 return v;
}
export const gameDevelopmentContract=Object.freeze({schemaVersion:'ngs.game-development-ui.v1',mode:'single-development',resultCount:1,comparison:false,worker:'ngs.game-development.worker',stages:Object.freeze(['develop','validate','review','register','sync']),serverOwned:Object.freeze(['artifactHash','validation','permissions','registration','sync'])});
