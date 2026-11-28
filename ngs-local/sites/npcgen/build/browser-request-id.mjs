// Web Crypto's random bytes work on trusted loopback, HTTPS, and private-LAN
// HTTP. randomUUID itself is restricted to secure contexts.
export function browserRequestId(source=globalThis.crypto){
 const bytes=source.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]&15)|64;
 bytes[8]=(bytes[8]&63)|128;
 const h=Array.from(bytes,v=>v.toString(16).padStart(2,'0')).join('');
 return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);
}
