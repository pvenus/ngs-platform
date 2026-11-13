export function mediaReadIdentity(media:{id:string;reader:string;requestId?:string;mime:string;sha256:string;size:number},snapshot:{authorizationScope?:string;projectId?:string;snapshotId?:string}):string;
export class MediaBlobCache{constructor(maxBytes?:number,maxItems?:number);stats:{loads:number;hits:number};get(key:string,load:()=>Promise<Blob>):Promise<Blob>;clear():void;}
