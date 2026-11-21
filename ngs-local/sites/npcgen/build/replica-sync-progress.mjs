/** The shared read-only launcher DTO; each frontend supplies its existing auth. */
export const replicaSyncProgressPath='/api/ngs-sync-progress';
const fail=(status,code)=>{throw Object.assign(Error(code),{status});};
export async function readReplicaSyncProgress({method,query,authorize,read}){
 if(method!=='GET')fail(405,'METHOD_NOT_ALLOWED');
 if(!exactProjectQuery(query))fail(400,'NGS_SYNC_PROGRESS_QUERY_INVALID');
 const projectId=query.get('projectId');
 if(projectId!=='binari'||await authorize(projectId)!==true)fail(403,'PROJECT_OR_RESOURCE_DENIED');
 if(typeof read!=='function')fail(503,'NGS_SYNC_PROGRESS_UNAVAILABLE');
 return await read();
}
function exactProjectQuery(query){
 const keys=[...query.keys()];return keys.length===1&&keys[0]==='projectId'&&Boolean(query.get('projectId'));
}
