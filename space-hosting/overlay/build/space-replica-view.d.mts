import type {createSpaceFileReplica} from "./space-file-replica.mjs";
export function spaceReplicaView(request:Request,replica:ReturnType<typeof createSpaceFileReplica>|undefined,options?:{
 authorize:(user:{userId:string;email:string},projectId:string)=>Promise<boolean>
}):Promise<Response|null>;
