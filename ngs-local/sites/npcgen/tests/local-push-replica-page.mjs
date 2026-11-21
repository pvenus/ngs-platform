import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {configuration,createLocalProjectPageServer} from '../build/local-project-page-server.mjs';

test('push-owned browser replica reads local files and cannot start legacy PDS compare or write',async()=>{
 assert.deepEqual(configuration({NGS_FILE_SYNC_MODE:'pull',NGS_PROJECT_OPS_MCP_URL:'not-a-pds-url'}),
  configuration({}));
 const temp=mkdtempSync(join(realpathSync(tmpdir()),'ngs-push-page-')),root=join(temp,'replica');
 mkdirSync(root,{mode:0o700});
 mkdirSync(join(root,'binari'),{mode:0o700});
 writeFileSync(join(root,'binari','project.json'),JSON.stringify({projectId:'binari',name:'로컬 비나리'}),{mode:0o600});
 // An invalid PDS URL makes the fixture fail immediately if the browser creates a legacy adapter.
 const server=createLocalProjectPageServer({root,mcpUrl:'not-a-pds-url',fileSyncMode:'pull'});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const base='http://127.0.0.1:'+server.address().port,session=await fetch(base+'/__npcgen_session');
  const cookie=session.headers.get('set-cookie').split(';')[0],s=await session.json();
  const headers={cookie,origin:base,'content-type':'application/json','x-npcgen-csrf':s.csrfToken,'x-npcgen-frontend-context':s.contextId};
  const get=path=>fetch(base+path,{headers:{cookie}});
  const post=(path,body)=>fetch(base+path,{headers,method:'POST',body:JSON.stringify(body)});
  assert.deepEqual(await (await get('/api/project-folders')).json(),{projects:[{projectId:'binari',name:'로컬 비나리',iconUrl:null,needsRefresh:false}]});
  assert.deepEqual(await (await get('/api/project-folders/discover')).json(),{projects:['binari']});
  assert.deepEqual(await (await post('/api/project-folders/compare',{projectIds:['binari']})).json(),{groups:[],unavailable:[]});
  assert.deepEqual(await (await post('/api/folders/compare',{scope:'binari/audio'})).json(),{scope:'binari/audio',groups:[],unavailable:[]});
  assert.equal((await post('/api/project-folders/refresh',{projectId:'binari'})).status,409);
  assert.equal((await post('/api/folders/refresh',{scope:'binari/audio',folder:''})).status,409);
 }finally{
  await new Promise(resolve=>server.close(resolve));
  rmSync(temp,{recursive:true,force:true});
 }
});
