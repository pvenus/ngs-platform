const help=document.querySelector('#viewer-setup-status'),connect=document.querySelector('#viewer-setup-link');
const config=await (await fetch('/config',{cache:'no-store'})).json();
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),p=>p.toString(16).padStart(2,'0')).join('');
const {spaceOrigin,port,challengeSha256,key}=config;
let popup,nonce,id,timer,active=false;
const say=s=>{help.textContent=s;};
connect.addEventListener('click',()=>{
 nonce=random();id=undefined;active=false;clearTimeout(timer);
 popup=window.open(spaceOrigin+'/viewer/bridge#'+nonce+'.'+port,'ngs-viewer-install-'+port,'popup,width=540,height=620');
 if(!popup){say('팝업을 허용한 뒤 다시 시도하세요.');return;}
 say('Space 창에서 팀 계정으로 로그인하고 연결을 승인하세요.');
});
window.addEventListener('message',async event=>{
 const m=event.data;
 if(!popup||event.source!==popup||event.origin!==spaceOrigin||!m||m.nonce!==nonce)return;
 if(m.type==='ngs-viewer.ready.v1'&&!id){
  id=random();
  popup.postMessage({type:'ngs-viewer.request.v1',nonce,id,path:'/api/viewer/install/issue',method:'POST',
   headers:{'Content-Type':'application/json','X-NPCGen-Csrf':'0'.repeat(64),'X-NPCGen-Frontend-Context':'space.'+'0'.repeat(64)},
   body:JSON.stringify({port,challengeSha256})},spaceOrigin);
  timer=setTimeout(()=>say('Space 응답을 확인하지 못했어요. 다시 연결해 주세요.'),20_000);
 }
 if(m.type!=='ngs-viewer.response.v1'||!id||m.id!==id||active)return;
 active=true;clearTimeout(timer);
 try{
  if(m.status!==200||!(m.body instanceof ArrayBuffer)||m.body.byteLength>1024)throw Error();
  const answer=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(m.body));
  if(typeof answer.proof!=='string')throw Error();
  const verify=await fetch('/verify',{method:'POST',headers:{'Content-Type':'application/json','x-ngs-viewer-key':key},
   body:JSON.stringify({proof:answer.proof})});
  if(!verify.ok||(await verify.json()).authorized!==true)throw Error();
  connect.disabled=true;say('Space 팀원 인증을 확인했어요. 터미널에서 자동 실행 등록 결과를 확인하세요.');
 }catch{say('팀원 인증을 확인하지 못했어요. 서비스는 등록되지 않습니다.');}
});
