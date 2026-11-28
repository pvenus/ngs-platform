/** Short-lived, port-bound first-party approval for installing a local Viewer. */
import {spaceBrowserSessionValid,validMachineToken} from './space-browser-auth.mjs';
const issue='/api/viewer/install/issue',verify='/api/viewer/install/verify';
const ttl=5*60_000, maxBytes=1024, encode=new TextEncoder();
const hex=b=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/u.test(value);
const portOK=value=>Number.isInteger(value)&&value>=1024&&value<=65535;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===keys;
const headers={'cache-control':'private, no-store','x-content-type-options':'nosniff','cross-origin-resource-policy':'same-origin'};
const json=(value,status=200)=>Response.json(value,{status,headers});
const fail=(status,error)=>json({error},status);
const need=(ok,status=400,error='VIEWER_INSTALL_INVALID')=>{if(!ok)throw Object.assign(Error(error),{status});};
const signedBytes=(origin,port,digest,expiry)=>encode.encode(JSON.stringify(['ngs.viewer.install.v1',origin,'binari',port,digest,expiry]));
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
export async function spaceViewerInstallResponse(request,{secret,authorizeParticipant,now=Date.now}={}){
 const url=new URL(request.url),isIssue=url.pathname===issue;
 if(!isIssue&&url.pathname!==verify)return null;
 try{
  need(request.method==='POST',405,'METHOD_NOT_ALLOWED');
  need(!url.search);
  const origin=request.headers.get('origin'),site=request.headers.get('sec-fetch-site');
  need(isIssue?origin===url.origin&&site!=='cross-site':!origin&&site===null,403,'ORIGIN_FORBIDDEN');
  need(validMachineToken(secret),503,'VIEWER_INSTALL_UNAVAILABLE');
  if(isIssue){
   const userId=request.headers.get('oai-authenticated-user-id'),email=request.headers.get('oai-authenticated-user-email');
   need(userId&&email&&userId.length<=200&&email.length<=320,401,'SIGN_IN_REQUIRED');
   need(await authorizeParticipant?.({userId,email})===true,403,'PROJECT_OR_RESOURCE_DENIED');
   need(await spaceBrowserSessionValid(request,secret,userId),403,'CSRF_INVALID');
  }
  const body=await readBody(request);
  need(exact(body,isIssue?'challengeSha256,port':'port,proof,verifier')&&portOK(body.port));
  const key=await crypto.subtle.importKey('raw',encode.encode(secret),{name:'HMAC',hash:'SHA-256'},false,[isIssue?'sign':'verify']);
  const time=now();
  if(isIssue){
   need(hash(body.challengeSha256));
   const expiry=time+ttl;
   const sig=hex(await crypto.subtle.sign('HMAC',key,signedBytes(url.origin,body.port,body.challengeSha256,expiry)));
   return json({proof:'v1.'+expiry+'.'+sig,expiresAt:expiry});
  }
  need(hash(body.verifier)&&typeof body.proof==='string'&&body.proof.length<=90);
  const parsed=/^v1\.([1-9][0-9]{12})\.([a-f0-9]{64})$/u.exec(body.proof);need(parsed);
  const expiry=Number(parsed[1]);
  need(expiry>time&&expiry<=time+ttl,403,'VIEWER_INSTALL_PROOF_DENIED');
  const digest=hex(await crypto.subtle.digest('SHA-256',encode.encode(body.verifier)));
  const signature=Uint8Array.from(parsed[2].match(/../gu),pair=>Number.parseInt(pair,16));
  need(await crypto.subtle.verify('HMAC',key,signature,signedBytes(url.origin,body.port,digest,expiry)),403,'VIEWER_INSTALL_PROOF_DENIED');
  return json({authorized:true});
 }catch(error){
  const status=[400,401,403,405,413,415].includes(error?.status)?error.status:503;
  return fail(status,status===503?'VIEWER_INSTALL_UNAVAILABLE':error.message);
 }
}
