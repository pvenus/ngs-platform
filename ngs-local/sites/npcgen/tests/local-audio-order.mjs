import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync,utimesSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {localAudioResults} from '../build/local-audio-results.mjs';

test('playlist follows canonical oldest-to-newest generation timestamps, not titles, ID or sync mtimes',t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ngs-audio-order-')));
 t.after(()=>rmSync(root,{force:true,recursive:true}));
 const digest=b=>createHash('sha256').update(b).digest('hex');
 for(const [prefix,title,generatedAt,replicaTime] of [['e','Z-first',123,202],['a','A-second',125,101],['b','B-old',undefined,530]]){
  const id='request.official.'+prefix.repeat(64),base=join(root,'binari','audio',id);
  mkdirSync(base,{recursive:true,mode:0o700});
  const audio=Buffer.alloc(46);writeFileSync(join(base,'audio.wav'),audio,{mode:0o600});
  const meta={schemaVersion:'workflow.audio-result.v1',projectId:'binari',kind:'bgm',officialRequestId:id,
   taskId:'workflow.task.'+digest(JSON.stringify([id,'audio_generate'])),title,generatedAt,
   payloadSha256:'0'.repeat(64),conceptId:'sound',source:{conceptId:'sound',sectionSha256:'1'.repeat(64)},
   audio:{path:'audio.wav',mimeType:'audio/wav',sha256:digest(audio),bytes:audio.length,channels:1,bitsPerSample:16,sampleRate:8000,frames:1,durationSeconds:1/8000}};
  const loc=join(base,'metadata.json');writeFileSync(loc,JSON.stringify(meta),{mode:0o600});utimesSync(loc,replicaTime,replicaTime);
 }
 const out=localAudioResults({root,query:new URLSearchParams({projectId:'binari'}),authorize:()=>{}});
 assert.deepEqual(out.json.results.map(r=>r.title),['B-old','Z-first','A-second']);
});
