/** Official installation: no Viewer registration until a Space challenge is verified. */
import {createServer} from 'node:http';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {stdin,stdout} from 'node:process';
import {execFile} from 'node:child_process';
import {win32} from 'node:path';

import {assertLoopbackRequest} from '../ngs-local/sites/npcgen/build/loopback-auth.mjs';
import {binariSpace,viewerPort,viewerOptions,viewerSpaceOrigin} from './viewer.mjs';
import {installTarget,registerViewer} from './setup/os-targets.mjs';

const statusError=(code,status)=>Object.assign(Error(code),{status});
const close=s=>new Promise(resolve=>{s.close(()=>resolve());s.closeIdleConnections();});
const addr=port=>'http://127.0.0.1:'+port;
const exact=(v,key)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===1&&Object.hasOwn(v,key);
const proofPattern=/^v1\.[1-9]\d{12}\.[0-9a-f]{64}$/u;
export const installVerifyPath='/api/viewer/install/verify';
const authGuard="default-src 'none'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";
const html='<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NGS Viewer 설치</title>'+
 '<main><h1>NGS Viewer 설치 확인</h1><p>Space 팀원 인증을 통과해야 이 컴퓨터의 자동 실행 항목을 등록합니다.</p>'+
 '<p id="viewer-setup-status" aria-live="polite">아래 버튼으로 Space 창을 열고 연결을 승인해 주세요.</p>'+
 '<button id="viewer-setup-link" type="button">Space 팀원 인증</button></main>'+
 '<script type="module" src="/install-browser.mjs"></script></html>';
const script=()=>readFileSync(new URL('./setup/install-browser.mjs',import.meta.url),'utf8');

function verifyAddress(space){return new URL(installVerifyPath,viewerSpaceOrigin(space));}
export async function probeInstall({space},request=fetch){
 let r;
 try{r=await request(verifyAddress(space),{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(8000)});}
 catch{throw Error('VIEWER_SPACE_INSTALL_UNAVAILABLE');}
 if(r.status!==405)throw Error('VIEWER_SPACE_INSTALL_UNAVAILABLE');
 const problem=await r.json().catch(()=>null);
 if(!exact(problem,'error')||problem.error!=='METHOD_NOT_ALLOWED')throw Error('VIEWER_SPACE_INSTALL_UNAVAILABLE');
}
export async function verifySpaceProof({space,port,verifier,proof},request=fetch){
 if(typeof proof!=='string'||!proofPattern.test(proof)||typeof verifier!=='string'||!/^[0-9a-f]{64}$/u.test(verifier))return false;
 let r;
 try{r=await request(verifyAddress(space),{method:'POST',redirect:'error',credentials:'omit',
  signal:AbortSignal.timeout(12_000),headers:{'Content-Type':'application/json'},body:JSON.stringify({port,verifier,proof})});}
 catch{return false;}
 if(r.status!==200)return false;
 const result=await r.json().catch(()=>null);
 return exact(result,'authorized')&&result.authorized===true;
}

export async function waitForInstallProof(options,{request=fetch,announce=()=>{},waitMs=600_000,listen=options.port}={}){
 const verifier=randomBytes(32).toString('hex'),key=randomBytes(32).toString('hex');
 const challengeSha256=createHash('sha256').update(verifier,'utf8').digest('hex');
 let ready,fail,checking=false,authorized=false,challenges=0;
 const verified=new Promise((yes,no)=>{ready=yes;fail=no;});
 const server=createServer(async(req,res)=>{
  res.setHeader('Content-Security-Policy',authGuard);
  res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','private, no-store');
  const send=(status,type,body)=>{res.statusCode=status;res.setHeader('Content-Type',type);res.end(body);};
  const json=(status,body)=>send(status,'application/json; charset=utf-8',JSON.stringify(body));
  try{
   const port=server.address()?.port;
   assertLoopbackRequest(req,port,req.method==='POST');
   if(req.method==='GET'&&req.url==='/')return send(200,'text/html; charset=utf-8',html);
   if(req.method==='GET'&&req.url==='/install-browser.mjs')return send(200,'text/javascript; charset=utf-8',script());
   if(req.method==='GET'&&req.url==='/config')return json(200,{spaceOrigin:options.space,port,challengeSha256,key});
   if(req.method!=='POST'||req.url!=='/verify')return json(404,{error:'NOT_FOUND'});
   const supplied=req.headers['x-ngs-viewer-key'];
   if(typeof supplied!=='string'||!/^[0-9a-f]{64}$/u.test(supplied)||
      !timingSafeEqual(Buffer.from(supplied),Buffer.from(key)))throw statusError('VIEWER_INSTALL_DENIED',403);
   if(checking||authorized||challenges>=10)throw statusError('VIEWER_INSTALL_NOT_AVAILABLE',409);
   const length=req.headers['content-length'];
   if(req.headers['content-type']!=='application/json'||req.headers['transfer-encoding']||
      typeof length!=='string'||!/^[1-9]\d{0,2}$/u.test(length)||Number(length)>256)
    throw statusError('VIEWER_INSTALL_INVALID',400);
   checking=true;
   try{
    const pieces=[];let size=0;
    for await(const piece of req){size+=piece.length;if(size>256)throw statusError('VIEWER_INSTALL_INVALID',400);pieces.push(piece);}
    if(size!==Number(length))throw statusError('VIEWER_INSTALL_INVALID',400);
    const packet=JSON.parse(Buffer.concat(pieces).toString('utf8'));
    if(!exact(packet,'proof')||typeof packet.proof!=='string'||!proofPattern.test(packet.proof))throw statusError('VIEWER_INSTALL_INVALID',400);
    challenges++;
    const ok=await verifySpaceProof({...options,port,verifier,proof:packet.proof},request);
    if(!ok)return json(403,{error:'VIEWER_INSTALL_AUTH_FAILED'});
    authorized=true;
    res.once('finish',ready);
    return json(200,{authorized:true});
   }finally{checking=false;}
  }catch(e){return json([400,403,409].includes(e?.status)?e.status:400,{error:e?.status?e.message:'VIEWER_INSTALL_INVALID'});}
 });
 server.requestTimeout=20_000;
 await new Promise((yes,no)=>{server.once('error',no);server.listen(listen,'127.0.0.1',yes);});
 const deadline=setTimeout(()=>fail(Error('VIEWER_INSTALL_AUTH_TIMEOUT')),waitMs);
 const interrupted=()=>fail(Error('VIEWER_INSTALL_CANCELED'));
 process.once('SIGINT',interrupted);process.once('SIGTERM',interrupted);
 try{
  announce(addr(server.address().port));
  await verified;
  if(!authorized)throw Error('VIEWER_INSTALL_AUTH_FAILED');
 }finally{
  clearTimeout(deadline);
  process.removeListener('SIGINT',interrupted);process.removeListener('SIGTERM',interrupted);
  await close(server);
 }
}

