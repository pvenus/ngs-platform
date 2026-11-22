type Tool={name:string;description:string;inputSchema:unknown};
type FileReplica={call:(name:string,args:unknown)=>Promise<unknown>;receiveWholeFile?:(args:unknown,body:ReadableStream<Uint8Array>)=>Promise<{ok:true}>};
export function machineResponse(request:Request,binding?:{db?:D1Database;secret?:string;fileReplica?:FileReplica;fileTools?:readonly Tool[];commitSha?:string}):Promise<Response|null>;
export function browserQueueResponse(request:Request,binding?:{db?:D1Database;secret?:string;authorize?:(user:{userId:string;email:string})=>Promise<boolean>;authorizeWrite?:(user:{userId:string;email:string})=>Promise<boolean>;replicaReads?:boolean;workspaceReady?:boolean}):Promise<Response|null>;
export function machineTokenConfigured(value:unknown):boolean;
export function spaceQueueParticipant(grant:{projectId:string;role:string}|null|undefined):boolean;
