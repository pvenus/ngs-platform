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
import {createViewerSyncQueue} from './lib/sync.mjs';

import {backgroundViewerSync} from './lib/background.mjs';
import {codexViewerRemote} from './lib/native-mcp.mjs';
import {codexViewerClient} from './lib/codex-transport.mjs';

import {forwardViewerRequest} from './lib/request-forward.mjs';

export const viewerPort=5281;
export const validViewerPort=port=>Number.isInteger(port)&&port>=1024&&port<=65535;
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
async function jsonBody(req,max){
 if(req.headers['content-type']!=='application/json')throw fault('VIEWER_BODY_INVALID',400);
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await body(req,max)));}catch(e){
  throw e?.status?e:fault('VIEWER_BODY_INVALID',400);
 }
}
const comparator=key=>value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(key));
export function viewerSpaceOrigin(value){
 let u;
 try{u=new URL(value);}catch{throw Error('VIEWER_SPACE_ORIGIN_INVALID');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash||
    u.origin!==binariSpace)
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

export async function createViewer({root,space=binariSpace,mirror=null,codexClient=null}={}){
 if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root)throw Error('VIEWER_P2_ABSOLUTE_REQUIRED');
 const origin=viewerSpaceOrigin(space);
 const assets=viewerAssets(), guardKey=randomBytes(32).toString('hex'), validKey=comparator(guardKey);
 const receiver=mirror??await openMirror(root);
 let snapshot=null;
 const sync=codexClient?null:createViewerSyncQueue(receiver,{onFinish:()=>{snapshot=receiver.snapshot();},onAccessLost:()=>{snapshot=null;}});
 let state={state:'waiting'};
 const background=codexClient&&backgroundViewerSync({mirror:receiver,remote:codexViewerRemote({origin,client:codexClient}),
  onSnapshot:v=>{snapshot=v;},onState:v=>{state=v;}});

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
    return json(200,{spaceOrigin:origin,guardKey,committed:snapshot!==null,port,...(background?{backend:'codex'}:{})});
   if(background&&path==='/__viewer/status'&&method==='GET'&&!url.search)return json(200,{...state,committed:snapshot!==null});
   if(background&&path==='/__npcgen_session'&&method==='GET'&&!url.search){
    if(!snapshot)throw fault('VIEWER_SYNC_REQUIRED',503);
    const r=(await codexClient.tool('ngs_viewer_request_session',{}))?.structuredContent;
    if(r?.status!==200||r.data?.state!=='authenticated'||r.data?.backend!=='space')
     throw fault('VIEWER_CODEX_CONNECTION_REQUIRED',503);
    return json(200,{...r.data,csrfToken:'0'.repeat(64),contextId:'space.'+'0'.repeat(64)});
   }
   if(background&&path==='/api/requests'){
    if(method==='GET'){
     if(url.search&&[...url.searchParams.keys()].join(',')!=='queueId')throw fault('VIEWER_REQUEST_INVALID',400);
     const r=(await codexClient.tool('ngs_viewer_request_status',url.search?{queueId:url.searchParams.get('queueId')}:{}))?.structuredContent;
     if(r?.status!==200)throw fault('VIEWER_CODEX_CONNECTION_REQUIRED',503);
     return json(200,r.data);
    }
    if(method!=='POST'||url.search)throw fault('METHOD_NOT_ALLOWED',405);
    if(req.headers['x-npcgen-csrf']!=='0'.repeat(64)||req.headers['x-npcgen-frontend-context']!=='space.'+'0'.repeat(64))
     throw fault('VIEWER_WRITE_DENIED',403);
    const command=await jsonBody(req,64*1024);
    const result=await forwardViewerRequest(command,async payload=>{
     const reply=(await codexClient.tool('ngs_viewer_request_submit',{command:payload}))?.structuredContent;
     return {status:reply?.status,receipt:reply?.data};
    });
    return json(result.status,result.body);
   }
   if(path.startsWith('/__viewer/')&&method==='POST'){
    if(!validKey(req.headers['x-ngs-viewer-key']))throw fault('VIEWER_WRITE_DENIED',403);
    if(background){
     if(path==='/__viewer/sync/now'&&!url.search){await jsonBody(req);void background.start();return json(202,{ok:true});}
     throw fault('NOT_FOUND',404);
    }
    if(path==='/__viewer/sync/start'&&!url.search){
     const v=await jsonBody(req);
     if(!v||Object.keys(v).length!==0)throw fault('VIEWER_SYNC_INVALID',400);
     return json(202,sync.start());
    }
    if(path==='/__viewer/sync/poll'&&!url.search){
     const v=await jsonBody(req);
     if(!v||Object.keys(v).join(',')!=='id'||typeof v.id!=='string')throw fault('VIEWER_SYNC_INVALID',400);
     return json(200,sync.poll(v.id));
    }
    if(path==='/__viewer/sync/reply'){
     const q=url.searchParams,status=Number(req.headers['x-ngs-viewer-upstream-status']);
     if([...q.keys()].sort().join(',')!=='id,job'||!Number.isInteger(status)||status<200||status>599||
        req.headers['content-type']!=='application/octet-stream')throw fault('VIEWER_SYNC_INVALID',400);
     const bytes=await body(req);
     return json(200,sync.respond(q.get('id'),q.get('job'),{status,bytes,
      fileSize:req.headers['x-ngs-file-size'],fileSha256:req.headers['x-ngs-file-sha256'],fileOffset:req.headers['x-ngs-file-offset']}));
    }
    if(path==='/__viewer/disconnect'&&!url.search){sync.close();snapshot=null;return json(200,{ok:true});}
    throw fault('NOT_FOUND',404);
   }
   if(viewerReadRoute(path)){
    if(!['GET','HEAD'].includes(method))throw fault('METHOD_NOT_ALLOWED',405);
    if(!snapshot)throw fault('VIEWER_SYNC_REQUIRED',503);
    return await send(res,await localProjection({root,snapshot,url,method,range:req.headers.range,openProject:receiver.openProject}),method);
   }
   const asset=assets.get(path);
   if(!asset)throw fault('NOT_FOUND',404);
   if(!['GET','HEAD'].includes(method))throw fault('METHOD_NOT_ALLOWED',405);
   if(url.search&&path!=='/')throw fault('NOT_FOUND',404);
   res.setHeader('Content-Type',asset.type);res.end(method==='HEAD'?undefined:asset.body);
  }catch(e){
   if(res.headersSent){res.destroy();return;}
   const status=[400,401,403,404,405,409,413,416,423,429,502,503].includes(e?.status)?e.status:503;
   return json(status,{error:/^[A-Z0-9_]+$/u.test(e?.message??'')?e.message:'VIEWER_LOCAL_UNAVAILABLE'});
  }
 });
 if(background)server.on('listening',()=>void background.start());
 server.on('close',()=>{sync?.close();codexClient?.close();void (async()=>{await background?.close();await receiver.close?.();})();});
 return server;
}

