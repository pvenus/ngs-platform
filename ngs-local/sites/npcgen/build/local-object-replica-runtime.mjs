/** Local composition only. Production defaults to the existing filesystem adapter. */
import {isAbsolute,resolve} from 'node:path';

const required=()=>Error('LOCAL_OBJECT_REPLICA_CONFIGURATION_REQUIRED');
export function localReplicaSelection(env=process.env){
 const mode=env.NGS_REPLICA_STORAGE??'filesystem';
 if(!['filesystem','object'].includes(mode))throw required();
 if(mode==='filesystem')return null;
 const configPath=env.NGS_LOCAL_S3_CONFIG,filename=env.NGS_LOCAL_REPLICA_DB;
 if([configPath,filename].some(path=>typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)||
    filename===configPath||filename===env.NGS_REQUEST_QUEUE_DB)throw required();
 return {configPath,filename};
}

export async function openLocalObjectReplicaFromEnv(env=process.env,{
 writer=false,load=async()=>{
  const [object,s3,sqlite]=await Promise.all([
   import('./object-replica.mjs'),import('./local-s3-replica-bucket.mjs'),import('./replica-sqlite.mjs'),
  ]);
  return {...object,...s3,...sqlite};
 },
}={}){
 const selected=localReplicaSelection(env);
 if(!selected)return null;
 if(writer&&(env.NGS_FILE_SYNC_MODE!=='push'||env.NGS_FILE_SYNC_PROJECTS!=='binari'))throw required();
 const {createObjectReplica,objectReplicaSyncTools,openLocalS3ReplicaBucket,openReplicaSqlite}=await load();
 let bucket,db;
 const close=()=>{
  try{db?.close();}finally{bucket?.close();}
 };
 try{
  bucket=await openLocalS3ReplicaBucket({configPath:selected.configPath});
  db=openReplicaSqlite({filename:selected.filename,readOnly:!writer});
  const complete=createObjectReplica({db,bucket,fixedLengthStream:()=>new TransformStream(),
   writePart:(upload,part,body,length)=>upload.uploadPart(part,body,length),
   writeWhole:(bucket,key,body,size,opts)=>bucket.put(key,body,{...opts,size})});
  if(writer)return {replica:complete,fileSyncToolDefinitions:objectReplicaSyncTools,close};
  return {replica:{list:complete.list,head:complete.head,get:complete.get,progress:complete.progress},close};
 }catch(error){close();throw error;}
}
