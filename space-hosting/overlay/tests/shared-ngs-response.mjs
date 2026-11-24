import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSharedNgsResponse,withProductionAudio} from '../build/shared-ngs-response.mjs';
import {rejectCleanSpaceRequest} from '../build/clean-space-guard.mjs';

const native={'oai-authenticated-user-id':'fixture','oai-authenticated-user-email':'fixture@example.invalid'};
const root='https://sites.example';
const fixture=new Map([['/',{type:'text/html; charset=utf-8',body:withProductionAudio('<html lang="ko">\n</html>')}],
 ['/local-project-page.js',{type:'text/javascript; charset=utf-8',body:'export {};'}]]);
const adapter=createSharedNgsResponse(fixture);
const request=(path,method='GET',headers=native)=>new Request(root+path,{method,headers});

test('only native Site authentication can load the exact shared shell and module',async()=>{
 const unauth=adapter(request('/?projectId=binari&tab=audio','GET',{}));
 assert.equal(unauth.status,302);
 assert.equal(unauth.headers.get('Location'),'/signin-with-chatgpt?return_to=%2F%3FprojectId%3Dbinari%26tab%3Daudio');
 const shell=adapter(request('/'));
 assert.equal(shell.status,200);
 assert.match(shell.headers.get('Cache-Control'),/no-store/);
 assert.equal(await shell.text(),'<html lang="ko" data-audio-workspace="enabled">\n</html>');
 assert.equal(await adapter(request('/local-project-page.js')).text(),'export {};');
 assert.equal((await adapter(request('/local-project-page.js','HEAD')).text()),'');
 assert.equal(adapter(request('/local-project-page.js','GET',{'x-npcgen-frontend-context':'legacy'})).status,401);
 assert.equal(adapter(request('/','POST')).status,405);
 assert.throws(()=>withProductionAudio('<html>'),/UNCONFIRMED/);
});

test('explicit disconnected seam grants no local session and never falls back to legacy data',async()=>{
 for(const [method,path] of [['GET','/__npcgen_session'],['GET','/api/project-folders'],
  ['GET','/api/audio-workspace?projectId=binari'],['POST','/api/requests'],['POST','/api/folders/compare']]){
  const response=adapter(request(path,method));
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'LIVE_NGS_BACKEND_NOT_CONNECTED'});
  for(const key of ['Set-Cookie','X-NPCGen-Frontend-Context'])assert.equal(response.headers.has(key),false);
 }
 assert.equal(adapter(request('/api/project-workspace','GET',{})).status,401);
 assert.equal(adapter(request('/api/requests','GET')).status,405);
 for(const path of ['/api/space/audio-workspace','/api/space/audio-concepts','/api/space/audio-requests'])
  assert.equal(adapter(request(path)).status,404);
 for(const path of ['/api/mirror','/api/project-display/icon','/transfers','/prompt']){
  assert.equal(adapter(request(path)),null);
  assert.equal((await rejectCleanSpaceRequest(request(path))).status,404);
 }
});

test('hosted bundling uses the single authored Local source tree, with no parallel assets',()=>{
 const imports=readFileSync(new URL('../build/shared-ngs-assets.ts',import.meta.url),'utf8');
 const paths=[...imports.matchAll(/from "\.\.\/ngs-local\/sites\/npcgen\/(.+?)\?(?:raw|inline)";/g)].map(m=>m[1]);
 assert.deepEqual(paths,[
  'build/local-project-page.html','build/local-project-page.css','build/local-project-page.js','build/prop-package-contract.mjs','build/cinematic-workspace-ui.mjs','build/cinematic-contract.mjs','build/prop-workspace-ui.mjs','build/prop-workspace-contract.mjs','build/local-npc-workspace-ui.mjs',
  'build/local-npc-one-stop-ui.mjs','build/npc-motion-selection.mjs','build/local-concept-category-ui.mjs','build/local-concept-category-contract.mjs',
  'build/local-npc-planning-ui.mjs','build/local-audio-workspace.mjs','build/local-request-queue-browser.mjs',
  'build/motion-preset-convert-2d.mjs',
 ]);
 const exactAssets=new Set(paths);
 for(const path of paths.filter(path=>/\.m?js$/.test(path))){
  const source=readFileSync(new URL('../ngs-local/sites/npcgen/'+path,import.meta.url),'utf8');
  for(const [,importName] of source.matchAll(/^import[^\n]+from ['"]\.\/([^'"]+)['"]/gm))
   assert(exactAssets.has('build/'+importName),path+' references unserved '+importName);
 }
 assert(!/shared-ngs-frontend|catalog\/bgm-workspace/.test(imports));
});
