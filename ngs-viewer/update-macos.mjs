/** Reversible update from the verified team branch; identical SHA is a no-op. */
import {execFileSync} from 'node:child_process';
import {closeSync,lstatSync,mkdtempSync,openSync,readFileSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {viewerOptions,viewerPort,binariSpace,validViewerPort} from './viewer.mjs';
import {labelFor} from './setup/os-targets.mjs';

const upstream='https://github.com/pvenus/ngs-platform.git',branch='refs/heads/team-viewer-stable';
const repo=fileURLToPath(new URL('../',import.meta.url));
const run=(bin,args,options={})=>execFileSync(bin,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],...options}).trim();
const git=(...args)=>run('git',['-C',repo,...args]);
const layout=['ngs-viewer','ngs-local/sites/npcgen/build','ngs-local/dev','ngs-local/local-miniflare/package.json',
 'ngs-local/local-miniflare/package-lock.json','space-hosting/overlay/build/shared-ngs-assets.ts','space-hosting/overlay/build/shared-ngs-response.mjs'];
function privatePath(path,isDirectory){
 const s=lstatSync(path);
 return realpathSync(path)===path&&s.uid===process.getuid()&&(s.mode&0o022)===0&&
  (isDirectory?s.isDirectory():s.isFile()&&s.nlink===1);
}
function plistArgv(path){return JSON.parse(run('/usr/bin/plutil',['-extract','ProgramArguments','json','-o','-',path]));}
async function main(){
 if(process.platform!=='darwin')throw Error('This update command is macOS only.');
 const params=process.argv.slice(2),allowLegacy=params.includes('--allow-legacy-idle'),plain=params.filter(x=>x!=='--allow-legacy-idle');
 const port=plain.length===0?viewerPort:plain.length===2&&plain[0]==='--port'?Number(plain[1]):null;
 if(!validViewerPort(port))throw Error('Usage: node ngs-viewer/update-macos.mjs [--port 5281] [--allow-legacy-idle]');
 const base=join(homedir(),'Library','Application Support','VINUS','NGS Viewer'),agents=join(homedir(),'Library','LaunchAgents');
 const label=labelFor(port),plist=join(agents,label+'.plist'),gui='gui/'+process.getuid(),service=gui+'/'+label;
 if(!privatePath(base,true)||!privatePath(agents,true)||!privatePath(plist,false))throw Error('Viewer runtime or service record is unsafe.');
 const saved=readFileSync(plist),argv=plistArgv(plist);
 if(!Array.isArray(argv)||!argv[1]?.startsWith(base+sep)||!argv[1].endsWith('/ngs-viewer/viewer.mjs')||!privatePath(argv[1],false)||
    viewerOptions(argv.slice(2)).port!==port)throw Error('Viewer service identity is invalid.');
 const origin='http://127.0.0.1:'+port;
 const get=async path=>{
  const r=await fetch(origin+path,{redirect:'error',signal:AbortSignal.timeout(2000)});
  if(!r.ok)throw Error('Viewer did not respond.');return r.json();
 };
 const previous=await get('/__viewer/config');
 if(previous.port!==port||previous.spaceOrigin!==binariSpace||previous.backend!=='codex')throw Error('Wrong Viewer instance.');
 if(git('remote','get-url','origin')!==upstream)throw Error('Use the official GitHub checkout.');
 const tip=/^([a-f0-9]{40})\s+refs\/heads\/team-viewer-stable$/u.exec(git('ls-remote','--exit-code',upstream,branch))?.[1];
 if(!tip)throw Error('Verified Viewer version unavailable.');
 if(previous.releaseCommit===tip){console.log('Viewer is already at the tested version.');return;}
 git('fetch','--no-tags',upstream,branch);
 if(git('rev-parse','--verify','FETCH_HEAD^{commit}')!==tip)throw Error('The verified branch moved; retry.');
 const guard=async action=>fetch(origin+'/__viewer/update/'+action,{method:'POST',redirect:'error',signal:AbortSignal.timeout(3000),
  headers:{Origin:origin,'Content-Type':'application/json','X-NGS-Viewer-Key':previous.guardKey},body:'{}'});
 const dir=mkdtempSync(join(base,'runtime-')),bundle=join(dir,'source.tar'),candidate=join(dir,'next.plist');
 let paused=false,stopped=false,installed=false,confirmed=false;
 try{
  git('archive','--format=tar','--output='+bundle,tip,...layout);
  run('/usr/bin/tar',['-xf',bundle,'-C',dir]);rmSync(bundle);
  run('npm',['ci','--ignore-scripts','--no-audit','--no-fund','--prefix',join(dir,'ngs-local','local-miniflare')],{timeout:240_000});
  const entry=join(dir,'ngs-viewer','viewer.mjs');
  run(argv[0],['--check',entry]);
  writeFileSync(join(dir,'ngs-viewer','runtime-commit.txt'),tip+'\n',{mode:0o600,flag:'wx'});
  writeFileSync(candidate,saved,{mode:0o600,flag:'wx'});
  run('/usr/bin/plutil',['-replace','ProgramArguments','-json',JSON.stringify([argv[0],entry,...argv.slice(2)]),candidate]);
  run('/usr/bin/plutil',['-lint',candidate]);
  const action=await guard('pause');
  if(action.ok){if((await action.json()).paused!==true)throw Error('Viewer did not pause.');paused=true;}
  else if(!(allowLegacy&&action.status===404&&['completed','failed'].includes((await get('/__viewer/status')).state)))
   throw Error(action.status===409?'Viewer is busy; retry after sync.':'Viewer did not confirm an idle state.');
  if(!readFileSync(plist).equals(saved))throw Error('Viewer service record changed while staging.');
  run('/bin/launchctl',['bootout',service]);stopped=true;
  renameSync(candidate,plist);installed=true;
  run('/bin/launchctl',['bootstrap',gui,plist]);
  for(let i=0;i<40;i++){
   try{const x=await get('/__viewer/config');if(x.releaseCommit===tip&&x.spaceOrigin===binariSpace&&x.port===port&&x.storage==='miniflare-r2'){confirmed=true;break;}}catch{}
   await new Promise(resolve=>setTimeout(resolve,500));
  }
  if(!confirmed)throw Error('Updated Viewer did not confirm its R2/D1 runtime.');
  console.log('Viewer updated to '+tip+'.');
 }catch(e){
  if(stopped){
   if(installed)try{run('/bin/launchctl',['bootout',service]);}catch{}
   const backup=join(dir,'prior.plist');closeSync(openSync(backup,'wx',0o600));writeFileSync(backup,saved);renameSync(backup,plist);
   try{run('/bin/launchctl',['bootstrap',gui,plist]);}catch{throw Error('Previous Viewer could not be restarted; its configuration was restored.');}
  }else if(paused)await guard('resume').catch(()=>{});
  throw e;
 }finally{if(!installed)rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
