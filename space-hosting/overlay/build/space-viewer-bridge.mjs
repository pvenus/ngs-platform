/** Runs only on the authenticated Space origin. No credentials cross to localhost. */
const defaultViewerPort=5281;
const installIssue='/api/viewer/install/issue';
const prefix='ngs-viewer.';
const noQuery=new Set(['/__npcgen_session','/api/project-folders','/api/viewer/manifest','/api/space/audio-concepts']);
const keysByPath=new Map([
 ['/api/viewer/file',new Set(['path','sha256','offset'])],
 ['/api/requests',new Set(['queueId'])],
 ['/api/space/project-catalog',new Set(['requestId'])],
 ['/api/ngs-sync-progress',new Set(['projectId'])],
 ['/api/project-folders/icon',new Set(['projectId'])],
 ['/api/cinematic-delete-inventory',new Set(['projectId','sourceSha256'])],
]);
const returnHeaders=new Set(['content-type','content-length','content-range','accept-ranges','etag',
 'x-ngs-file-size','x-ngs-file-sha256','x-ngs-file-offset','retry-after']);
const csrfPlaceholder='0'.repeat(64),contextPlaceholder='space.'+'0'.repeat(64);
const fail=(status,error)=>Response.json({error},{status});
const maxResponse=24*1024*1024;
const encoder=new TextEncoder();

export function checkedRelay(message,origin,viewerPort=defaultViewerPort){
 if(!message||typeof message!=='object'||Array.isArray(message)||typeof message.path!=='string'||
    !message.path.startsWith('/')||message.path.startsWith('//')||message.path.length>4096||
    message.path.includes('#')||/[\\\u0000-\u0020\u007f]/u.test(message.path))return null;
 const url=new URL(message.path,origin);
 if(url.origin!==origin||url.pathname+url.search!==message.path)return null;
 const method=message.method;
 if(!['GET','HEAD','POST'].includes(method))return null;
 const reqHeaders=message.headers??{};
 if(!reqHeaders||typeof reqHeaders!=='object'||Array.isArray(reqHeaders)||Object.keys(reqHeaders).length>4)return null;
 const headers=new Headers();
 for(const [key,val] of Object.entries(reqHeaders)){
  const name=key.toLowerCase();
  if(headers.has(name)||typeof val!=='string'||val.length>256||/[\u0000-\u001f\u007f]/u.test(val))return null;
  if(name==='accept'||(method==='POST'&&['content-type','x-npcgen-csrf','x-npcgen-frontend-context'].includes(name)))headers.set(name,val);
  else return null;
 }
 if(method==='POST'){
  if(!['/api/requests',installIssue].includes(url.pathname)||url.search||
     headers.get('x-npcgen-csrf')!==csrfPlaceholder||headers.get('x-npcgen-frontend-context')!==contextPlaceholder||
     headers.get('content-type')!=='application/json'||typeof message.body!=='string'||
     message.body.length>64*1024||!message.body.isWellFormed()||encoder.encode(message.body).length>64*1024)return null;
  if(url.pathname===installIssue){
   if(message.body.length>256)return null;
   let approval;
   try{approval=JSON.parse(message.body);}catch{return null;}
   if(!approval||Object.keys(approval).sort().join(',')!=='challengeSha256,port'||
    approval.port!==viewerPort||typeof approval.challengeSha256!=='string'||!/^[a-f0-9]{64}$/u.test(approval.challengeSha256))return null;
  }
 }else{
  if(message.body!==undefined&&message.body!==null)return null;
  if(method==='HEAD'&&!['/api/project-folders','/api/project-folders/icon'].includes(url.pathname))return null;
  const permitted=keysByPath.get(url.pathname);
  const query=[...url.searchParams.keys()];
  if(!noQuery.has(url.pathname)&&!permitted||noQuery.has(url.pathname)&&url.search||
     permitted&&(query.some(k=>!permitted.has(k))||query.length!==new Set(query).size))return null;
 }
 return {url,method,headers,body:method==='POST'?message.body:undefined};
}

