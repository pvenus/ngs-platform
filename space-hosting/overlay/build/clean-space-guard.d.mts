export function rejectCleanSpaceRequest(
 request: Request,
 options?: {
  handoffEnabled?: boolean;
  catalogCall?: (request: Request, message: unknown) => Promise<Response>;
 },
): Response | Promise<Response | null> | null;
