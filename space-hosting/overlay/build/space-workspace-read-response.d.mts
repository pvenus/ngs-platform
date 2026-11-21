type Storage = {
 list(prefix?:string):Promise<{path:string;sha256:string}[]>;
 head(path:string):Promise<R2Object|null>;
 get(path:string,options?:R2GetOptions):Promise<R2ObjectBody|null>;
 readVerifiedPng?(path:string,sha256:string,max:number):Promise<Uint8Array|null|undefined>;
};
type User={userId:string;email:string};
type ReadOptions={query:URLSearchParams;authorize:(id:string)=>Promise<void>;openProject:(id:string)=>unknown;mediaCache?:boolean};
export function spaceWorkspaceReadResponse(request:Request,replica:Storage|undefined,options:{
 authorize:(user:User,projectId:string,resource:string|null)=>Promise<boolean>;
 npcRead?:(options:ReadOptions)=>Promise<unknown>;
}):Promise<Response|null>;
