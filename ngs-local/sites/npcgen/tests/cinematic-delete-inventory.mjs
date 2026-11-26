import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {cinematicDeletePayloads,cinematicDeleteRoot,fileDeleteType} from '../build/prop-folder-delete-contract.mjs';

const sha='3'.repeat(64),seq='request.official.'+'4'.repeat(64),clip='request.official.'+'5'.repeat(64);
const inventory={sourceSha256:sha,targets:[
 {root:cinematicDeleteRoot,path:'sequences/'+seq,kind:'directory'},
 ...['results/'+clip+'.mp4','results/'+clip+'.json','sources/'+sha+'.json','sources/'+sha+'.png']
  .map(path=>({root:cinematicDeleteRoot,path,kind:'file'}))
]};
test('cinematic selection uses one canonical physical target per request from an authenticated server inventory',async t=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'ngs-cinematic-delete-'));t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const root=join(dir,'projects');mkdirSync(root,{mode:0o700});
 let enabled=false;const jobs=[];
 const server=createLocalProjectPageServer({root,readCinematicDeleteReady:async()=>enabled,
  readCinematicDeleteInventory:async source=>{assert.equal(source,sha);return inventory;},
  requestQueue:{enqueue(c){jobs.push(c);return {status:'queued'};}}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
 const origin='http://127.0.0.1:'+server.address().port;
 const get=origin+'/api/cinematic-delete-inventory?projectId=binari&sourceSha256='+sha;
 assert.equal((await fetch(get)).status,401);
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0];
 const session=await boot.json(),headers={cookie,origin,'Content-Type':'application/json',
  'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId};
 assert.equal(session.cinematicDeleteEnabled,undefined);
 assert.equal((await fetch(get,{headers:{cookie}})).status,404);
 enabled=true;
 const r=await fetch(get,{headers:{cookie}});assert.equal(r.status,200);
 const payloads=cinematicDeletePayloads(sha,await r.json());
 assert.deepEqual(payloads.map(x=>x.target),inventory.targets);
 assert.throws(()=>cinematicDeletePayloads(sha,{...inventory,targets:[...inventory.targets,inventory.targets[0]]}),/INVENTORY_INVALID/);
 assert.throws(()=>cinematicDeletePayloads(sha,{...inventory,sourceSha256:'4'.repeat(64)}),/INVENTORY_INVALID/);
 for(const [i,payload] of payloads.entries()){
  const response=await fetch(origin+'/api/requests',{method:'POST',headers,body:JSON.stringify({requestType:fileDeleteType,idempotencyKey:'exact-'+i,payload})});
  assert.equal(response.status,202);
 }
 assert.deepEqual(jobs.map(x=>x.payload),payloads);
});
