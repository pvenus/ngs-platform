const nativeFetch=window.fetch.bind(window), status=document.querySelector('#viewer-state');
const connect=document.querySelector('#viewer-link'), sync=document.querySelector('#viewer-sync');
const allowRemote=new Set(['/__npcgen_session','/api/requests','/api/ngs-sync-progress']);
const types={ready:'ngs-viewer.ready.v1',request:'ngs-viewer.request.v1',response:'ngs-viewer.response.v1'};
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');

const config=await (await nativeFetch('/__viewer/config',{cache:'no-store'})).json();
const key=config.guardKey, space=config.spaceOrigin;
const storageKey='ngs-viewer.bridge-nonce.v1';
const port=Number(location.port)||config.port||5281;
let nonce=sessionStorage.getItem(storageKey),popup,ready=false,booted=false,syncing=false,timer=null,deadline;
const pending=new Map();
function update(text){status.textContent=text;}
function rejectAll(reason){for(const p of pending.values())p.stop(Error(reason));}
async function local(path,input,raw=false,extra={}){
 const headers={'x-ngs-viewer-key':key,'Content-Type':raw?'application/octet-stream':'application/json',...extra};
 const response=await nativeFetch('/__viewer/'+path,{method:'POST',headers,cache:'no-store',body:raw?input:JSON.stringify(input)});
 if(!response.ok)throw Error((await response.json().catch(()=>null))?.error??'VIEWER_LOCAL_UNAVAILABLE');
 return response.json();
}
function remote(path,method='GET',headers={},body,signal){
 if(!ready||!popup||popup.closed)return Promise.reject(Error('VIEWER_SPACE_LINK_REQUIRED'));
 if(signal?.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{
  const id=random();
  const stop=error=>{
   if(!pending.has(id))return;
   pending.delete(id);clearTimeout(timeout);signal?.removeEventListener('abort',onAbort);
   if(error)reject(error);
  };
  const onAbort=()=>stop(signal.reason??Error('VIEWER_REQUEST_CANCELED'));
  const timeout=setTimeout(()=>stop(Error(method==='POST'?'VIEWER_SPACE_REQUEST_UNCERTAIN':'VIEWER_SPACE_READ_TIMEOUT')),30_000);
  pending.set(id,{stop,deliver(message){
   stop();
   if(!Number.isInteger(message.status)||message.status<200||message.status>599||!(message.body instanceof ArrayBuffer)){
    reject(Error('VIEWER_SPACE_RESPONSE_INVALID'));return;
   }
   const init={status:message.status,headers:message.headers};
   resolve(new Response([204,205,304].includes(message.status)?null:message.body,init));
  }});
  signal?.addEventListener('abort',onAbort,{once:true});
  try{popup.postMessage({type:types.request,nonce,id,method,path,headers,...(body===undefined?{}:{body})},space);}
  catch(e){stop(e);}
 });
}
window.addEventListener('message',event=>{
 if(event.origin!==space||!event.source||!event.data||event.data.nonce!==nonce||!nonce)return;
 if(popup&&event.source!==popup)return;
 if(event.data.type===types.response&&popup)pending.get(event.data.id)?.deliver(event.data);
 if(event.data.type!==types.ready||ready)return;
 popup=event.source; ready=true; sync.disabled=false;clearTimeout(deadline);
 void refresh();
});

window.fetch=async (input,init)=>{
 const request=new Request(input,init);
 const url=new URL(request.url,location.origin);
 if(url.origin!==location.origin||!allowRemote.has(url.pathname))return nativeFetch(input,init);
 return remote(url.pathname+url.search,request.method,Object.fromEntries([...request.headers].filter(([name])=>
   ['content-type','accept','x-npcgen-csrf','x-npcgen-frontend-context'].includes(name))),
   request.method==='GET'||request.method==='HEAD'?undefined:await request.text(),request.signal);
};

connect.addEventListener('click',()=>{
 rejectAll('VIEWER_SPACE_LINK_CHANGED');ready=false;sync.disabled=true;
 void local('disconnect',{}).catch(()=>{});
 nonce=random();sessionStorage.setItem(storageKey,nonce);
 popup=window.open(space+'/viewer/bridge#'+nonce+'.'+port,'ngs-viewer-space-'+port,'popup,width=540,height=620');
 if(!popup){update('팝업이 차단됐어요. 팝업을 허용한 뒤 다시 연결하세요.');return;}
 update('Space 창에서 팀 계정으로 로그인하고 연결을 승인하세요.');
 clearTimeout(deadline);
 deadline=setTimeout(()=>{if(!ready)update('Space 승인 대기 중이에요. 로그인한 뒤 필요하면 다시 연결하세요.');},20_000);
});
sync.addEventListener('click',()=>void refresh());

async function relay(id,job){
 let status=503,bytes=new ArrayBuffer(0),headers={};
 try{
  const r=await remote(job.path);
  status=r.status;
  bytes=await r.arrayBuffer();
  for(const name of ['x-ngs-file-size','x-ngs-file-sha256','x-ngs-file-offset']){
   const value=r.headers.get(name);
   if(value!==null)headers[name]=value;
  }
 }catch{}
 await local('sync/reply?'+new URLSearchParams({id,job:job.id}),bytes,true,
  {'x-ngs-viewer-upstream-status':String(status),...headers});
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function refresh(){
 if(syncing||!ready)return;
 syncing=true; sync.disabled=true;connect.disabled=true;clearTimeout(timer);
 const start=performance.now();
 try{
  update('Space 파일과 P2 사본을 비교하는 중…');
  const {id}=await local('sync/start',{});
  const inflight=new Set();
  let installed;
  for(;;){
   const step=await local('sync/poll',{id});
   if(step.state==='completed'){installed=step.result;break;}
   if(step.state==='failed')throw Error(step.error??'VIEWER_SPACE_SYNC_FAILED');
   if(!popup||popup.closed)throw Error('VIEWER_SPACE_ACCESS_LOST');
   for(const job of step.jobs){
    const task=relay(id,job).catch(()=>{});
    inflight.add(task);void task.finally(()=>inflight.delete(task));
   }
   if(inflight.size)await Promise.race(inflight);
   else await delay(120);
  }
  update('Space 연결됨 · P2 파일 '+installed.files+'개 · 변경 '+installed.changed+'개'+
   (installed.failed?' · 실패 '+installed.failed+'개 (다음 동기화에서 다시 시도)':''));
  if(!booted){booted=true;await import('/local-project-page.js');}
  timer=setTimeout(()=>void refresh(),Math.max(0,60_000-(performance.now()-start)));
 }catch(e){
  if(e.message==='VIEWER_SPACE_ACCESS_LOST'||!popup||popup.closed){
   ready=false;popup=null;void local('disconnect',{}).catch(()=>{});
   update('Space 연결이 끊겼어요. 다시 로그인하고 연결해주세요.');
  }else{
   update('동기화를 완료하지 못했어요. 기존 P2 파일은 보존됩니다. 잠시 뒤 다시 시도하세요.');
   timer=setTimeout(()=>void refresh(),Math.max(0,60_000-(performance.now()-start)));
  }
 }finally{syncing=false;sync.disabled=!ready;connect.disabled=false;}
}
if(nonce)update('열려 있는 Space 연결 창을 찾는 중…');
