import type {spaceViewerResponse} from './space-viewer-export.mjs';
export function spaceViewerMcpResponse(request:Request,options:Parameters<typeof spaceViewerResponse>[1] & {requestQueue?:(url:URL,identity:Record<string,string>,command?:unknown)=>Promise<Response|null>}):Promise<Response|null>;
export function appendViewerDiscovery(request:Request,original:Response):Promise<Response>;
