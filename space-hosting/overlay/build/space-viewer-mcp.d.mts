import type {spaceViewerResponse} from './space-viewer-export.mjs';
export function spaceViewerMcpResponse(request:Request,options:Parameters<typeof spaceViewerResponse>[1]):Promise<Response|null>;
export function appendViewerDiscovery(request:Request,original:Response):Promise<Response>;
