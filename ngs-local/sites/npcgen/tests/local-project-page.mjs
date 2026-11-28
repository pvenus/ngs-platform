import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {request} from 'node:http';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {configuration,createLocalProjectPageServer} from '../build/local-project-page-server.mjs';

const icon=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
async function listen(t,server){
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port;
}
function fakeHost(origin){
 return new Promise((resolve,reject)=>{
  request(origin,{headers:{Host:'forged.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject).end();
 });
}
test('browser auth and exact read-only catalog contract do not depend on legacy PDS configuration',async t=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-project-page-'));
 const root=join(parent,'projects');
 mkdirSync(root,{mode:0o700});
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 assert.equal(configuration({}).port,5274);
 assert.equal(configuration({}).npcBasicPortraitEnabled,true);
 assert.equal(configuration({NGS_NPC_BASIC_PORTRAIT_ENABLED:"0"}).npcBasicPortraitEnabled,true);
 assert.equal(configuration({}).npcScopedPortraitEnabled,false);
 assert.throws(()=>configuration({NGS_PROJECT_LISTEN_PORT:'0'}),/LOCAL_PROJECT_PORT_INVALID/);
 const origin=await listen(t,createLocalProjectPageServer({root,mcpUrl:'https://invalid.example/mcp',fileSyncMode:'pull'}));
 const home=await fetch(origin);
 assert.equal(home.status,200);assert.match(await home.text(),/어떤 이야기를 만들까요\?/);
 assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.match((await fetch(origin+'/local-project-page.js')).headers.get('content-type'),/text\/javascript/);
 assert.equal((await fetch(origin+'/api/npcs')).status,404);
 assert.equal((await fetch(origin+'/api/project-folders')).status,401);
 assert.equal(await fakeHost(origin),403);
 assert.equal((await fetch(origin+'/__npcgen_session',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 const start=await fetch(origin+'/__npcgen_session');
 const session=await start.json(),cookie=start.headers.get('set-cookie').split(';')[0];
 assert.match(start.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 assert.equal(session.state,'authenticated');
 const get=path=>fetch(origin+path,{headers:{cookie}});
 const post=(path,body,extra={})=>fetch(origin+path,{method:'POST',headers:{cookie,origin,
  'Content-Type':'application/json','x-npcgen-csrf':session.csrfToken,
  'x-npcgen-frontend-context':session.contextId,...extra},body:JSON.stringify(body)});
 assert.deepEqual(await (await get('/api/project-folders/discover')).json(),{projects:[]});
 mkdirSync(join(root,'binari'),{mode:0o700});
 writeFileSync(join(root,'binari','project.json'),'{"name":"비나리"}',{mode:0o600});
 writeFileSync(join(root,'binari','icon.png'),icon,{mode:0o600});
 const {projects}=await (await get('/api/project-folders')).json();
 const sha256=createHash('sha256').update(icon).digest('hex');
 assert.deepEqual(projects,[{projectId:'binari',name:'비나리',needsRefresh:false,
  iconUrl:'/api/project-folders/icon?projectId=binari&sha256='+sha256}]);
 assert.deepEqual(await (await get('/api/project-folders/discover')).json(),{projects:['binari']});
 const served=await get(projects[0].iconUrl);
 assert.equal(served.headers.get('content-type'),'image/png');
 assert.deepEqual(Buffer.from(await served.arrayBuffer()),icon);
 assert.equal((await fetch(origin+projects[0].iconUrl)).status,401);
 assert.equal((await post('/api/project-folders/compare',{projectIds:['unapproved']})).status,403);
 assert.equal((await post('/api/project-folders/compare',{projectIds:['binari']},{origin:'http://foreign.example'})).status,403);
 assert.equal((await post('/api/project-folders/compare',{projectIds:['binari']},{'x-npcgen-csrf':'abc'})).status,403);
 assert.equal((await post('/api/project-folders/compare',{projectIds:['binari']},{'x-npcgen-frontend-context':'wrong'})).status,409);
 assert.deepEqual(await (await post('/api/project-folders/compare',{projectIds:['binari']})).json(),{groups:[],unavailable:[]});
 assert.equal((await post('/api/folders/compare',{scope:'binari/.deleted-sync'})).status,400);
 assert.deepEqual(await (await post('/api/folders/compare',{scope:'binari/audio'})).json(),{scope:'binari/audio',groups:[],unavailable:[]});
 for(const [path,body] of [['/api/project-folders/refresh',{projectId:'binari'}],['/api/folders/refresh',{scope:'binari/audio',folder:''}]]){
  const r=await post(path,body);assert.equal(r.status,409);
  assert.deepEqual(await r.json(),{error:'NGS_FILE_SYNC_PUSH_OWNED'});
 }
});


test('installed Local release exposes its workspace actions without probing Workflow or reading legacy feature flags',async t=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-release-session-'));
 t.after(()=>rmSync(parent,{recursive:true,force:true}));
 const config=configuration({NGS_PROJECT_CATALOG_ROOT:join(parent,'catalog'),NGS_AUDIO_WORKSPACE_ENABLED:'0',
  NGS_NPC_BASIC_PORTRAIT_ENABLED:'0',NGS_POSE_SELECTION_V2_ENABLED:'0'});
 const server=createLocalProjectPageServer({...config,requestQueue:{},readMapReady:()=>assert.fail('unexpected readiness probe')});
 const origin=await listen(t,server);
 const response=await fetch(origin+'/__npcgen_session');
 assert.equal(response.status,200);
 const session=await response.json();
 for(const [key,value] of Object.entries(config.releaseCapabilities))assert.deepEqual(session[key],value);
 assert.equal(session.npcScopedPortraitEnabled,undefined);
 assert.match(session.puzzleCoreVersion,/^[a-f0-9]{64}$/u);
 const path='/puzzle-core/'+session.puzzleCoreVersion+'/_framework/dotnet.js';
 assert.equal((await fetch(origin+path)).status,401);
 const asset=await fetch(origin+path,{headers:{cookie:response.headers.get('set-cookie').split(';')[0]}});
 assert.equal(asset.status,200);assert.match(asset.headers.get('content-type'),/javascript/);
 assert.ok((await asset.text()).length>100);
});
