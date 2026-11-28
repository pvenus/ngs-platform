export const validMachineToken=v=>typeof v==='string'&&v.length===64&&/^[a-f0-9]{64}$/u.test(v);
const utf8=new TextEncoder();
const hex=buffer=>Array.from(new Uint8Array(buffer),v=>v.toString(16).padStart(2,'0')).join('');
const hash=async v=>hex(await crypto.subtle.digest('SHA-256',utf8.encode(v)));
export async function sameToken(a,b){
 if(!validMachineToken(a)||!validMachineToken(b))return false;
 const aa=await hash(a),bb=await hash(b);let difference=0;
 for(let i=0;i<aa.length;i++)difference|=aa.charCodeAt(i)^bb.charCodeAt(i);
 return difference===0;
}
export async function csrf(secret,actor){
 const key=await crypto.subtle.importKey('raw',utf8.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sign=async purpose=>hex(await crypto.subtle.sign('HMAC',key,utf8.encode(JSON.stringify([purpose,'binari',actor]))));
 return {contextId:'space.'+await sign('context.v1'),csrfToken:await sign('csrf.v1')};
}
export async function spaceBrowserSessionValid(request,secret,userId){
 if(!validMachineToken(secret)||typeof userId!=='string'||!userId)return false;
 const actor=await hash(JSON.stringify(['space.queue.actor.v1',userId])),tokens=await csrf(secret,actor);
 return await sameToken(request.headers.get('X-NPCGen-Csrf'),tokens.csrfToken)&&
  request.headers.get('X-NPCGen-Frontend-Context')===tokens.contextId;
}
