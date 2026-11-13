const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
export async function selectNodeBindings(registry,target,flow){
 if(registry.schemaVersion!=='ngs.embedded-story-runtime.v1'||!Array.isArray(registry.sets))throw Error('NGS 정적 실행기 목록을 확인해 주세요.');
 // Canonical declarative puzzle nodes own this episode; old implicit static case pins remain on legacy flows only.
 if(flow.nodes.some(n=>n.puzzleBindingRef))return {};
 const bindings={};
 for(const entry of registry.sets.filter(x=>x.target===target&&!x.testOnly)){
  const node=flow.nodes.find(n=>n.id===entry.nodeId);if(!node)throw Error('상세 실행기의 원본 노드가 없습니다.');
  if(await sha(new TextEncoder().encode(canonical(node)))!==entry.nodeHash)throw Error('노드 원본이 확정본과 달라 재검수가 필요합니다.');
  if(!/^\/story-runtime\/wasm\.[a-f0-9]{24}\/index\.html\?set=set\.[a-z0-9.-]+&revision=[1-9][0-9]*&ngs=1$/.test(entry.runtimeUrl))throw Error('NGS 정적 실행 경로가 올바르지 않습니다.');
  const old=bindings[node.id];if(old&&old.id!==entry.id)throw Error('노드에 서로 다른 확정 세트가 중복 연결됐습니다.');
  if(!old||old.revision<entry.revision)bindings[node.id]=entry;
 }
 return bindings;
}
export async function episodeSaveKey(target,flow,qa){return 'ngs.story.episode.v1.'+target+'.'+await sha(new TextEncoder().encode(canonical(flow)))+(qa?'.qa':'');}
export function readEpisodeSave(raw,target,flow){
 const value=JSON.parse(raw),s=value.session;
 if(value.schemaVersion!=='ngs.story.episode-save.v1'||value.target!==target||canonical(s?.flow)!==canonical(flow)||!flow.nodes.some(n=>n.id===s.nodeId)||!Array.isArray(s.history)||s.history.some(h=>!flow.nodes.some(n=>n.id===h.nodeId))||!s.state||!s.scores||s.pending&&!flow.nodes.find(n=>n.id===s.nodeId)?.choices.some(c=>c.id===s.pending.id))throw Error('이전 스토리 저장 형식이 달라 원본을 유지했습니다.');
 return s;
}

export function storyPlayTarget(search){const q=new URLSearchParams(search),parts=(q.get('requestTarget')||'').split('/');return q.get('request')==='story-play'&&parts.length===3&&parts.every(x=>/^[a-zA-Z0-9._-]+$/.test(x)&&!x.includes('..'))?{act:parts[0],chapter:parts[1],episode:parts[2]}:null;}
