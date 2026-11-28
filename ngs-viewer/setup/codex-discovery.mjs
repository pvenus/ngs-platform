import {accessSync,constants,realpathSync,statSync} from 'node:fs';
import {delimiter,isAbsolute,join} from 'node:path';

const codexMac='/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
export function discoverTeamCodex({platform=process.platform,env=process.env,testExecutable}={}){
 const check=testExecutable??(p=>{try{accessSync(p,platform==='win32'?constants.F_OK:constants.X_OK);
  const exact=realpathSync(p);return statSync(exact).isFile()?exact:null;}catch{return null;}});
 const program=platform==='win32'?'codex.exe':'codex';
 const candidates=[
  ...(platform==='darwin'?[codexMac]:[]),
  ...(env.PATH??env.Path??'').split(delimiter).filter(isAbsolute).map(p=>join(p,program)),
 ];
 for(const candidate of candidates){const value=check(candidate);if(value)return value;}
 throw Error('VIEWER_CODEX_BINARY_REQUIRED');
}
export function defaultTeamCodex(options,{discover=discoverTeamCodex}={}){
 const configured=options.codex??{binary:discover()};
 return {...options,codex:{...configured,server:configured.server??'codex_apps',
  mode:configured.mode??(configured.socket?'proxy':'stdio')}};
}
