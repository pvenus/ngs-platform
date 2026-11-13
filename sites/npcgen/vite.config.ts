import vinext from 'vinext';
import {defineConfig} from 'vite';
import {realpathSync,lstatSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {sites} from './build/sites-vite-plugin';

// Publication candidate only. No local gateway, hosting identity or private transport.
export default defineConfig(async ({command,mode}) => {
  if(command!=='build'||mode!=='space-candidate') throw Error('UNCONFIGURED_BUILD_ONLY');
  const output=process.env.NPCGEN_SPACE_OUTPUT;
  if(!output||realpathSync(output)!==output||!lstatSync(output).isDirectory()||!output.startsWith(resolve(import.meta.dirname,'../../.dev-runtime/space-candidate-'))) throw Error('SPACE_OUTPUT_REQUIRED');
  const framework=vinext({appDir:join(output,'frontend'),rscOutDir:join(output,'site/server'),ssrOutDir:join(output,'site/server/ssr'),clientOutDir:join(output,'site/client')});
  const plugins=framework.filter(p=>!(p&&typeof p==='object'&&'name' in p&&p.name==='vinext:build-id'));
  const {cloudflare}=await import('@cloudflare/vite-plugin');
  return {
    publicDir:false as const,
    environments:{client:{build:{outDir:join(output,'site/client')}}},
    define:{'__NPCGEN_SITE_PROJECT_ID__':'null','process.env.NEXT_PUBLIC_NPCGEN_API_ORIGIN':JSON.stringify(''),'process.env.NPCGEN_FRONTEND_ONLY':JSON.stringify('1'),'process.env.NEXT_PUBLIC_NPCGEN_FRONTEND_ONLY':JSON.stringify('1')},
    plugins:[plugins,sites({mockAuth:false,packageHosting:false}),cloudflare({persistState:false,viteEnvironment:{name:'rsc',childEnvironments:['ssr']},inspectorPort:false,config:{main:'./build/space-worker.ts',compatibility_flags:['nodejs_compat'],d1_databases:[],r2_buckets:[]}})]
  };
});