export async function relayFetch(spec,request=fetch){
 const opts={cache:'no-store',credentials:'same-origin',redirect:'error'};
 const session=new URL('/__npcgen_session',spec.url);
 if(spec.method==='POST'){
  // Session/CSRF material stays in this same-origin tab. Native queue
  // authorizes, validates, and commits each request as the actual team actor.
  const current=await request(session,opts);
  if(!current.ok)return fail(current.status,current.status===401?'SIGN_IN_REQUIRED':'VIEWER_SPACE_SESSION_UNAVAILABLE');
  const s=await current.json();
  if(s?.state!=='authenticated'||s?.backend!=='space'||(spec.url.pathname!==installIssue&&s?.requestWritable!==true))return fail(403,'VIEWER_SPACE_REQUEST_DENIED');
  if(typeof s.csrfToken!=='string'||typeof s.contextId!=='string')return fail(503,'VIEWER_SPACE_SESSION_UNAVAILABLE');
  spec.headers.set('x-npcgen-csrf',s.csrfToken);
  spec.headers.set('x-npcgen-frontend-context',s.contextId);
 }
 const response=await request(spec.url,{...opts,method:spec.method,headers:spec.headers,...(spec.body===undefined?{}:{body:spec.body})});
 if(spec.url.pathname==='/__npcgen_session'&&response.ok){
  const session=await response.json();
  if(!session||session.backend!=='space'||session.state!=='authenticated'||
    typeof session.csrfToken!=='string'||typeof session.contextId!=='string')return fail(503,'VIEWER_SPACE_SESSION_UNAVAILABLE');
  return Response.json({...session,csrfToken:csrfPlaceholder,contextId:contextPlaceholder},{status:response.status});
 }
 return response;
}
async function checkedBytes(response){
 if(!response.body)return new ArrayBuffer(0);
 if(Number(response.headers.get('content-length'))>maxResponse){await response.body.cancel();throw Error('VIEWER_RESPONSE_LIMIT');}
 const r=response.body.getReader(),chunks=[];
 let size=0;
 try{
  for(;;){const {value,done}=await r.read();if(done)break;
   size+=value.byteLength;
   if(size>maxResponse)throw Error('VIEWER_RESPONSE_LIMIT');
   chunks.push(value);
  }
 }finally{await r.cancel().catch(()=>{});r.releaseLock();}
 const out=new Uint8Array(size);let at=0;
 for(const chunk of chunks){out.set(chunk,at);at+=chunk.length;}
 return out.buffer;
}
export function runBridge(runtime=globalThis){
 const {window,document,location}=runtime;
 const request=runtime.fetch??fetch;
 const node=document.getElementById('viewer-status'),button=document.getElementById('viewer-allow');
 const peer=window.opener,fragment=/^#([a-f0-9]{64})(?:\.([1-9][0-9]{3,4}))?$/u.exec(location.hash);
 const nonce=fragment?.[1],port=fragment?.[2]?Number(fragment[2]):defaultViewerPort;
 const viewerOrigin='http://127.0.0.1:'+port;
 if(window.top!==window||!peer||!nonce||port<1024||port>65535){
  button.hidden=true;
  node.textContent='로컬 Viewer의 연결 버튼으로 이 창을 다시 열어 주세요.';
  return;
 }
 const seen=new Set();let active=0,approved=false;
 const respond=(id,status,headers,body)=>{if(!peer.closed)peer.postMessage({type:prefix+'response.v1',nonce,id,status,headers,body},viewerOrigin,[body]);};
 const error=async(id,status,error)=>respond(id,status,{'content-type':'application/json'},encoder.encode(JSON.stringify({error})).buffer);
 runtime.addEventListener('message',async event=>{
  if(!approved||event.origin!==viewerOrigin||event.source!==peer)return;
  const m=event.data;
  if(m?.type!==prefix+'request.v1'||m.nonce!==nonce||
     typeof m.id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/u.test(m.id)||seen.has(m.id))return;
  const id=m.id;
  let spec;
  try{spec=checkedRelay(m,location.origin,port);}catch{spec=null;}
  if(!spec){await error(id,403,'VIEWER_RELAY_ROUTE_DENIED');return;}
  if(active>=8){await error(id,503,'VIEWER_RELAY_BUSY');return;}
  seen.add(id);
  if(seen.size>4096)seen.delete(seen.values().next().value);
  active++;
  try{
   const response=await relayFetch(spec,request);
   const headers=Object.fromEntries([...response.headers].filter(([k])=>returnHeaders.has(k)));
   respond(id,response.status,headers,await checkedBytes(response));
   if(response.status===401)node.textContent='Space 로그인이 만료됐어요. 로그인 후 로컬 Viewer에서 다시 연결하세요.';
  }catch{await error(id,503,'VIEWER_SPACE_RESPONSE_UNAVAILABLE');}
  finally{active--;}
 });
 button.addEventListener('click',event=>{
  if(!event.isTrusted||approved)return;
  approved=true;button.hidden=true;
  const ready=()=>peer.postMessage({type:prefix+'ready.v1',nonce},viewerOrigin);
  ready();
  const timer=runtime.setInterval(()=>{if(peer.closed)runtime.clearInterval(timer);else ready();},2000);
  node.textContent='Space와 연결됐어요. Viewer를 사용하는 동안 이 창을 열어 두세요.';
 });
}
if(typeof window!=='undefined')runBridge();
