/** Short-lived, port-bound first-party approval for installing a local Viewer. */
import {spaceBrowserSessionValid,validMachineToken} from './space-browser-auth.mjs';
const issue='/api/viewer/install/issue';
const ttl=5*60_000, maxBytes=1024, encode=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/u.test(value);
const portOK=value=>Number.isInteger(value)&&value>=1024&&value<=65535;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'};
const json=(value,status=200)=>Response.json(value,{status,headers});
const fail=(status,error)=>json({error},status);
const need=(ok,status=400,error='VIEWER_INSTALL_INVALID')=>{if(!ok)throw Object.assign(Error(error),{status});};
const signedBytes=(origin,port,digest,expiry)=>encode.encode(JSON.stringify(['ngs.viewer.install.v2',origin,'binari',port,digest,expiry]));
async function readBody(request){
 const length=request.headers.get('content-length');
 need(length===null||/^\d{1,4}$/u.test(length)&&Number(length)<=maxBytes,413,'VIEWER_INSTALL_BODY_TOO_LARGE');
 need(request.headers.get('content-type')==='application/json',415,'JSON_REQUIRED');
 const reader=request.body?.getReader();need(reader);
 const data=new Uint8Array(maxBytes);let size=0;
 try{
  for(;;){
   const {value,done}=await reader.read();if(done)break;
   need(size+value.length<=maxBytes,413,'VIEWER_INSTALL_BODY_TOO_LARGE');
   data.set(value,size);size+=value.length;
  }
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(0,size)));}catch{return null;}
 }finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export async function spaceViewerInstallResponse(request,{secret,signingKey,authorizeParticipant,now=Date.now}={}){
 const url=new URL(request.url);
 if(url.pathname!==issue)return null;
 try{
  need(request.method==='POST',405,'METHOD_NOT_ALLOWED');
  need(!url.search);
  need(request.headers.get('origin')===url.origin&&request.headers.get('sec-fetch-site')!=='cross-site',403,'ORIGIN_FORBIDDEN');
  need(validMachineToken(secret),503,'VIEWER_INSTALL_UNAVAILABLE');
  const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
  need(userId&&email&&userId.length<=200&&email.length<=320,401,'SIGN_IN_REQUIRED');
  need(await authorizeParticipant?.({userId,email})===true,403,'PROJECT_OR_RESOURCE_DENIED');
  need(await spaceBrowserSessionValid(request,secret,userId),403,'CSRF_INVALID');
  const body=await readBody(request);
  need(exact(body,'challengeSha256,port')&&portOK(body.port)&&hash(body.challengeSha256));
  need(typeof signingKey==='string'&&/^[A-Za-z0-9+/]{64}$/u.test(signingKey),503,'VIEWER_INSTALL_UNAVAILABLE');
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(signingKey),c=>c.charCodeAt(0)),{name:'Ed25519'},false,['sign']);
  const expiry=now()+ttl;
  const sig=hex(await crypto.subtle.sign('Ed25519',key,signedBytes(url.origin,body.port,body.challengeSha256,expiry)));
  return json({proof:'v2.'+expiry+'.'+sig,expiresAt:expiry});
 }catch(error){
  const status=[400,401,403,405,413,415].includes(error?.status)?error.status:503;
  return fail(status,status===503?'VIEWER_INSTALL_UNAVAILABLE':error.message);
 }
}
