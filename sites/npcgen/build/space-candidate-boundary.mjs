/** Unconfigured hosted shell boundary. This is not a Space-to-local transport. */
const MARKER = Object.freeze({
  schemaVersion: 'ngs.space-candidate.v1',
  target: 'space',
  configuration: 'unconfigured',
  deployable: false,
  operationalRelease: false,
  backendConnected: false,
});
export const spaceCandidateMarker = MARKER;
const BLOCKED = new Set(['api', 'mcp', 'assembly-runtime', 'story-runtime', 'case-assets']);
const HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-NPCGen-Deployment-State': 'unconfigured-candidate',
};
function json(request, value, status = 503) {
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(value), {
    status,
    headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function pathname(request) {
  try {
    const path = decodeURIComponent(new URL(request.url).pathname);
    // Never forward alternate spellings that downstream routing could normalize differently.
    if (/[\\\u0000-\u0020\u007f%]/.test(path) || path.includes('//') || path.split('/').some(p => p === '.' || p === '..')) return null;
    return path;
  } catch { return null; }
}
/** Returns a response for every stateful/unconfigured surface, null for GET/HEAD shell assets. */
export function spaceCandidateBoundary(request) {
  const path = pathname(request);
  if (path === null) return json(request, { error: 'SPACE_PATH_INVALID' }, 400);
  if (path === '/__npcgen_session' && request.method === 'GET') {
    return json(request, {
      schemaVersion: 'npc-frontend-session.v1', mode: 'space', state: 'unconfigured',
      user: null, contextId: null, authentication: 'unavailable',
      reason: 'SPACE_LOCAL_TRANSPORT_NOT_CONFIGURED',
      localDisconnectSupported: false, localReconnectSupported: false,
      login: { supported: false, reason: 'SPACE_LOCAL_TRANSPORT_NOT_CONFIGURED' },
      logout: { supported: false, reason: 'NO_BACKEND_SESSION' },
    }, 200);
  }
  if (path === '/ngs-release.json' && ['GET', 'HEAD'].includes(request.method)) return json(request, MARKER, 200);
  if (BLOCKED.has(path.split('/')[1].toLowerCase()) || path.startsWith('/__npcgen_')) {
    return json(request, { error: 'SPACE_LOCAL_TRANSPORT_NOT_CONFIGURED' });
  }
  if (['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback'].includes(path)) {
    return json(request, { error: 'SPACE_CANDIDATE_AUTH_NOT_CONFIGURED' });
  }
  // Deny Server Actions as well as API writes. No automatic retries or side effects.
  if (!['GET', 'HEAD'].includes(request.method)) return json(request, { error: 'SPACE_CANDIDATE_READ_ONLY' }, 405);
  return null;
}
export function createSpaceCandidateHandler(shell) {
  return {
    fetch(request, env, ctx) {
      const blocked = spaceCandidateBoundary(request);
      if (blocked) return blocked;
      return shell.fetch(request, env, ctx);
    },
  };
}
