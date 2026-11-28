import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {binariSpace,viewerOptions} from '../viewer.mjs';
import {officialInstall,waitForInstallProof,probeInstall} from '../install.mjs';
import {installTarget,launchAgent,windowsTaskCommand} from '../setup/os-targets.mjs';

const port=5681,root='/home/owner/NGS P2',space=binariSpace;
const opts={port,root,space};
const fakeProof='v1.1795838100000.'+'a'.repeat(64);

test('custom loopback port and explicit approved Space origin',()=>{
 assert.deepEqual(viewerOptions(['--p2',root,'--space',space+'/','--port',String(port)]),opts);
 for(const url of ['http://'+new URL(space).host,space+'/another','https://different.team.chatgpt.site',
                  space+'?verify=1','https://other.example'])
  assert.throws(()=>viewerOptions(['--p2',root,'--space',url]),/VIEWER_SPACE_ORIGIN_INVALID/u);
 for(const p of ['0','800','65536','05281','5281x'])
  assert.throws(()=>viewerOptions(['--p2',root,'--port',p]),/VIEWER_ARGUMENTS/u);
});

test('unsupported, denied, and unapproved issuers cannot register an OS startup job',async()=>{
 let registers=0;
 const register=()=>{registers++;return {name:'fixture'};};
 const target={service:'launchagent'};
 assert.equal(await probeInstall(opts,async()=>Response.json({error:'METHOD_NOT_ALLOWED'},{status:405})),undefined);
 await assert.rejects(officialInstall(opts,{target,register,request:async()=>new Response(null,{status:404})}),
  /VIEWER_SPACE_INSTALL_UNAVAILABLE/u);
 await assert.rejects(officialInstall(opts,{target,register,probe:async()=>{},authenticate:async()=>{throw Error('AUTH_DENIED');}}),
  /AUTH_DENIED/u);
 await assert.rejects(officialInstall({...opts,space:'https://other.team.chatgpt.site'},{target,register}),
  /VIEWER_SPACE_ORIGIN_INVALID/u);
 assert.equal(registers,0);
 await officialInstall(opts,{target,register,probe:async()=>{},authenticate:async()=>{}});
 assert.equal(registers,1);
});

test('setup server verifies proof with Space directly, does not expose the verifier and closes before registration',async()=>{
 let url,config,announce;
 const listening=new Promise(r=>{announce=r;});
 const pending=waitForInstallProof(opts,{listen:0,waitMs:5000,announce,request:async(target,init)=>{
  assert.equal(String(target),space+'/api/viewer/install/verify');
  assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');
  const sent=JSON.parse(init.body);assert.equal(sent.port,config.port);
  assert.equal(createHash('sha256').update(sent.verifier).digest('hex'),config.challengeSha256);
  return sent.proof===fakeProof?Response.json({authorized:true}):Response.json({error:'DENIED'},{status:403});
 }});
 url=await listening;
 const get=(path,init)=>fetch(url+path,init);
 config=await (await get('/config')).json();
 assert.equal(Object.hasOwn(config,'verifier'),false);
 const post=(proof,key)=>get('/verify',{method:'POST',headers:{Origin:url,'Content-Type':'application/json',
  'x-ngs-viewer-key':key},body:JSON.stringify({proof})});
 assert.equal((await post(fakeProof,'f'.repeat(64))).status,403);
 assert.equal((await post(fakeProof.replace(/a$/,'b'),config.key)).status,403);
 assert.equal((await post(fakeProof,config.key)).status,200);
 await pending;
 await assert.rejects(get('/config'));
});

test('registration plans use per-user launchd or WSL2 interactive tasks, never native Windows',()=>{
 const dto={...opts,node:'/home/owner/node',entry:'/home/owner/NGS Viewer/viewer.mjs',log:'/home/owner/a&b.log'};
 const mac=launchAgent(dto);
 assert.match(mac,/com.vinus.ngs-viewer.5681/u);assert.match(mac,/a&amp;b.log/u);
 assert.match(mac,/<key>RunAtLoad<\/key><true\//u);
 assert.match(mac,/<string>--space<\/string><string>https:\/\//u);
 const actual=windowsTaskCommand({...dto,distro:'Ubuntu 24.04'});
 assert.equal(actual.name,'VINUS-NGS-Viewer-5681');
 const script=Buffer.from(actual.encoded,'base64').toString('utf16le');
 assert.match(script,/New-ScheduledTaskTrigger -AtLogOn/u);
 assert.match(script,/-LogonType Interactive -RunLevel Limited/u);
 assert.doesNotMatch(script,/sc\.exe|LocalSystem/u);
 assert.deepEqual(installTarget({platform:'linux',kernel:'5.15-microsoft-standard-WSL2',distro:'Ubuntu'}),
  {service:'scheduled-task',distro:'Ubuntu'});
 assert.throws(()=>installTarget({platform:'win32'}),/VIEWER_USE_WSL2_INSTALLER/u);
 assert.throws(()=>installTarget({platform:'linux',kernel:'linux',distro:'Ubuntu'}),/VIEWER_OS_SERVICE_UNSUPPORTED/u);
});
