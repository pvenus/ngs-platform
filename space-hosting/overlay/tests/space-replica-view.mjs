/** Real workerd D1 + R2, sterile synthetic publications and owner-auth fixtures only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const here=x=>new URL(x,import.meta.url);
const {Miniflare}=createRequire(process.env.SPACE_TEST_PACKAGE_JSON??here('../../../sites/npcgen/package.json'))('miniflare');
const mod=(path,filename)=>({type:'ESModule',path,contents:readFileSync(here(filename),'utf8')});
const shared='ngs-local/sites/npcgen/build/';
const sharedRoot=existsSync(here('../'+shared+'object-replica-view.mjs'))?'../':'../../../';

const mini=new Miniflare({d1Databases:['DB'],r2Buckets:['BUCKET'],compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
 modules:[{type:'ESModule',path:'test.mjs',contents:`
 import {createSpaceFileReplica} from './build/space-file-replica.mjs';
 import {spaceReplicaView} from './build/space-replica-view.mjs';
 export default {fetch(request,env){
  const replica=createSpaceFileReplica({db:env.DB,bucket:env.BUCKET});
  return spaceReplicaView(request,replica,{authorize:async (user,project)=>user.userId==='owner-fixture'&&project==='binari'})
   .then(response=>response??new Response(null,{status:404}));
 }};
 `},mod('build/space-file-replica.mjs','../build/space-file-replica.mjs'),mod('build/space-replica-view.mjs','../build/space-replica-view.mjs'),
 mod(shared+'object-replica-view.mjs',sharedRoot+shared+'object-replica-view.mjs'),
 mod(shared+'local-audio-workspace.mjs',sharedRoot+shared+'local-audio-workspace.mjs'),
 mod(shared+'local-request-queue-browser.mjs',sharedRoot+shared+'local-request-queue-browser.mjs'),mod(shared+'object-replica.mjs',sharedRoot+shared+'object-replica.mjs'),mod(shared+'replica-whole-file-wire.mjs',sharedRoot+shared+'replica-whole-file-wire.mjs')],
});
const hash=x=>createHash('sha256').update(x).digest('hex');
const auth={'oai-authenticated-user-id':'owner-fixture','oai-authenticated-user-email':'owner@example.invalid'};
const send=(path,headers=auth,method='GET')=>mini.dispatchFetch('http://site.invalid'+path,{method,headers});
const path='/api/audio-workspace?projectId=binari',prefix='ngs-replica/v1/binari/files/';
const missing='request.official.'+'1'.repeat(64),one='request.official.'+'2'.repeat(64),two='request.official.'+'a'.repeat(64);
const data=Buffer.alloc(1644,0);data.write('RIFF',0);data.write('WAVE',8);
const sha256=hash(data);
const title='Fixture BGM';
const meta=(id,generatedAt,t=title)=>({schemaVersion:'workflow.audio-result.v1',projectId:'binari',kind:'bgm',officialRequestId:id,
 taskId:'workflow.task.'+hash(JSON.stringify([id,'audio_generate'])),payloadSha256:'0'.repeat(64),
 title:t,conceptId:'category.audio',source:{conceptId:'category.audio',sectionSha256:'a'.repeat(64)},
 bpm:83,bpmBasis:'model',generatedAt,audio:{path:'audio.wav',mimeType:'audio/wav',sha256,bytes:data.length,channels:1,bitsPerSample:16,
 sampleRate:8000,frames:800,durationSeconds:0.1}});
try{
 const db=await mini.getD1Database('DB');
 const schema=readFileSync(here(sharedRoot+'ngs-local/dev/0014_space_file_replica_versions.sql'),'utf8');
 for(const sql of schema.split('--> statement-breakpoint'))await db.prepare(sql).run();
 const bucket=await mini.getR2Bucket('BUCKET');
 async function publish(path,body,extra={}){
  if(!Buffer.isBuffer(body))body=Buffer.from(JSON.stringify(body));
  await bucket.put(prefix+path,body,{customMetadata:{sha256:hash(body),...extra}});
 }
 await publish('project.json',{name:'Replica fixture'});
 const icon=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
 await publish('icon.png',icon);
 for(const [id,when,t] of [[one,200,title],[two,100,'Earlier fixture'],[missing,50,'Missing wave']]){
  await publish('audio/'+id+'/metadata.json',meta(id,when,t));
  if(id!==missing)await publish('audio/'+id+'/audio.wav',data);
 }
 const derived='request.official.'+'f'.repeat(64),invalid='request.official.'+'d'.repeat(64);
 for(const id of [derived,invalid]){
  await publish('audio/'+id+'/metadata.json',{...meta(id,300,'Fixture BGM (반주)'),
   taskId:'workflow.task.'+hash(JSON.stringify([id,id===derived?'audio_separate':'audio_generate'])),
   separation:{sourceOfficialRequestId:one,sourceSha256:sha256},bpm:null,bpmBasis:'unavailable'});
  await publish('audio/'+id+'/audio.wav',data);
 }
 await bucket.put('legacy/private.json','not a replica');
 const markdown=Buffer.from('# Sound fixture');
 await publish('concept/sections/category.audio/content.md',markdown);
 await publish('concept/sections/category.legacy/metadata.json',{id:'category.legacy',title:'Legacy sound fixture'});
 await publish('concept/metadata.json',{
  sectionIds:['category.other','category.audio','category.legacy','category.archive','category.pending'],
  document:{hierarchy:{schemaVersion:'npc-concept-groups.v1',groups:[
   {id:'group.narrative',title:'Story',categoryIds:['category.other']},
   {id:'group.sound',title:'Audio',categoryIds:['category.audio','category.pending','category.legacy']},
  ],archivedCategoryIds:['category.archive']}},
  _markdownSections:{'category.audio':{mode:'authored',sha256:hash(markdown),title:'Sound fixture',priority:1},
   'category.pending':{mode:'authored',sha256:hash('# Not synced yet'),title:'Pending incomplete fixture',priority:2}},
 });
 assert.equal((await send('/api/project-folders',{})).status,401);
 assert.equal((await send('/api/project-folders',{...auth,'oai-authenticated-user-id':'no-grant'})).status,403);
 assert.equal((await send('/api/project-folders',{...auth,'sec-fetch-site':'cross-site'})).status,403);
 assert.equal((await send('/api/project-folders',auth,'POST')).status,405);
 const list=await (await send('/api/project-folders')).json();
 assert.deepEqual(list.projects,[{projectId:'binari',name:'Replica fixture',needsRefresh:false,
  iconUrl:'/api/project-folders/icon?projectId=binari&sha256='+hash(icon)}]);
 assert.deepEqual(Buffer.from(await (await send(list.projects[0].iconUrl)).arrayBuffer()),icon);
 assert.equal((await send(list.projects[0].iconUrl.replace('binari','elsewhere'))).status,403);
 assert.equal((await send('/api/project-workspace?projectId=binari')).status,404);
 assert.deepEqual(await (await send('/api/space/audio-concepts')).json(),{concepts:[
  {id:'category.audio',label:'Sound fixture'},{id:'category.legacy',label:'Legacy sound fixture'},
 ]});
 const results=await (await send(path)).json();
 assert.deepEqual(results.results.map(r=>r.title),['Earlier fixture',title,'Fixture BGM (반주)']);
 assert.equal(results.results[2].separated,true);
 assert.deepEqual(Buffer.from(await (await send(results.results[2].url)).arrayBuffer()),data);
 assert.equal(results.results[1].bpm,83);assert.equal(results.results[1].durationSeconds,0.1);
 const url=results.results[1].url;
 const partial=await send(url,{...auth,Range:'bytes=10-13'});
 assert.equal(partial.status,206);assert.equal(partial.headers.get('Content-Range'),'bytes 10-13/1644');
 assert.deepEqual(Buffer.from(await partial.arrayBuffer()),data.subarray(10,14));
 assert.equal((await send(url,auth,'HEAD')).headers.get('Content-Length'),'1644');
 assert.equal((await send(url,{...auth,Range:'bytes=2000-3000'})).status,416);
 assert.equal((await send(url.replace(sha256,'f'.repeat(64)))).status,404);
 assert.equal((await send(path+'&rawPath=legacy/private.json')).status,400);
 await bucket.put(prefix+'audio/'+one+'/audio.wav',new Uint8Array(),{customMetadata:{sha256,removed:'1'}});
 assert.equal((await send(url)).status,404);
 assert.deepEqual((await (await send(path)).json()).results.map(r=>r.title),['Earlier fixture','Fixture BGM (반주)']);
 console.log('Space replica view: real workerd R2 project/icon, authorized sound options, BGM/range and fail-closed tests PASS');
}finally{await mini.dispose();}
