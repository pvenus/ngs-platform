import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectFolders,projectFolderPDS} from '../build/local-project-folders.mjs';
import {localProjectFolderRoute} from '../build/local-project-folder-route.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
const doc=name=>Buffer.from(JSON.stringify({name}));
const hash=b=>createHash('sha256').update(b).digest('hex');
const temporary=t=>{
 const folder=mkdtempSync(join(realpathSync(tmpdir()),'ngs-project-folders-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 return join(folder,'project-catalog');
};
async function listener(t,handler){
 const server=createServer(handler);
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port;
}
function simulatedPDS(){
 const items=new Map([['binari',{'project.json':doc('Binari'),'icon.png':png}],['other',{'project.json':doc('Other')}]]);
 const calls=[];
 let failure=null;
 return {items,calls,fail:(fn)=>{failure=fn;},service:{
  async discover(){calls.push(['discover']);return {projects:[...items.keys()]};},
  async compare(groups){
   calls.push(['compare',groups]);
   const result={groups:[],unavailable:[]};
   for(const {projectId,files} of groups){
    const item=items.get(projectId);
    if(!item){result.unavailable.push(projectId);continue;}
    const old=new Map(files.map(x=>[x.name,x.sha256]));
    const changed=Object.entries(item).map(([name,b])=>({name,sha256:hash(b)})).filter(x=>old.get(x.name)!==x.sha256);
    if(changed.length)result.groups.push({projectId,files:changed});
   }
   return result;
  },
  async download(id,name,sha256){calls.push(['download',id,name,sha256]);return failure?.(name)??items.get(id)[name];},
 }};
}

test('local list, cached discovery, per-project 60 seconds across reopen, and only changed downloads',async t=>{
 const root=temporary(t),sim=simulatedPDS();
 let time=1000;
 const store=()=>createLocalProjectFolders({root,pds:sim.service,now:()=>time});
 let catalog=store();
 assert.deepEqual(catalog.list(()=>true),[]);
 assert.deepEqual(await catalog.discover(),['binari','other']);
 assert.deepEqual(await catalog.discover(),['binari','other']);
 assert.deepEqual(sim.calls,[['discover']]);
 assert.deepEqual(catalog.list(()=>true),[]);
 await assert.rejects(catalog.refresh('binari'),/PROJECT_FOLDER_COMPARE_REQUIRED/);
 const first=await catalog.compare(['binari','other']);
 assert.deepEqual(first.groups.map(g=>g.projectId),['binari','other']);
 assert.deepEqual(first.unavailable,[]);
 const fresh=await catalog.refresh('binari');
 assert.deepEqual(fresh,{projectId:'binari',status:'refreshed',
  project:{projectId:'binari',name:'Binari',iconUrl:'/api/project-folders/icon?projectId=binari&sha256='+hash(png),needsRefresh:false}});
 assert.deepEqual(sim.calls.slice(1),[['compare',[{projectId:'binari',files:[]},{projectId:'other',files:[]}]],['download','binari','project.json',hash(doc('Binari'))],['download','binari','icon.png',hash(png)]]);
 await catalog.refresh('other');
 catalog=store();
 time=60_999;
 assert.equal(catalog.list(()=>true)[0].needsRefresh,false);
 assert.equal((await catalog.refresh('binari')).status,'cached');
 assert.equal(sim.calls.filter(([kind])=>kind==='compare').length,1);
 time=61_000;
 assert.equal(catalog.list(()=>true)[0].needsRefresh,true);
 assert.deepEqual(await catalog.compare(['binari','other','offline']),{groups:[],unavailable:['offline']});
 assert.deepEqual(sim.calls.at(-1),['compare',[{projectId:'binari',files:[{name:'project.json',sha256:hash(doc('Binari'))},{name:'icon.png',sha256:hash(png)}]},
  {projectId:'other',files:[{name:'project.json',sha256:hash(doc('Other'))}]},{projectId:'offline',files:[]}]]);
 assert.equal((await catalog.refresh('binari')).status,'cached');
 assert.equal((await catalog.refresh('other')).status,'cached');
 time=121_000;
 sim.items.get('binari')['project.json']=doc('New Binari');
 await catalog.compare(['binari']);
 assert.equal((await catalog.refresh('binari')).project.name,'New Binari');
 assert.deepEqual(sim.calls.at(-1),['download','binari','project.json',hash(doc('New Binari'))]);
 assert.deepEqual(readFileSync(join(root,'binari','icon.png')),png);
});

test('same project single-flight, another project independent; failed second download preserves both old files and freshness',async t=>{
 const root=temporary(t),sim=simulatedPDS();
 let now=0;
 const catalog=createLocalProjectFolders({root,pds:sim.service,now:()=>now});
 await catalog.compare(['binari']);
 await catalog.refresh('binari');
 now=60_000;
 const changedPng=Buffer.concat([png,Buffer.from([0])]);
 sim.items.set('binari',{'project.json':doc('New'),'icon.png':changedPng});
 let enter,release;
 const entering=new Promise(ok=>{enter=ok;}), gate=new Promise(ok=>{release=ok;});
 sim.fail(name=>name==='icon.png'?(enter(),gate.then(()=>Buffer.from('wrong bytes'))):undefined);
 await catalog.compare(['binari','other']);
 const failed=catalog.refresh('binari');
 assert.strictEqual(catalog.refresh('binari'),failed);
 await entering;
 assert.equal((await catalog.refresh('other')).project.name,'Other');
 release();
 await assert.rejects(failed,/PROJECT_FOLDERS_UNAVAILABLE/);
 assert.deepEqual(readFileSync(join(root,'binari','project.json')),doc('Binari'));
 assert.deepEqual(readFileSync(join(root,'binari','icon.png')),png);
 assert.deepEqual(readdirSync(join(root,'binari')).sort(),['.last-refresh','icon.png','project.json']);
 assert.equal(catalog.list(()=>true)[0].needsRefresh,true);
 sim.fail(null);
 await catalog.compare(['binari']);
 await catalog.refresh('binari');
 now=120_000;
 delete sim.items.get('binari')['icon.png'];
 assert.deepEqual(await catalog.compare(['binari']),{groups:[],unavailable:[]});
 assert.deepEqual(readFileSync(join(root,'binari','icon.png')),changedPng);
});

test('symlinked project folder is rejected without accessing or overwriting its target',async t=>{
 const root=temporary(t),sim=simulatedPDS();
 mkdirSync(root,{mode:0o700});mkdirSync(join(root,'target'),{mode:0o700});
 symlinkSync(join(root,'target'),join(root,'binari'));
 const catalog=createLocalProjectFolders({root,pds:sim.service});
 await assert.rejects(catalog.refresh('binari'),/PROJECT_FOLDERS_UNAVAILABLE/);
 assert.deepEqual(readdirSync(join(root,'target')),[]);
 assert.deepEqual(sim.calls,[]);
});

test('loopback HTTP contract and existing browser scope, including discovery filter and CSRF',async t=>{
 const sim=simulatedPDS(),pdsCalls=[];
 const backend=await listener(t,async(req,res)=>{
  const target=new URL(req.url,'http://127.0.0.1');
  pdsCalls.push([req.method,req.url,req.headers.authorization]);
  if(target.pathname==='/v1/project-folders')return res.end(JSON.stringify(await sim.service.discover()));
  if(target.pathname==='/v1/project-folders/compare'){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   return res.end(JSON.stringify(await sim.service.compare(JSON.parse(Buffer.concat(chunks)).groups)));
  }
  const [,id,name]=/^\/v1\/project-folders\/([^/]+)\/files\/([^/]+)$/.exec(target.pathname);
  return res.end(await sim.service.download(id,name,target.searchParams.get('sha256')));
 });
 const root=temporary(t);
 const store=createLocalProjectFolders({root,pds:projectFolderPDS(backend)});
 const session={contextId:'browser-fixture',principal:{projects:['binari']}};
 const read=req=>req.headers['x-test-session']==='valid'?session:null;
 const forbidden=()=>Object.assign(Error('DENIED'),{status:403});
 let origin;
 origin=await listener(t,async(req,res)=>{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  try{
   await localProjectFolderRoute(req,res,{origin,catalog:store,session:read(req),bytes:Buffer.concat(chunks),
    auth:{read,csrf(req){if(req.headers['x-test-csrf']!=='valid')throw forbidden();}},
    projectPermission(p,id,resource,write){assert.equal(resource,undefined);assert.equal(write,false);if(!p.projects.includes(id))throw forbidden();}});
  }catch(e){res.writeHead(e.status??503).end(JSON.stringify({error:e.message}));}
 });
 const base=origin+'/api/project-folders',headers={'x-test-session':'valid'};
 const get=(path,withSession=true)=>fetch(base+path,{headers:withSession?headers:{}});
 const post=(route,payload,opts={})=>fetch(base+'/'+route,{method:'POST',headers:{origin,...headers,
  'x-test-csrf':'valid','x-npcgen-frontend-context':'browser-fixture',...opts},body:JSON.stringify(payload)});
 const refresh=(projectId,opts)=>post('refresh',{projectId},opts);
 assert.equal((await get('',false)).status,401);
 assert.deepEqual(await (await get('')).json(),{projects:[]});
 assert.deepEqual(await (await get('/discover')).json(),{projects:['binari']});
 assert.equal((await refresh('other')).status,403);
 assert.equal((await refresh('binari',{'x-test-csrf':'bad'})).status,403);
 assert.equal((await refresh('binari',{origin:'http://example.com'})).status,403);
 assert.equal((await refresh('binari')).status,409);
 assert.equal((await post('compare',{projectIds:['binari','other']})).status,403);
 assert.equal((await post('compare',{projectIds:['binari','binari']})).status,400);
 const compare=await (await post('compare',{projectIds:['binari']})).json();
 assert.deepEqual(compare.groups.map(g=>g.projectId),['binari']);
 const refreshed=await (await refresh('binari')).json();
 assert.equal(refreshed.project.needsRefresh,false);
 assert.equal((await (await refresh('binari')).json()).status,'cached');
 assert.deepEqual(await (await get('')).json(),{projects:[refreshed.project]});
 const icon=await fetch(origin+refreshed.project.iconUrl,{headers});
 assert.equal(icon.headers.get('content-type'),'image/png');
 assert.deepEqual(Buffer.from(await icon.arrayBuffer()),png);
 assert.equal((await fetch(origin+refreshed.project.iconUrl.replace('binari','other'),{headers})).status,403);
 assert.deepEqual(pdsCalls.map(([method,url])=>[method,url.split('?')[0]]),[
  ['GET','/v1/project-folders'],['POST','/v1/project-folders/compare'],
  ['GET','/v1/project-folders/binari/files/project.json'],['GET','/v1/project-folders/binari/files/icon.png']]);
 assert.ok(pdsCalls.every(([,,auth])=>auth===undefined));
});

test('NGS refresh against the actual PDS project-folder handler',{skip:!process.env.PDS_PROJECT_FOLDER_SOURCE},async t=>{
 const {spawn}=await import('node:child_process');
 const {once}=await import('node:events');
 const {writeFileSync}=await import('node:fs');
 const {createInterface}=await import('node:readline');
 const root=temporary(t),canonical=join(root,'../canonical-files');
 mkdirSync(join(canonical,'binari'),{recursive:true});
 writeFileSync(join(canonical,'binari','project.json'),doc('Actual PDS'));
 const server=spawn('python3',['-B','-u','-c',`
import sys
from http.server import ThreadingHTTPServer
from project_data_service.http_server import Handler
from project_data_service.project_folders import configured
with ThreadingHTTPServer(('127.0.0.1',0),Handler) as server:
    server.project_folders=configured(sys.argv[1],'127.0.0.1')
    print(server.server_port,flush=True)
    server.serve_forever()
`,canonical],{cwd:join(process.env.PDS_PROJECT_FOLDER_SOURCE,'data-service'),stdio:['ignore','pipe','inherit']});
 const done=once(server,'close');
 t.after(async()=>{server.kill();await done;});
 const output=createInterface({input:server.stdout});
 const [port]=await Promise.race([once(output,'line'),done.then(()=>{throw Error('PDS fixture exited');})]);
 output.close();
 assert.match(port,/^[0-9]+$/);
 let time=0;
 const catalog=createLocalProjectFolders({root,pds:projectFolderPDS('http://127.0.0.1:'+port),now:()=>time});
 assert.deepEqual(await catalog.discover(),['binari']);
 assert.deepEqual((await catalog.compare(['binari','missing'])).unavailable,['missing']);
 assert.equal((await catalog.refresh('binari')).project.name,'Actual PDS');
 time=60_000;
 assert.deepEqual(await catalog.compare(['binari']),{groups:[],unavailable:[]});
 assert.deepEqual(readFileSync(join(root,'binari','project.json')),doc('Actual PDS'));
});

test('compare plan expires, is not restored on restart, and never overwrites intervening local bytes',async t=>{
 const root=temporary(t),sim=simulatedPDS();
 let time=1_000;
 const open=()=>createLocalProjectFolders({root,pds:sim.service,now:()=>time});
 const catalog=open();
 await catalog.compare(['binari']);
 await assert.rejects(open().refresh('binari'),/PROJECT_FOLDER_COMPARE_REQUIRED/);
 time=61_000;
 await assert.rejects(catalog.refresh('binari'),/PROJECT_FOLDER_COMPARE_REQUIRED/);
 await catalog.compare(['binari']);
 time=65_000;
 await catalog.refresh('binari');
 time=121_000;
 assert.equal(catalog.list(()=>true)[0].needsRefresh,false,'fresh for 60 seconds after apply, not from compare');
 time=125_000;
 assert.equal(catalog.list(()=>true)[0].needsRefresh,true);
 sim.items.get('binari')['project.json']=doc('canonical next');
 await catalog.compare(['binari']);
 const localPath=join(root,'binari','project.json');
 writeFileSync(localPath,doc('local advanced'));
 await assert.rejects(catalog.refresh('binari'),/PROJECT_FOLDER_COMPARE_REQUIRED/);
 assert.deepEqual(readFileSync(localPath),doc('local advanced'));
 assert.equal(catalog.list(()=>true)[0].needsRefresh,true);
});
