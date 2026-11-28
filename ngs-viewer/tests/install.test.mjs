import assert from 'node:assert/strict';
import test from 'node:test';
import {generateKeyPairSync,sign} from 'node:crypto';
import {binariSpace,viewerOptions} from '../viewer.mjs';
import {officialInstall,waitForInstallProof,verifySpaceProof,verifyCodexViewer} from '../install.mjs';
import {installTarget,launchAgent,windowsTaskCommand} from '../setup/os-targets.mjs';

const port=5681,root=process.platform==='win32'?String.raw`C:\Users\owner\NGS P2`:'/home/owner/NGS P2',space=binariSpace;
const opts={port,root,space};
const {publicKey,privateKey}=generateKeyPairSync('ed25519');

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
 await assert.rejects(officialInstall(opts,{target,register,authenticate:async()=>{throw Error('AUTH_DENIED');}}),
  /AUTH_DENIED/u);
 await assert.rejects(officialInstall({...opts,space:'https://other.team.chatgpt.site'},{target,register}),
  /VIEWER_SPACE_ORIGIN_INVALID/u);
 assert.equal(registers,0);
 await officialInstall(opts,{target,register,authenticate:async()=>{}});
 assert.equal(registers,1);
});

test('setup server verifies pinned Space approval offline and closes before registration',async()=>{
 let announce;
 const listening=new Promise(r=>{announce=r;}), now=()=>1795837800000;
 const pending=waitForInstallProof(opts,{listen:0,waitMs:5000,announce,publicKey,now});
 const url=await listening;
 const get=(path,init)=>fetch(url+path,init);
 const config=await (await get('/config')).json();
 assert.equal(Object.hasOwn(config,'verifier'),false);
 const expiry=now()+5*60_000;
 const bytes=Buffer.from(JSON.stringify(['ngs.viewer.install.v2',space,'binari',config.port,config.challengeSha256,expiry]));
 const fakeProof='v2.'+expiry+'.'+sign(null,bytes,privateKey).toString('hex');
 const packet={space,port:config.port,challengeSha256:config.challengeSha256,proof:fakeProof};
 assert.equal(verifySpaceProof(packet,{publicKey,now}),true);
 assert.equal(verifySpaceProof(packet,{now}),false); // wrong signing authority
 assert.equal(verifySpaceProof(packet,{publicKey,now:()=>expiry}),false);
 assert.equal(verifySpaceProof({...packet,port:config.port+1},{publicKey,now}),false);
 const post=(proof,key)=>get('/verify',{method:'POST',headers:{Origin:url,'Content-Type':'application/json',
  'x-ngs-viewer-key':key},body:JSON.stringify({proof})});
 assert.equal((await post(fakeProof,'f'.repeat(64))).status,403);
 assert.equal((await post(fakeProof.slice(0,-1)+(fakeProof.endsWith('a')?'b':'a'),config.key)).status,403);
 assert.equal((await post(fakeProof,config.key)).status,200);
 await pending;
 await assert.rejects(get('/config'));
});

