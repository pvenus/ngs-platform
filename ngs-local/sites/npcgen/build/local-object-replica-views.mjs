/** Mac session route adapters for the same R2/S3 object view projections. */
import {audioFile,objectAudioSeparationSource,playlist,projectRow,projectIcon} from './object-replica-view.mjs';
import {openObjectWorkspaceProject} from './object-workspace-read-storage.mjs';

const binari='binari';
const invalid=()=>Object.assign(Error('AUDIO_RESULT_INPUT_INVALID'),{status:400});
const unavailable=()=>Object.assign(Error('AUDIO_RESULT_UNAVAILABLE'),{status:503});
const missing=()=>Object.assign(Error('AUDIO_RESULT_NOT_FOUND'),{status:404});

export function localObjectReplicaViews(replica){
 if(!replica||['get','head','list'].some(key=>typeof replica[key]!=='function'))
  throw Error('LOCAL_OBJECT_REPLICA_REQUIRED');
 const catalog={
  async list(allowed){
   if(!allowed(binari))return [];
   const row=await projectRow(replica);
   return row?[row]:[];
  },
  async icon(projectId,sha256){
   if(projectId!==binari)return null;
   const q=new URLSearchParams({projectId,sha256});
   try{
    const response=await projectIcon(new Request('http://127.0.0.1/api/project-folders/icon?'+q),replica,q);
    return Buffer.from(await response.arrayBuffer());
   }catch(error){if(error.status===404)return null;throw error;}
  },
 };
 return {
  catalog,
  audioSeparationSource:payload=>objectAudioSeparationSource(replica,payload),
  openProject:projectId=>openObjectWorkspaceProject(replica,projectId),
  async audio({query,range,authorize}){
   const id=query.get('id'),projectId=query.get('projectId'),params=[...query.keys()].sort().join(',');
   if(!projectId||params!==(id===null?'projectId':'id,projectId,sha256'))throw invalid();
   authorize(projectId);
   if(projectId!==binari)throw missing();
   try{
    if(id===null)return {json:await playlist(replica)};
    const headers=typeof range==='string'?{Range:range}:{};
    return {response:await audioFile(new Request('http://127.0.0.1/api/audio-workspace?'+query,{headers}),replica,query)};
   }catch(error){if(!error.status||error.status===503)throw unavailable();throw error;}
  },
 };
}
