/** Presentation lifetime only. Never grants authorization or bypasses frontendFetch.
 * A renewed transport token is not a new user. Server access/snapshot scope checks
 * still run with the renewed token and revoke cached content on actual denial. */
function identity(session){return session?.user?.userId?JSON.stringify([session.mode||'',session.authentication||'',session.user.userId]):session?.contextId||'';}
export function sessionPresentationKey(previous,enabled,session){
 if(!enabled)return 'hosted';
 if(session?.state==='unavailable')return previous;
 return `${session?.state||'loading'}:${identity(session)}`;
}
export function invalidatesSessionPresentation(previous,next){
 if(next.state==='unavailable')return false;
 return next.state!=='authenticated'||!!previous&&identity(previous)!==identity(next);
}
