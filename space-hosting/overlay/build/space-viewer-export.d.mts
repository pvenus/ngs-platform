export function viewerResource(path: string): string | null;
export function spaceViewerResponse(request: Request, options: {
 replica?: unknown;
 authorizeParticipant?: (user: {userId:string;email:string}) => Promise<boolean>;
 authorizeResource?: (user: {userId:string;email:string}, projectId: string, resource: string) => Promise<boolean>;
 bridgeScript?: string;
}): Promise<Response|null>;
