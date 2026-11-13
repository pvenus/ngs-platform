const object=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{};
export const assemblyRank=a=>object(a.definition).schemaVersion==='ngs.episode-assembly.v5'?3:object(a.definition).schemaVersion==='ngs.episode-assembly.v4'?2:0;
export function assemblySelection(artifacts,source){
 const versions=artifacts.filter(a=>a.domain==='episode-assembly'&&object(object(a.definition).source).episodeId===source.episodeId).sort((a,b)=>assemblyRank(b)-assemblyRank(a)||String(a.id).localeCompare(String(b.id))||Number(b.version)-Number(a.version));
 const latest=versions.find(a=>{
  if(assemblyRank(a)<2||typeof object(a.export).url!=='string')return false;
  const s=object(object(a.definition).source);
  return ['catalogId','catalogVersion','catalogHash','episodeId','episodeHash'].every(k=>s[k]===source[k])&&Array.isArray(s.nodeIds)&&s.nodeIds.length===source.nodeIds.length&&s.nodeIds.every((id,i)=>id===source.nodeIds[i]);
 });
 return {versions,latest};
}

/** NGS shell restoration only: never executes or rewrites a game save. */
export function assemblyPlayEntry(search,url,projectId){
 const q=new URLSearchParams(search);
 return /^\/assembly-runtime\/formal\.[a-f0-9]+\/index\.html\?/.test(url)&&q.get('request')==='story-play'&&q.get('requestTarget')==='assembly:'+url&&(!q.has('projectId')||q.get('projectId')===projectId);
}

/** Unrelated request/snapshot refreshes must not unmount an immutable catalog/player. */
export function storyCatalogReadKey(query,retry,snapshot){
 return JSON.stringify([query,retry,snapshot.projectId,snapshot.authorizationScope,snapshot.sourceRevisionVector?.story]);
}
