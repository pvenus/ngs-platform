export const spaceFileSyncTools:readonly {name:string;description:string;inputSchema:unknown}[];
export function createSpaceFileReplica(options:{db:D1Database;bucket:R2Bucket}):{
 call(name:string,args:unknown):Promise<unknown>;
 list():Promise<{path:string;sha256:string}[]>;
 head(path:string):Promise<R2Object|null>;
 get(path:string,options?:R2GetOptions):Promise<R2ObjectBody|null>;
};
