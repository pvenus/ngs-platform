const nativeFetch=window.fetch.bind(window), status=document.querySelector('#viewer-state');
const connect=document.querySelector('#viewer-link'), sync=document.querySelector('#viewer-sync');
const allowRemote=new Set(['/__npcgen_session','/api/requests','/api/ngs-sync-progress']);
const types={ready:'ngs-viewer.ready.v1',request:'ngs-viewer.request.v1',response:'ngs-viewer.response.v1'};
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const oneMiB=1024*1024;
const config=await (await nativeFetch('/__viewer/config',{cache:'no-store'})).json();
const key=config.guardKey, space=config.spaceOrigin;
const storageKey='ngs-viewer.bridge-nonce.v1';
const port=Number(location.port)||config.port||5281;
let nonce=sessionStorage.getItem(storageKey),popup,ready=false,booted=false,syncing=false,timer=null,deadline;
const pending=new Map();
function update(text){status.textContent=text;}
function rejectAll(reason){for(const p of pending.values())p.stop(Error(reason));}
async function local(path,input,raw=false){
 const headers={'x-ngs-viewer-key':key,'Content-Type':raw?'application/octet-stream':'application/json'};
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

async function transfer(row,id){
 let offset=0;
 // An empty file is staged and verified by begin(), with no invalid Range request.
 while(offset<row.size){
  const file=await remote('/api/viewer/file?'+new URLSearchParams({path:row.path,sha256:row.sha256,offset:String(offset)}));
  const n=Math.min(oneMiB,row.size-offset);
  if(!file.ok||file.headers.get('x-ngs-file-size')!==String(row.size)||file.headers.get('x-ngs-file-sha256')!==row.sha256||
     file.headers.get('x-ngs-file-offset')!==String(offset))throw Error(file.status===401||file.status===403?'VIEWER_SPACE_ACCESS_LOST':'VIEWER_SPACE_FILE_CHANGED');
  const bytes=await file.arrayBuffer();
  if(bytes.byteLength!==n)throw Error('VIEWER_SPACE_FILE_CHANGED');
  const ack=await local('chunk?'+new URLSearchParams({syncId:id,path:row.path,offset:String(offset)}),bytes,true);
  if(ack.offset!==offset+n)throw Error('VIEWER_CHUNK_INVALID');
  offset=ack.offset;
 }
}
async function refresh(){
 if(syncing||!ready)return;
 syncing=true; sync.disabled=true;connect.disabled=true;clearTimeout(timer);
 let id;
 try{
  update('Space에서 팀 권한과 P2 파일 목록을 확인 중…');
  const r=await remote('/api/viewer/manifest');
  if(r.status===401||r.status===403)throw Error('VIEWER_SPACE_ACCESS_LOST');
  if(!r.ok)throw Error('VIEWER_SPACE_MANIFEST_FAILED');
  const manifest=await r.json(),delta=await local('begin',manifest);
  id=delta.syncId;
  let next=0,done=0,failed=null;
  await Promise.all(Array.from({length:Math.min(4,delta.files.length)},async()=>{
   while(!failed&&next<delta.files.length){
    try{await transfer(delta.files[next++],id);update('P2에 파일 받는 중 '+(++done)+' / '+delta.files.length);}
    catch(e){failed??=e;}
   }
  }));
  if(failed)throw failed;
  const installed=await local('finish',{syncId:id});id=null;
  update('Space 연결됨 · P2 파일 '+installed.files+'개 · 변경 '+installed.changed+'개');
  if(!booted){booted=true;await import('/local-project-page.js');}
  timer=setTimeout(()=>void refresh(),90_000);
 }catch(e){
  if(id)await local('abort',{syncId:id}).catch(()=>{});
  if(e.message==='VIEWER_SPACE_ACCESS_LOST'||!popup||popup.closed){
   ready=false;popup=null;void local('disconnect',{}).catch(()=>{});
   update('Space 연결이 끊겼어요. 다시 로그인하고 연결해주세요.');
  }else{
   update('동기화를 완료하지 못했어요. 기존 P2 파일은 보존됩니다. 잠시 뒤 다시 시도하세요.');
   timer=setTimeout(()=>void refresh(),90_000);
  }
 }finally{syncing=false;sync.disabled=!ready;connect.disabled=false;}
}
if(nonce)update('열려 있는 Space 연결 창을 찾는 중…');
