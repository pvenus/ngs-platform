import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createViewer,binariSpace} from '../viewer.mjs';
import {openMirror} from '../lib/mirror.mjs';

async function fixture(t){
 const temp=await realpath(await mkdtemp(join(tmpdir(),'ngs-viewer-test-')));
 const windows=process.platform==='win32',root=windows?join(temp,'private P2'):temp;
 const mirror=windows?await openMirror(root,{create:true}):null;
 const viewer=await createViewer({root,mirror});
 await new Promise((resolve,reject)=>{viewer.once('error',reject);viewer.listen(0,'127.0.0.1',resolve);});
 t.after(async()=>{await new Promise(resolve=>viewer.close(resolve));await rm(temp,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+viewer.address().port,get=(path,init)=>fetch(origin+path,init);
 const config=await (await get('/__viewer/config')).json();
 const write=(path,value,extra={})=>get('/__viewer/'+path,{
  method:'POST',headers:{Origin:origin,'x-ngs-viewer-key':config.guardKey,'Content-Type':'application/json',...extra},
  body:value instanceof Uint8Array?value:JSON.stringify(value)});
 return {root,origin,config,write,get};
}

test('viewer uses same shared app shell but exposes neither request nor OPS/server routes',async t=>{
 const {get,config,write}=await fixture(t);
 assert.equal(config.spaceOrigin,binariSpace);
 assert.match(await (await get('/')).text(),/NGS Viewer/);
 assert.match(await (await get('/local-project-page.js')).text(),/submitQueuedRequest/);
 assert.equal((await get('/local-project-page-server.mjs')).status,404);
 assert.equal((await get('/api/requests')).status,404);
 assert.equal((await get('/__npcgen_session')).status,404);
 assert.equal((await get('/api/requests',{method:'POST',headers:{Origin:'http://evil.example'},body:'{}'})).status,403);
 assert.equal((await get('/api/space-machine-mcp')).status,404);
 assert.equal((await get('/api/project-folders')).status,503);
 assert.equal((await write('disconnect',{}, {Origin:'http://evil.example'})).status,403);
 assert.equal((await write('disconnect',{}, {'x-ngs-viewer-key':'x'.repeat(64)})).status,403);
});

test('hash-pinned P2 files drive the existing project DTO, only after full installation',async t=>{
 const {root,get,write}=await fixture(t);
 const data=Buffer.from(JSON.stringify({title:'비나리'}));
 const item={path:'project.json',sha256:createHash('sha256').update(data).digest('hex'),size:data.length};
 const manifest={projectId:'binari',resources:['project'],files:[item]};
 const start=await write('sync/start',{});assert.equal(start.status,202);
 const {id}=await start.json();
 assert.equal((await get('/api/project-folders')).status,503);
 let outcome;
 for(let i=0;i<100;i++){
  const r=await (await write('sync/poll',{id})).json();
  if(r.state!=='running'){outcome=r;break;}
  for(const job of r.jobs){
   const headers={'Content-Type':'application/octet-stream','x-ngs-viewer-upstream-status':'200'};
   const route=new URL(job.path,'http://127.0.0.1');
   let bytes;
   if(route.pathname==='/api/viewer/manifest')bytes=Buffer.from(JSON.stringify(manifest));
   else{
    assert.equal(route.pathname,'/api/viewer/file');
    assert.equal(route.searchParams.get('path'),item.path);
    assert.equal(route.searchParams.get('offset'),'0');
    bytes=data;
    Object.assign(headers,{'x-ngs-file-size':String(item.size),'x-ngs-file-sha256':item.sha256,'x-ngs-file-offset':'0'});
   }
   assert.equal((await write('sync/reply?'+new URLSearchParams({id,job:job.id}),bytes,headers)).status,200);
  }
  await new Promise(resolve=>setTimeout(resolve,5));
 }
 assert.equal(outcome?.state,'completed',JSON.stringify(outcome));
 assert.deepEqual(await readFile(join(root,'binari','project.json')),data);
 assert.deepEqual(await (await get('/api/project-folders')).json(),
   {projects:[{projectId:'binari',name:'비나리',iconUrl:null,needsRefresh:false}]});
 assert.equal((await get('/api/npc-workspace?projectId=binari')).status,403);
 await write('disconnect',{});
 assert.equal((await get('/api/project-folders')).status,503);
});
