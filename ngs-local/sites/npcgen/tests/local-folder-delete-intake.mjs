import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {fileDeleteType,npcFolderDeletePayload,propFolderDeletePayload} from '../build/prop-folder-delete-contract.mjs';

test('Local accepts pinned deletes without requiring an NPC or prop replica to exist',async t=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'ngs-pinned-delete-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const root=join(dir,'projects');mkdirSync(root,{mode:0o700});
 const jobs=[];let ready=false;
 const server=createLocalProjectPageServer({root,readNpcFolderDeleteReady:async()=>ready,readPropFolderDeleteReady:async()=>ready,
  requestQueue:{enqueue(cmd){jobs.push(cmd);return {status:'queued'};}}});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 const origin='http://127.0.0.1:'+server.address().port,boot=await fetch(origin+'/__npcgen_session');
 const cookie=boot.headers.get('set-cookie').split(';')[0],session=await boot.json();
 const auth={cookie,origin,'X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId};
 const npc=npcFolderDeletePayload({id:'character.replaced',expected:{creationTaskId:'workflow.task.'+'a'.repeat(64)}});
 const prop=propFolderDeletePayload({id:'missing-prop',expected:{revision:9,sha256:'b'.repeat(64)}});
 const send=(payload,key,headers=auth)=>fetch(origin+'/api/requests',{method:'POST',headers:{'Content-Type':'application/json',...headers},
  body:JSON.stringify({requestType:fileDeleteType,idempotencyKey:key,payload})});
 assert.equal((await send(npc,'no-auth',{origin})).status,401);
 assert.equal((await send(npc,'not-ready')).status,404);
 ready=true;
 assert.equal((await send(npc,'bad-csrf',{...auth,'X-NPCGen-Csrf':'wrong'})).status,403);
 assert.equal((await send({...prop,expected:{revision:9}},'bad-pin')).status,400);
 assert.equal((await send(npc,'npc')).status,202);
 assert.equal((await send(prop,'prop')).status,202);
 assert.deepEqual(jobs.map(c=>c.payload),[npc,prop]);
});
