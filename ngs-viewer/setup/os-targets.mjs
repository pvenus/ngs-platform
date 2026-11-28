import {execFileSync} from 'node:child_process';
import {closeSync,cpSync,lstatSync,mkdirSync,openSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {homedir,release} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {openMirror} from '../lib/mirror.mjs';

const repo=fileURLToPath(new URL('../../',import.meta.url));
const safe=(x)=>typeof x==='string'&&x.isWellFormed()&&!/[\x00-\x1f\x7f]/u.test(x);
const own=(path)=>{const s=lstatSync(path);return s.uid===process.getuid()&&s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(path)===path;};
function makeOwned(path){
 mkdirSync(path,{recursive:true,mode:0o700});
 if(!own(path)||(lstatSync(path).mode&0o022))throw Error('VIEWER_UNSAFE_INSTALL_PATH');
}
function exists(path){
 try{lstatSync(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}
}
export function installTarget({platform=process.platform,kernel=release(),distro=process.env.WSL_DISTRO_NAME}={}){
 if(platform==='darwin')return {service:'launchagent'};
 if(platform==='linux'&&/microsoft.*wsl2/iu.test(kernel)&&/^[a-zA-Z0-9._ -]{1,64}$/u.test(distro??''))return {service:'scheduled-task',distro};
 throw Error(platform==='win32'?'VIEWER_USE_WSL2_INSTALLER':'VIEWER_OS_SERVICE_UNSUPPORTED');
}
const xml=x=>String(x).replace(/&/gu,'&amp;').replace(/</gu,'&lt;').replace(/>/gu,'&gt;').replace(/"/gu,'&quot;').replace(/'/gu,'&apos;');
export const labelFor=port=>'com.vinus.ngs-viewer.'+port;
export function launchAgent({node,entry,root,space,port,log}){
 const args=[node,entry,'--p2',root,'--port',String(port),'--space',space];
 if(![...args,log].every(safe))throw Error('VIEWER_INVALID_SERVICE_ARGUMENT');
 const val=x=>'<string>'+xml(x)+'</string>';
 return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'+
 '<plist version="1.0"><dict><key>Label</key>'+val(labelFor(port))+'<key>ProgramArguments</key><array>'+args.map(val).join('')+
 '</array><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>'+
 '<key>ThrottleInterval</key><integer>20</integer><key>StandardOutPath</key>'+val(log)+
 '<key>StandardErrorPath</key>'+val(log)+'</dict></plist>\n';
}
function winArgument(value){
 if(!safe(value)||value.includes('"')||value.includes('\\'))throw Error('VIEWER_INVALID_SERVICE_ARGUMENT');
 return '"'+value+'"';
}
export function windowsTaskCommand({node,entry,root,space,port,distro}){
 const name='VINUS-NGS-Viewer-'+port;
 const windowsArguments=['--distribution',distro,'--exec',node,entry,'--p2',root,'--port',String(port),'--space',space].map(winArgument).join(' ');
 const data=Buffer.from(JSON.stringify({name,arguments:windowsArguments}),'utf8').toString('base64');
 // Task Scheduler runs as the current interactive Windows SID, never Administrator/SYSTEM.
 const script=`$ErrorActionPreference = 'Stop'
$c = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
if (Get-ScheduledTask -TaskName $c.name -ErrorAction SilentlyContinue) { throw 'VIEWER_SERVICE_ALREADY_REGISTERED' }
$exe = Join-Path $env:WINDIR 'System32\\wsl.exe'
$a = New-ScheduledTaskAction -Execute $exe -Argument $c.arguments
$t = New-ScheduledTaskTrigger -AtLogOn -User $user
$p = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval ([TimeSpan]::FromMinutes(1))
Register-ScheduledTask -TaskName $c.name -Action $a -Trigger $t -Principal $p -Settings $s | Out-Null
try { Start-ScheduledTask -TaskName $c.name } catch { Unregister-ScheduledTask -TaskName $c.name -Confirm:$false; throw }
Write-Output $c.name`;
 return {name,encoded:Buffer.from(script,'utf16le').toString('base64')};
}

function stageRuntime(base){
 const destination=join(base,'runtime-'+randomUUID());
 makeOwned(destination);
 try{
  for(const rel of ['ngs-viewer/viewer.mjs','ngs-viewer/lib','ngs-viewer/public',
   'ngs-local/sites/npcgen/build','space-hosting/overlay/build/shared-ngs-assets.ts','space-hosting/overlay/build/shared-ngs-response.mjs']){
   const target=join(destination,rel);
   mkdirSync(dirname(target),{recursive:true,mode:0o700});
   cpSync(join(repo,rel),target,{recursive:true,dereference:false,force:false,errorOnExist:true,
    filter:source=>{if(lstatSync(source).isSymbolicLink())throw Error('VIEWER_RUNTIME_SYMLINK');return true;}});
  }
  return destination;
 }catch(e){rmSync(destination,{recursive:true,force:true});throw e;}
}

/** Invoked only after install.mjs verifies an authenticated Space proof. */
export async function registerViewer(options,target=installTarget()){
 // Initialize/verify only the exact caller-selected P2 after authentication.
 const mirror=await openMirror(options.root);mirror.close();
 const base=target.service==='launchagent'?join(homedir(),'Library','Application Support','VINUS','NGS Viewer'):
  join(homedir(),'.local','share','vinus-ngs-viewer');
 makeOwned(base);
 const node=realpathSync(process.execPath);
 const label=labelFor(options.port), log=join(base,'viewer-'+options.port+'.log');
 let ctlPath,configPath;
 if(target.service==='launchagent'){
  const agents=join(homedir(),'Library','LaunchAgents');makeOwned(agents);
  configPath=join(agents,label+'.plist');
  if(exists(configPath))throw Error('VIEWER_SERVICE_ALREADY_REGISTERED');
  ctlPath='gui/'+process.getuid();
 }
 const dest=stageRuntime(base),entry=join(dest,'ngs-viewer','viewer.mjs');
 let bootstrapped=false, registered=false, createdConfig=false;
 try{
  if(target.service==='launchagent'){
   // Preserve an existing user log. Create safely rather than following a link.
   if(!exists(log)){const fd=openSync(log,'wx',0o600);closeSync(fd);}
   const st=lstatSync(log);
   if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||st.nlink!==1||(st.mode&0o077))
    throw Error('VIEWER_UNSAFE_LOG');
   writeFileSync(configPath,launchAgent({...options,node,entry,log}),{flag:'wx',mode:0o600});createdConfig=true;
   execFileSync('/usr/bin/plutil',['-lint',configPath]);
   execFileSync('/bin/launchctl',['bootstrap',ctlPath,configPath],{stdio:'pipe'});bootstrapped=true;
   execFileSync('/bin/launchctl',['print',ctlPath+'/'+label],{stdio:'pipe'});
   registered=true;
   return {name:label,kind:target.service};
  }
  const request=windowsTaskCommand({...options,node,entry,distro:target.distro});
  execFileSync('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
   ['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',request.encoded],{stdio:'pipe',timeout:60_000});
  registered=true;
  return {name:request.name,kind:target.service};
 }catch(e){
  if(bootstrapped){try{execFileSync('/bin/launchctl',['bootout',ctlPath+'/'+label],{stdio:'pipe'});}catch{
   // Service state is uncertain; retain its configuration and binary tree.
   throw Error('VIEWER_SERVICE_STATE_UNCONFIRMED');
  }}
  if(createdConfig)rmSync(configPath,{force:true});
  if(!registered&&target.service==='launchagent')rmSync(dest,{recursive:true,force:true});
  throw /^[A-Z_]+$/u.test(e?.message??'')?e:Error('VIEWER_OS_REGISTRATION_FAILED');
 }
}
