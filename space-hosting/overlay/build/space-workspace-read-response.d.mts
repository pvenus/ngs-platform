type Storage = {
 list(prefix?:string):Promise<{path:string;sha256:string}[]>;
 head(path:string):Promise<R2Object|null>;
 get(path:string,options?:R2GetOptions):Promise<R2ObjectBody|null>;
};
type User={userId:string;email:string};
type ReadOptions={query:URLSearchParams;authorize:(id:string)=>Promise<void>;openProject:(id:string)=>unknown};
export function spaceWorkspaceReadResponse(request:Request,replica:Storage|undefined,options:{
 authorize:(user:User,projectId:string,view:string)=>Promise<boolean>;
 npcRead?:(options:ReadOptions)=>Promise<unknown>;
}):Promise<Response|null>;
