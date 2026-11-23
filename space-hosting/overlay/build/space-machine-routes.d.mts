type Tool={name:string;description:string;inputSchema:unknown};
type FileReplica={call:(name:string,args:unknown)=>Promise<unknown>;receiveWholeFile?:(args:unknown,body:ReadableStream<Uint8Array>)=>Promise<{ok:true}>};
export function machineResponse(request:Request,binding?:{db?:D1Database;secret?:string;fileReplica?:FileReplica;fileTools?:readonly Tool[];commitSha?:string}):Promise<Response|null>;
export function browserQueueResponse(request:Request,binding?:{db?:D1Database;secret?:string;authorize?:(user:{userId:string;email:string})=>Promise<boolean>;authorizeWrite?:(user:{userId:string;email:string})=>Promise<boolean>;replicaReads?:boolean;workspaceReady?:boolean;poseSelectionV2Enabled?:boolean;hasAudioSeparationSource?:(payload:{sourceOfficialRequestId:string;sourceSha256:string})=>Promise<boolean>;hasPublishedNpc?:(user:{userId:string;email:string},npcId:string)=>Promise<boolean>}):Promise<Response|null>;
export function machineTokenConfigured(value:unknown):boolean;
export function spaceQueueParticipant(grant:{projectId:string;role:string}|null|undefined):boolean;
export function authorizeSpaceQueueWrite(user:{userId:string;email:string},participant:(user:{userId:string;email:string})=>Promise<{projectId:string;role:string}>,extraEmailSha256?:string):Promise<boolean>;
