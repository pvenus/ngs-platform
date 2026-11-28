/** Team-side NGS workspace. No server-side Space session, OPS or write gateway. */
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {assertLoopbackRequest} from '../ngs-local/sites/npcgen/build/loopback-auth.mjs';
import {viewerAssets} from './lib/assets.mjs';
import {localProjection,viewerReadRoute} from './lib/projections.mjs';
import {openMirror} from './lib/mirror.mjs';

export const viewerPort=5281;
export const binariSpace='https://vinus-npcgen.park-venus0518.chatgpt.site';
const oneMiB=1024*1024;
const fault=(code,status)=>Object.assign(Error(code),{status});
const sourceHeaders={'Cache-Control':'private, no-store','X-Frame-Options':'DENY',
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none';"};
async function body(req,max=16*oneMiB){
 const header=req.headers['content-length'];
 if(req.headers['transfer-encoding']||typeof header!=='string'||!/^\d{1,9}$/u.test(header)||Number(header)>max)
  throw fault('VIEWER_BODY_INVALID',400);
 const chunks=[];let len=0;
 for await(const part of req){len+=part.length;if(len>max)throw fault('VIEWER_BODY_INVALID',400);chunks.push(part);}
 if(len!==Number(header))throw fault('VIEWER_BODY_INVALID',400);
 return Buffer.concat(chunks);
}
async function jsonBody(req){
 if(req.headers['content-type']!=='application/json')throw fault('VIEWER_BODY_INVALID',400);
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await body(req)));}catch(e){
  throw e?.status?e:fault('VIEWER_BODY_INVALID',400);
 }
}
const comparator=key=>value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(key));
function spaceRoot(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||
    !/^[a-z0-9-]+\.[a-z0-9-]+\.chatgpt\.site$/u.test(u.hostname))
  throw Error('VIEWER_SPACE_ORIGIN_INVALID');
 return u.origin;
}
async function send(res,response,method){
 res.statusCode=response.status;
 for(const name of ['content-type','content-length','content-range','accept-ranges']){
  const v=response.headers.get(name);if(v!==null)res.setHeader(name,v);
 }
 if(method==='HEAD'||!response.body)return res.end();
 await pipeline(Readable.fromWeb(response.body),res);
}

export async function createViewer({root,space=binariSpace,mirror=null}={}){
 if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root)throw Error('VIEWER_P2_ABSOLUTE_REQUIRED');
 const origin=spaceRoot(space);
 const assets=viewerAssets(), guardKey=randomBytes(32).toString('hex'), validKey=comparator(guardKey);
 const receiver=mirror??await openMirror(root);
 let publishing=false,snapshot=null;
 const server=createServer(async(req,res)=>{
  for(const [k,v] of Object.entries(sourceHeaders))res.setHeader(k,v);
  const json=(status,value)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(value));};
  try{
   const port=server.address()?.port;
   assertLoopbackRequest(req,port,req.method==='POST');
   if(!req.url?.startsWith('/')||req.url.startsWith('//')||req.url.includes('\\'))throw fault('NOT_FOUND',404);
   const url=new URL(req.url,'http://127.0.0.1:'+port);
   const path=url.pathname,method=req.method;
   if(path==='/__viewer/config'&&method==='GET'&&!url.search)
    return json(200,{spaceOrigin:origin,guardKey,committed:snapshot!==null});
   if(path.startsWith('/__viewer/')&&method==='POST'){
    if(!validKey(req.headers['x-ngs-viewer-key']))throw fault('VIEWER_WRITE_DENIED',403);
    if(path==='/__viewer/begin'&&!url.search)return json(200,await receiver.begin(await jsonBody(req)));
    if(path==='/__viewer/chunk'){
     const q=url.searchParams, offset=q.get('offset');
     if([...q.keys()].sort().join(',')!=='offset,path,syncId'||!(/^(0|[1-9]\d{0,15})$/u.test(offset??''))||
        req.headers['content-type']!=='application/octet-stream')throw fault('VIEWER_CHUNK_INVALID',400);
     return json(200,await receiver.append(q.get('syncId'),q.get('path'),Number(offset),await body(req,oneMiB)));
    }
    if((path==='/__viewer/finish'||path==='/__viewer/abort')&&!url.search){
     const v=await jsonBody(req);
     if(!v||Object.keys(v).join(',')!=='syncId')throw fault('VIEWER_SYNC_INVALID',400);
     if(path.endsWith('/abort')){await receiver.abort(v.syncId);return json(200,{ok:true});}
     if(publishing)throw fault('VIEWER_SYNC_BUSY',409);
     publishing=true;
     try{const result=await receiver.finish(v.syncId);snapshot=await receiver.snapshot();return json(200,result);}
     catch(e){snapshot=null;throw e;}
     finally{publishing=false;}
    }
    if(path==='/__viewer/disconnect'&&!url.search){snapshot=null;return json(200,{ok:true});}
    throw fault('NOT_FOUND',404);
   }
   if(viewerReadRoute(path)){
    if(!['GET','HEAD'].includes(method))throw fault('METHOD_NOT_ALLOWED',405);
    if(!snapshot||publishing)throw fault('VIEWER_SYNC_REQUIRED',503);
    return await send(res,await localProjection({root,snapshot,url,method,range:req.headers.range}),method);
   }
   const asset=assets.get(path);
   if(!asset)throw fault('NOT_FOUND',404);
   if(!['GET','HEAD'].includes(method))throw fault('METHOD_NOT_ALLOWED',405);
   if(url.search&&path!=='/')throw fault('NOT_FOUND',404);
   res.setHeader('Content-Type',asset.type);res.end(method==='HEAD'?undefined:asset.body);
  }catch(e){
   if(res.headersSent){res.destroy();return;}
   const status=[400,401,403,404,405,409,413,416,423,429,503].includes(e?.status)?e.status:503;
   return json(status,{error:/^[A-Z0-9_]+$/u.test(e?.message??'')?e.message:'VIEWER_LOCAL_UNAVAILABLE'});
  }
 });
 server.on('close',()=>{void receiver.close?.();});
 return server;
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 const args=process.argv.slice(2);
 try{
  if(args.length!==2||args[0]!=='--p2')throw Error('Usage: npm start -- --p2 /absolute/local/P2');
  const server=await createViewer({root:args[1]});
  server.on('error',error=>{console.error(error?.code==='EADDRINUSE'?'Viewer port 5281 is already in use.':'Viewer startup failed.');process.exitCode=1;});
  const stop=()=>server.close();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  server.listen(viewerPort,'127.0.0.1',()=>console.log('NGS Viewer: http://127.0.0.1:'+viewerPort));
 }catch(e){console.error(e?.message??'Viewer startup failed.');process.exitCode=1;}
}
