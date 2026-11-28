import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,realpath,mkdir,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {audioCursor,audioIndexPath,audioIndexQuery,audioResultSummary,parseAudioCursor} from '../build/audio-result-index.mjs';
import {localAudioResults,localAudioSeparationSource} from '../build/local-audio-results.mjs';
import {audioFile} from '../build/object-replica-view.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
test('manual catalog round trip, exact pinned WAV, mixed pagination and disabled separation',async t=>{
 const title='비나리 · 타이틀 BGM (27초 루프)',source={sourceOfficialRequestId:'request.official.'+'a'.repeat(64),sourceSha256:'b'.repeat(64)};
 const wav=Buffer.alloc(44+27*8000*2);wav.write('RIFF');wav.write('WAVE',8);
 const wavHash=sha(wav),id='audio.import.'+sha(JSON.stringify(['ngs.audio-import.v1','binari',title,source,wavHash]));
 const meta={schemaVersion:'ngs.audio-import-result.v1',id,title,projectId:'binari',kind:'bgm',publishedAt:150,
  provenance:{mode:'owner-manual',source},audio:{path:'audio.wav',mimeType:'audio/wav',sha256:wavHash,
   bytes:wav.length,channels:1,bitsPerSample:16,sampleRate:8000,frames:27*8000,durationSeconds:27}};
 assert.equal(audioResultSummary(meta,id).sha256,wavHash);
 assert.equal(audioResultSummary({...meta,title:'wrong'},id),null);
 assert.equal(audioIndexPath('audio/'+id+'/audio.wav')[1],id);
 assert.deepEqual(parseAudioCursor(audioCursor({generated_at:150,id})),{id,date:150});
 assert.deepEqual(parseAudioCursor(audioCursor({generated_at:150,id:source.sourceOfficialRequestId})),{id:source.sourceOfficialRequestId,date:150});
 assert.deepEqual(audioIndexQuery(new URLSearchParams({projectId:'binari',resultId:id})),{projectId:'binari',resultId:id});
 const root=await realpath(await mkdtemp(join(tmpdir(),'manual-audio-catalog-')));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const folder=join(root,'binari/audio',id);await mkdir(folder,{recursive:true,mode:0o700});
 const metadata=Buffer.from(JSON.stringify(meta));
 await writeFile(join(folder,'metadata.json'),metadata,{mode:0o600});await writeFile(join(folder,'audio.wav'),wav,{mode:0o600});
 const query=new URLSearchParams({projectId:'binari',id,sha256:wavHash});
 const args={root,authorize:projectId=>assert.equal(projectId,'binari')};
 const row=localAudioResults({...args,query:new URLSearchParams({projectId:'binari'})}).json.results[0];
 assert.equal(row.manual,true);assert.equal(row.title,title);
 assert.deepEqual(localAudioResults({...args,query}).bytes,wav);
 assert.equal(localAudioSeparationSource(root,{sourceOfficialRequestId:id,sourceSha256:wavHash}),false);
 const files=new Map([['audio/'+id+'/metadata.json',metadata],['audio/'+id+'/audio.wav',wav]]);
 const replica={
  async head(path){const bytes=files.get(path);return bytes&&{size:bytes.length,etag:sha(bytes),customMetadata:{sha256:sha(bytes)}};},
  async get(path,{range}={}){const bytes=files.get(path);if(!bytes)return;const body=range?bytes.subarray(range.offset,range.offset+range.length):bytes;
   return {...await this.head(path),arrayBuffer:async()=>Uint8Array.from(body).buffer,body:ReadableStream.from([body])};}
 };
 const response=await audioFile(new Request('http://localhost'),replica,query);
 assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav);
});
