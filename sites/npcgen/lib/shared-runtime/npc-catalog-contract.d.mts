export const npcCatalogLabels:Record<string,string>;
export function npcCatalogRead(operation:string,payload?:Record<string,unknown>):Record<string,unknown>;
export function verifyNpcCatalog(v:any):Promise<any>;
export function npcCatalogHref(href:string,catalog:any,npcId:string,options?:{switching?:boolean}):URL;
export function npcAuthoringAllowed(catalog:any,targets:any,npcId:string):boolean;
