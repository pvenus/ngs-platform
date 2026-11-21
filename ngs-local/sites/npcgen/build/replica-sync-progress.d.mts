export const replicaSyncProgressPath:string;
export type ReplicaSyncProgress={
 state:'idle'|'syncing'|'completed'|'partial'|'failed';fileName:string|null;percent:number|null;
 completed:number;total:number;failed:number;
};
export function readReplicaSyncProgress(options:{
 method:string;query:URLSearchParams;authorize:(projectId:string)=>boolean|Promise<boolean>;
 read?:()=>ReplicaSyncProgress|Promise<ReplicaSyncProgress>;
}):Promise<ReplicaSyncProgress>;
