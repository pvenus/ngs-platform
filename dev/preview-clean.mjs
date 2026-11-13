/** Loopback-only preview of a compiled unconfigured shell; no credentials or remote bindings. */
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const port=Number(process.argv[2]||8788);
if(process.argv.length>3||!Number.isInteger(port)||port<1024||port>65535)throw Error('Use one loopback port from 1024 to 65535');
const parent=join(root,'.dev-runtime');
const candidates=readdirSync(parent).filter(n=>n.startsWith('space-candidate-')).map(n=>join(parent,n)).filter(p=>{
 try{const m=JSON.parse(readFileSync(join(p,'SPACE-CANDIDATE.json'),'utf8'));return m.state==='compiled'&&m.configuration==='unconfigured'&&m.deployable===false&&m.backendConnected===false;}catch{return false;}
}).sort((a,b)=>statSync(b).mtimeMs-statSync(a).mtimeMs);
if(!candidates.length)throw Error('Run npm run build first');
const output=candidates[0];
const env={PATH:process.env.PATH,HOME:join(output,'home'),TMPDIR:join(output,'tmp'),LANG:'C',CLOUDFLARE_CF_FETCH_ENABLED:'false',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',CI:'true',CHOKIDAR_USEPOLLING:'true',CHOKIDAR_INTERVAL:'1000'};
const child=spawn(process.execPath,[join(root,'sites/npcgen/node_modules/wrangler/bin/wrangler.js'),'dev','--config',join(output,'site/server/wrangler.json'),'--local','--ip','127.0.0.1','--port',String(port),'--inspector-ip','127.0.0.1','--inspector-port','0','--show-interactive-dev-session','false','--persist-to',join(output,'preview-state')],{cwd:root,env,stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
