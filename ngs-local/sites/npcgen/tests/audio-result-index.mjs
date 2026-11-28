import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {mkdtemp, realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openLocalMiniflareReplica} from '../build/local-miniflare-runtime.mjs';
import {localObjectReplicaViews} from '../build/local-object-replica-views.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const oid=i=>'request.official.'+i.toString(16).padStart(64,'0');
const wave=Buffer.alloc(1644,0);wave.write('RIFF',0);wave.write('WAVE',8);
const metadata=(i,date=i,separated=false)=>Buffer.from(JSON.stringify({schemaVersion:'workflow.audio-result.v1',officialRequestId:oid(i),projectId:'binari',kind:'bgm',
 taskId:'workflow.task.'+sha(JSON.stringify([oid(i),separated?'audio_separate':'audio_generate'])),
 ...(separated?{separation:{sourceOfficialRequestId:oid(i-1),sourceSha256:sha(wave)}}:{}),
 payloadSha256:'0'.repeat(64),title:'fixture '+i,conceptId:'category.sound',
 source:{conceptId:'category.sound',sectionSha256:'a'.repeat(64)},bpm:100,bpmBasis:'model',generatedAt:date,
 audio:{path:'audio.wav',mimeType:'audio/wav',sha256:sha(wave),bytes:wave.length,channels:1,bitsPerSample:16,
 frames:800,sampleRate:8000,durationSeconds:.1}}));

const dependency=process.env.NGS_MINIFLARE_TEST_PACKAGE_JSON??process.env.SPACE_TEST_PACKAGE_JSON;
test('Local runtime: indexes native commit/tombstone, newest-first fixed pages without any provider reads',
 {skip:!dependency,timeout:30_000},async t=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'audio-result-index-')));
 const require=createRequire(dependency);
 const {replica,close}=await openLocalMiniflareReplica({persistRoot:root,fixture:true,load:async()=>require('miniflare').Miniflare});t.after(async()=>{await close();await rm(root,{recursive:true,force:true});});
 const adapter=localObjectReplicaViews({...replica,head(){assert.fail('unexpected head');},get(){assert.fail('unexpected get');},
  list(){assert.fail('unexpected list');}});
 const page=async params=>(await adapter.audio({authorize:id=>assert.equal(id,'binari'),
  query:new URLSearchParams({projectId:'binari',...params})})).json;
 await assert.rejects(page(),{status:503});
 const open=async()=>(await replica.call('ngs_file_sync_begin',{scope:'binari'})).syncId;
 let syncId=await open();
 const closePass=()=>replica.call('ngs_file_sync_finish',{syncId});
 assert.deepEqual(await page(),{projectId:'binari',results:[],nextCursor:null});
 const chunk=(id,name,data)=>replica.call('ngs_file_sync_file_chunk',{syncId,path:'audio/'+id+'/'+name,sha256:sha(data),
  size:data.length,offset:0,dataBase64:data.toString('base64')});
 for(let i=1;i<=62;i++){
  if(i%2===0)await chunk(oid(i),'audio.wav',wave);
  await chunk(oid(i),'metadata.json',metadata(i,i===61?62:i,i===62));
  if(i%2)await chunk(oid(i),'audio.wav',wave);
 }
 await chunk(oid(63),'metadata.json',metadata(63));  // Never present a partial pair.
 const first=await page();
 assert.equal(first.results.length,30);assert.equal(first.results[0].title,'fixture 62');
 assert.equal(first.results[0].separated,true);assert.equal(first.results[1].title,'fixture 61');
 const second=await page({cursor:first.nextCursor}); assert.equal(second.results.length,30);
 assert.equal(second.results[0].title,'fixture 32');
 const third=await page({cursor:second.nextCursor});
 assert.deepEqual(third.results.map(r=>r.title),['fixture 2','fixture 1']);assert.equal(third.nextCursor,null);
 assert.equal((await page({resultId:oid(1)})).result.title,'fixture 1');
 assert.equal((await page({resultId:oid(63)})).result,null);
 const manual=Buffer.alloc(44+20*8000*2);manual.write('RIFF');manual.write('WAVE',8);
 const title='수동 등록',manualHash=sha(manual),id='audio.import.'+sha(JSON.stringify(['ngs.audio-import.v1','binari',title,null,manualHash]));
 const manualMeta=Buffer.from(JSON.stringify({schemaVersion:'ngs.audio-import-result.v1',id,title,projectId:'binari',kind:'bgm',publishedAt:70,
  provenance:{mode:'owner-manual',source:null},audio:{path:'audio.wav',mimeType:'audio/wav',sha256:manualHash,bytes:manual.length,
   channels:1,bitsPerSample:16,sampleRate:8000,frames:20*8000,durationSeconds:20}}));
 await chunk(id,'metadata.json',manualMeta);
 assert.equal((await page({resultId:id})).result,null);
 await chunk(id,'audio.wav',manual);
 const item=(await page({resultId:id})).result;
 assert.equal(item.manual,true);assert.equal(item.title,title);
 assert.equal((await page()).results[0].title,title);
 await assert.rejects(page({cursor:'bad'}),{status:400});
 await closePass();
 syncId=await open();await replica.call('ngs_file_sync_plan',{syncId,totalFiles:1});
 const stream=ReadableStream.from([wave]);
 await replica.receiveWholeFile({syncId,path:'audio/'+oid(63)+'/audio.wav',sha256:sha(wave),size:wave.length},stream);
 assert.equal((await page()).results[0].title,title);
 assert.equal((await page({resultId:oid(63)})).result.title,'fixture 63');
 await closePass();
 syncId=await open();await replica.call('ngs_file_sync_remove',{syncId,path:'audio/'+oid(1)+'/audio.wav',sha256:sha(wave)});
 assert.equal((await page({resultId:oid(1)})).result,null);
 await replica.call('ngs_file_sync_remove',{syncId,path:'audio/'+id+'/audio.wav',sha256:manualHash});
 assert.equal((await page({resultId:id})).result,null);
 assert.deepEqual((await page({cursor:second.nextCursor})).results.map(r=>r.title),['fixture 2']);
 await closePass();
});