export async function officialInstall(options,{request=fetch,register=registerViewer,target=installTarget(),
 authenticate=waitForInstallProof,probe=probeInstall,announce}={}){
 // Canonical issuer validation before any network request or local registration.
 viewerSpaceOrigin(options.space);
 await probe(options,request);
 await authenticate(options,{request,announce});
 return register(options,target);
}
async function cliOptions(){
 const values=process.argv.slice(2);
 if(values.length)return viewerOptions(values);
 const io=createInterface({input:stdin,output:stdout});
 try{
  const space=(await io.question('Space 주소 ['+binariSpace+']: ')).trim()||binariSpace;
  const root=(await io.question('P2 폴더의 절대 경로: ')).trim();
  const port=(await io.question('Viewer 포트 ['+viewerPort+']: ')).trim()||String(viewerPort);
  return viewerOptions(['--space',space,'--p2',root,'--port',port]);
 }finally{io.close();}
}
async function checkWorker(port){
 for(let i=0;i<18;i++){
  try{
   const r=await fetch(addr(port)+'/__viewer/config',{redirect:'error',signal:AbortSignal.timeout(1000)});
   const b=r.ok?await r.json():null;
   if(b?.port===port&&b.spaceOrigin===binariSpace)return true;
  }catch{}
  await new Promise(resolve=>setTimeout(resolve,450));
 }
 return false;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href){
 try{
  const options=await cliOptions(),target=installTarget();
  const result=await officialInstall(options,{target,announce:url=>{
   console.log('아래 주소에서 Space 로그인을 승인해야 자동 실행 항목을 등록합니다.\n'+url);
   if(target.service==='launchagent')execFile('/usr/bin/open',[url],()=>{});
   else execFile(win32.join(process.env.SystemRoot??'C:\Windows','explorer.exe'),[url],()=>{});
  }});
  const running=await checkWorker(options.port);
  console.log(result.name+(result.kind==='launchagent'?' LaunchAgent':' 예약 작업')+' 등록 완료');
  console.log(running?'실행 확인: '+addr(options.port):'등록은 완료됐지만 Viewer 응답은 아직 확인되지 않았습니다.');
  if(!running)process.exitCode=2;
 }catch(e){
  const friendly={
   VIEWER_ARGUMENTS:'Space 주소·P2 절대 경로·1024~65535 포트를 확인하세요.',
   VIEWER_SPACE_ORIGIN_INVALID:'이 설치 프로그램에서 승인한 비나리 Space 주소가 아닙니다.',
   VIEWER_SPACE_INSTALL_UNAVAILABLE:'입력한 Space에 설치 인증이 연결되지 않아 자동 실행 항목을 등록하지 않았습니다.',
   VIEWER_INSTALL_AUTH_TIMEOUT:'팀원 인증 대기 시간이 끝났습니다. 등록하지 않았습니다.',
   VIEWER_P2_NTFS_REQUIRED:'P2는 로컬 NTFS 드라이브에 만들어 주세요.',
   VIEWER_P2_NTFS_ACL_UNSAFE:'기존 폴더 대신 새 P2 폴더 경로를 지정해 주세요.',
   VIEWER_P2_REPARSE_POINT:'정션, 심볼릭 링크 또는 클라우드 동기화 경로를 제외한 NTFS 폴더를 선택해 주세요.',
  };
  console.error(friendly[e?.message]??e?.message??'설치 실패');
  process.exitCode=1;
 }
}