test('registration plans use per-user launchd or native Windows interactive tasks',()=>{
 const dto={...opts,node:'/home/owner/node',entry:'/home/owner/NGS Viewer/viewer.mjs',log:'/home/owner/a&b.log'};
 const mac=launchAgent(dto);
 assert.match(mac,/com.vinus.ngs-viewer.5681/u);assert.match(mac,/a&amp;b.log/u);
 assert.match(mac,/<key>RunAtLoad<\/key><true\//u);
 assert.match(mac,/<string>--space<\/string><string>https:\/\//u);
 const actual=windowsTaskCommand({...dto,node:String.raw`C:\Program Files\nodejs\node.exe`,entry:String.raw`C:\Users\owner\NGS Viewer\viewer.mjs`,root:String.raw`D:\비나리 P2`});
 assert.equal(actual.name,'VINUS-NGS-Viewer-5681');
 const script=Buffer.from(actual.encoded,'base64').toString('utf16le');
 assert.match(script,/New-ScheduledTaskTrigger -AtLogOn/u);
 assert.match(script,/-LogonType Interactive -RunLevel Limited/u);
 assert.doesNotMatch(script,/sc\.exe|LocalSystem/u);
 assert.deepEqual(installTarget({platform:'win32'}),{service:'scheduled-task'});
 assert.doesNotMatch(script,/wsl\.exe|--distribution/u);
 assert.match(script,/-Execute \$c\.node -Argument \$c\.arguments/u);
 const encoded=script.match(/FromBase64String\('([^']+)'\)/u)[1];
 const packet=JSON.parse(Buffer.from(encoded,'base64'));
 assert.equal(packet.node,String.raw`C:\Program Files\nodejs\node.exe`);
 assert.match(packet.arguments,/"D:\\비나리 P2"/u);
 assert.throws(()=>installTarget({platform:'linux',kernel:'linux',distro:'Ubuntu'}),/VIEWER_OS_SERVICE_UNSUPPORTED/u);
});

test('Codex install requires team manifest before registering and has no browser fallback',async()=>{
 const binary=process.platform==='win32'?String.raw`C:\Program Files\Codex\codex.exe`:'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
 const configured=viewerOptions(['--p2',root,'--codex-bin',binary,'--codex-mcp','binari-space']);
 let closed=0,registered=0;
 const noPopup=()=>assert.fail('Codex installation opened browser approval');
 const target={service:'launchagent'};
 const register=()=>{registered++;return {name:'fixture'};};
 const auth=status=>o=>verifyCodexViewer(o,config=>{
  assert.deepEqual(config,{binary,server:'binari-space'});
  return {close(){closed++;},async tool(name,args){
   assert.equal(name,'ngs_viewer_manifest');assert.deepEqual(args,{});
   return {isError:status!==200,structuredContent:{status,manifest:{projectId:'binari',resources:['project'],files:[]}}};
  }};
 });
 await assert.rejects(officialInstall(configured,{target,register,authenticate:noPopup,authenticateCodex:auth(403)}),/VIEWER_SPACE_SIGN_IN_REQUIRED/);
 assert.equal(registered,0);
 await officialInstall(configured,{target,register,authenticate:noPopup,authenticateCodex:auth(200)});
 assert.equal(registered,1);assert.equal(closed,2);
});

test('team setup uses Codex with no legacy popup and defaults to the approved Site plugin',async()=>{
 const {defaultTeamCodex}=await import('../setup/codex-discovery.mjs');
 const found=defaultTeamCodex(opts,{discover:()=>'/test/codex'});
 assert.deepEqual(found.codex,{binary:'/test/codex',server:'codex_apps',mode:'stdio'});
 const fixed=defaultTeamCodex({...opts,codex:{binary:'/fixed/codex',server:'test',socket:'/fixed/socket'}},
  {discover:()=>assert.fail('explicit binary should win')});
 assert.deepEqual(fixed.codex,{binary:'/fixed/codex',server:'test',socket:'/fixed/socket',mode:'proxy'});
});

test('Windows updater exits for same SHA before fetching or changing tasks',async()=>{
 const {readFile}=await import('node:fs/promises');
 const script=await readFile(new URL('../update-windows.ps1',import.meta.url),'utf8');
 const exit=script.indexOf('if ($before.releaseCommit -eq $expectedSha)');
 assert.ok(exit>0);
 assert.match(script.slice(exit,script.indexOf('fetch --no-tags')),/exit 0/);
 for(const step of ['fetch --no-tags','New-Item','Stop-ScheduledTask','Set-ScheduledTask','Start-ScheduledTask'])
  assert.ok(script.indexOf(step)>exit);
 assert.ok(script.indexOf("Set-ViewerGate 'pause'")<script.indexOf('Stop-ScheduledTask'));
 assert.match(script,/ -Action \$old \| Out-Null/u);
 assert.match(script,/\$live\.releaseCommit -eq \$sha/u);
});
