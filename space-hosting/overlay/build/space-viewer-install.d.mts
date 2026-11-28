export function spaceViewerInstallResponse(request:Request,options:{
 secret?:string;
 signingKey?:string;
 authorizeParticipant:(user:{userId:string;email:string})=>boolean|Promise<boolean>;
 now?:()=>number;
}):Promise<Response|null>;