export function viewerOptions(args){
 if(args.length%2!==0||args.length<2||args.length>12)throw Error('VIEWER_ARGUMENTS');
 const pairs=new Map();
 for(let i=0;i<args.length;i+=2){
  if(pairs.has(args[i])||!['--p2','--port','--space','--codex-bin','--codex-mcp','--codex-socket'].includes(args[i]))throw Error('VIEWER_ARGUMENTS');
  pairs.set(args[i],args[i+1]);
 }
 const root=pairs.get('--p2'),raw=pairs.get('--port')??String(viewerPort),port=Number(raw);
 if(typeof root!=='string'||!isAbsolute(root)||resolve(root)!==root||
    !/^[1-9][0-9]{3,4}$/u.test(raw)||!validViewerPort(port))throw Error('VIEWER_ARGUMENTS');
 const binary=pairs.get('--codex-bin'),server=pairs.get('--codex-mcp'),socket=pairs.get('--codex-socket');
 if((binary||server||socket)&&(!binary||!isAbsolute(binary)||!server||
    !/^[a-z0-9_.-]{1,160}$/iu.test(server)||socket&&!isAbsolute(socket)))throw Error('VIEWER_CODEX_CONFIGURATION');
 return {root,port,space:viewerSpaceOrigin(pairs.get('--space')??binariSpace),
  ...(binary?{codex:{binary,server,...(socket?{socket}:{})}}:{})};
}

if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 try{
  const {root,port,space,codex}=viewerOptions(process.argv.slice(2));
  const binary=codex?.binary??process.env.NGS_VIEWER_CODEX_BIN, mcp=codex?.server??process.env.NGS_VIEWER_CODEX_MCP_NAME;
  if(Boolean(binary)!==Boolean(mcp))throw Error('VIEWER_CODEX_CONFIGURATION');
  const codexClient=binary?codexViewerClient({binary,server:mcp,socket:codex?.socket??process.env.NGS_VIEWER_CODEX_SOCKET}):null;
  const server=await createViewer({root,space,codexClient});
  server.on('error',error=>{console.error(error?.code==='EADDRINUSE'?'That Viewer port is already in use.':'Viewer startup failed.');process.exitCode=1;});
  const stop=()=>server.close();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  server.listen(port,'127.0.0.1',()=>console.log('NGS Viewer: http://127.0.0.1:'+port));
 }catch(e){console.error(e?.message==='VIEWER_ARGUMENTS'?'Usage: npm start -- --p2 /absolute/local/P2 --port 5281 --space https://…chatgpt.site':e?.message??'Viewer startup failed.');process.exitCode=1;}
}
