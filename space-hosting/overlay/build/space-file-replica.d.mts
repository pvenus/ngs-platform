import type {ReplicaSyncProgress} from '../ngs-local/sites/npcgen/build/replica-sync-progress.mjs';
export const spaceFileSyncTools:readonly {name:string;description:string;inputSchema:unknown}[];
export function createSpaceFileReplica(options:{db:D1Database;bucket:R2Bucket;cacheOrigin?:string}):{
 call(name:string,args:unknown):Promise<unknown>;
 list(prefix?:string):Promise<{path:string;sha256:string}[]>;
 listWithSizes(prefix?:string):Promise<{path:string;sha256:string;size:number}[]>;
 head(path:string):Promise<R2Object|null>;
 get(path:string,options?:R2GetOptions):Promise<R2ObjectBody|null>;
 progress():Promise<ReplicaSyncProgress>;
 readVerifiedPng(path:string,sha256:string,max:number):Promise<Uint8Array|null|undefined>;
 receiveWholeFile(args:unknown,body:ReadableStream<Uint8Array>):Promise<{ok:true}>;
};
