/** Private in-process transport. Every data operation delegates to the hosted replica core. */
import {createObjectReplica} from './object-replica.mjs';
import {parseWholeFileHeaders,wholeFileError} from './replica-whole-file-wire.mjs';

const json=(value,status=200)=>Response.json(value,{status});
const api=new Set(['call','list','head','get','progress','cache-version','cache-read','cache-store']);
const info=o=>({size:o.size,etag:o.etag,customMetadata:o.customMetadata??{}});
function permitted(r,env){
 const cap=r.headers.get('x-ngs-internal');
 return typeof cap==='string'&&cap.length===64&&cap===env.NGS_INTERNAL&&
  !r.headers.has('Origin')&&!r.headers.has('Sec-Fetch-Site');
}
export default {async fetch(r,env){
 if(!permitted(r,env)||r.method!=='POST')return new Response(null,{status:403});
 const url=new URL(r.url);
 if(url.search||!['/call','/raw'].includes(url.pathname))return new Response(null,{status:404});
 const replica=createObjectReplica({db:env.DB,bucket:env.BUCKET,fixedLengthStream:n=>new FixedLengthStream(n)});
 if(url.pathname==='/raw'){
  try{
   const args=parseWholeFileHeaders(name=>r.headers.get(name));
   const stream=r.body??new ReadableStream({start:c=>c.close()});
   return json(await replica.receiveWholeFile(args,stream));
  }catch(e){const result=wholeFileError(e);return json({error:result.error},result.status);}
 }
 try{
  const value=await r.json(),op=value?.op,args=value?.args;
  if(!api.has(op)||!Array.isArray(args)||args.length>3)return json({error:'NGS_MINIFLARE_INVALID'},400);
  if(op==='get'){
   const o=await replica.get(...args);
   return o?new Response(o.body,{headers:{'x-ngs-storage-meta':JSON.stringify(info(o))}}):new Response(null,{status:404});
  }
  if(op==='head'){
   const o=await replica.head(...args);return json({value:o?info(o):null});
  }
  if(op.startsWith('cache-')){
   const member={version:'version',read:'read',store:'store'}[op.slice(6)];
   return json({value:(await replica.npcCache[member](...args))??null});
  }
  return json({value:(await replica[op](...args))??null});
 }catch(e){
  const status=Number.isInteger(e?.status)&&e.status>=400&&e.status<500?e.status:503;
  return json({error:status<500&&/^[A-Z0-9_]+$/.test(e.message)?e.message:'NGS_MINIFLARE_UNAVAILABLE'},status);
 }
}};
