import {createHash} from 'node:crypto';
import {uiMaxPng} from './ui-asset-contract.mjs';
const fail=(code,status)=>Object.assign(Error(code),{status});
const signature=Buffer.from('89504e470d0a1a0a','hex');
export async function stageLocalUiPng(bytes,fetcher=fetch){
 if(!Buffer.isBuffer(bytes)||bytes.length<33||bytes.length>uiMaxPng||!bytes.subarray(0,8).equals(signature)||
  bytes.toString('ascii',12,16)!=='IHDR'||bytes[24]!==8||bytes[25]!==6||
  ![bytes.readUInt32BE(16),bytes.readUInt32BE(20)].every(n=>n>0&&n<=4096))throw fail('NGS_UI_PNG_INVALID',422);
 const digest=createHash('sha256').update(bytes).digest('hex');
 let r,out;
 try{
  r=await fetcher('http://127.0.0.1:8030/v1/ui/ownership/staged',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{'Content-Type':'application/json'},body:JSON.stringify({sha256:digest,base64:bytes.toString('base64')})});
  const size=Number(r.headers.get('content-length'));
  if(size>4096)throw Error('Oversized acknowledgement');
  const raw=await r.text();if(raw.length>4096)throw Error('Oversized acknowledgement');out=JSON.parse(raw);
 }catch{throw fail('NGS_UI_STAGING_UNAVAILABLE',503);}
 if(r.status===400||r.status===413||r.status===422)throw fail('NGS_UI_PNG_REJECTED',422);
 if(r.status!==200||out?.ok!==true||out.sha256!==digest)throw fail('NGS_UI_STAGING_UNAVAILABLE',503);
 return {sha256:digest};
}
