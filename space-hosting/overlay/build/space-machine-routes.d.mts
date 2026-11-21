type Tool={name:string;description:string;inputSchema:unknown};
type FileReplica={call:(name:string,args:unknown)=>Promise<unknown>};
export function machineResponse(request:Request,binding?:{db?:D1Database;secret?:string;fileReplica?:FileReplica;fileTools?:readonly Tool[]}):Promise<Response|null>;
export function browserQueueResponse(request:Request,binding?:{db?:D1Database;secret?:string;authorize?:(user:{userId:string;email:string})=>Promise<boolean>;authorizeWrite?:(user:{userId:string;email:string})=>Promise<boolean>;replicaReads?:boolean}):Promise<Response|null>;
export function machineTokenConfigured(value:unknown):boolean;
