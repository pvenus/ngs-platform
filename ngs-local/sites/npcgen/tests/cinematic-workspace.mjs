import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {cinematicType,cinematicPath,cinematicSchema,cinematicResultSchema,validCinematicPayload} from '../build/cinematic-contract.mjs';
import {cinematicVideoResponse} from '../build/cinematic-workspace.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
const mp4=Buffer.alloc(40);mp4.writeUInt32BE(24);mp4.write('ftypisom',4);
const sha=b=>createHash('sha256').update(b).digest('hex');
const base=cinematicPath+'?projectId=binari';
const sourceSha256=sha(png),id='request.official.'+'a'.repeat(64);
const payload={schemaVersion:cinematicSchema,projectId:'binari',sourceSha256,motionPrompt:'The jacket opens.'};
const result={schemaVersion:cinematicResultSchema,projectId:'binari',sourceSha256,officialRequestId:id,
 sha256:sha(mp4),bytes:mp4.length,mimeType:'video/mp4',width:512,height:352,fps:24,frameCount:45};
test('Local NGS authenticates and scopes ready cinematic intake plus verified replica playback',async t=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-cinematic-'));
 const root=join(parent,'projects');
 t.after(()=>rmSync(parent,{force:true,recursive:true}));
 for(const p of ['sources','results'])mkdirSync(join(root,'binari','cinematics',p),{mode:0o700,recursive:true});
 writeFileSync(join(root,'binari','project.json'),'{"name":"비나리"}',{mode:0o600});
 const lock=join(root,'binari','cinematics');
 writeFileSync(join(lock,'sources',sourceSha256+'.png'),png,{mode:0o600});
 writeFileSync(join(lock,'results',id+'.json'),JSON.stringify(result),{mode:0o600});
 let registered;
 let ready=false;
 const server=createLocalProjectPageServer({root,readCinematicReady:async()=>ready,
  requestQueue:{enqueue(cmd){registered=cmd;return {queueId:'ngs.local.a82bf7f5-c880-49e5-b490-3712b02eef72',status:'queued'};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 assert.equal((await fetch(origin+base)).status,401);
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0];
 const {csrfToken,contextId,cinematicEnabled}=await boot.json();
 assert.equal(cinematicEnabled,undefined);
 const get=(p,extra={})=>fetch(origin+p,{headers:{cookie,...extra}});
 const submit=(p,extra={})=>fetch(origin+'/api/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
  'x-npcgen-csrf':csrfToken,'x-npcgen-frontend-context':contextId,...extra},
  body:JSON.stringify({requestType:cinematicType,idempotencyKey:'one-cinematic',payload:p})});
 assert.deepEqual(await (await get(base)).json(),{clips:[],sources:[sourceSha256],sequences:[]});
 assert.equal((await submit(payload)).status,404);
 ready=true;
 assert.equal((await (await get('/__npcgen_session')).json()).cinematicEnabled,true);
 assert.equal((await submit({...payload,sourceSha256:'f'.repeat(64)})).status,404);
 assert.equal((await submit({...payload,sourcePath:'/tmp/out.png'})).status,400);
 assert.equal((await submit(payload,{'x-npcgen-csrf':'wrong'})).status,403);
 assert.equal((await submit(payload)).status,202);
 assert.deepEqual(registered.payload,payload);
 assert.deepEqual(Buffer.from(await (await get(base+'&source='+sourceSha256)).arrayBuffer()),png);
 writeFileSync(join(lock,'results',id+'.mp4'),mp4,{mode:0o600});
 assert.deepEqual(await (await get(base)).json(),{clips:[id],sources:[sourceSha256],sequences:[]});
 assert.deepEqual(await (await get(base+'&clip='+id)).json(),{clip:result});
 const video=await get(base+'&clip='+id+'&video=1',{range:'bytes=4-7'});
 assert.equal(video.status,206);
 assert.equal(video.headers.get('Content-Type'),'video/mp4');
 assert.equal(video.headers.get('Content-Range'),'bytes 4-7/40');
 assert.equal(await video.text(),'ftyp');
 writeFileSync(join(lock,'results',id+'.mp4'),Buffer.alloc(40,0),{mode:0o600});
 assert.equal((await get(base+'&clip='+id+'&video=1')).status,503);
 assert.equal((await get(base+'&source='+sourceSha256+'&source='+sourceSha256)).status,400);
});
test('rejects prompt injection syntax and limits bytes; range cannot join arbitrary ranges',()=>{
 assert.ok(validCinematicPayload(payload));
 assert.ok(!validCinematicPayload({...payload,motionPrompt:'embedding:foreign'}));
 assert.ok(!validCinematicPayload({...payload,motionPrompt:'가'.repeat(700)}));
 assert.equal(cinematicVideoResponse(mp4,'bytes=40-').status,416);
 assert.equal(cinematicVideoResponse(mp4,'bytes=0-1,4-5').status,200);
});

test('formal source, native animation, timeline update and selected archive stay separate',async t=>{
 const parent=mkdtempSync(join(realpathSync(tmpdir()),'ngs-cinematic-native-'));
 t.after(()=>rmSync(parent,{force:true,recursive:true}));
 const root=join(parent,'projects'),dir=join(root,'binari'),cine=join(dir,'cinematics');
 const out=join(cine,'sequences',id);
 mkdirSync(join(out,'frames'),{mode:0o700,recursive:true});
 mkdirSync(join(cine,'sources'),{mode:0o700,recursive:true});
 const json=(f,v)=>writeFileSync(f,JSON.stringify(v),{mode:0o600});
 json(join(dir,'project.json'),{name:'비나리'});
 // A separate scope fixture authenticates hashes and image dimensions; browser playback
 // is tested with actual PNGs from the Worker integration, not this header fixture.
 const frame=Buffer.from(png);frame.writeUInt32BE(128,16);frame.writeUInt32BE(128,20);
 const original=Buffer.from(png);original.writeUInt32BE(1536,16);original.writeUInt32BE(1024,20);
 const source=sha(original),version=sha(frame),sourcePublished={sourceSha256:source,title:'빈 문턱'};
 const playback={durationFrames:135,speedCurve:[{frame:0,rate:1/3}],cameraCurve:[{frame:0,zoom:1,x:.5,y:.5}]};
 const sequence={schemaVersion:'ngs.cinematic-sequence-result.v1',projectId:'binari',officialRequestId:id,sourceSha256:source,width:128,height:128,masterFps:24,frameCount:45,
  frames:Array.from({length:45},(_,index)=>({index,bytes:frame.length,sha256:version})),playback};
 const registered=[];
 const yes=async()=>true;
 const server=createLocalProjectPageServer({root,readCinematicSequenceReady:yes,readCinematicPlaybackReady:yes,readCinematicSourceReady:yes,readCinematicRemoveReady:yes,
  requestQueue:{enqueue(c){registered.push(c);return {status:'queued'};}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const origin='http://127.0.0.1:'+server.address().port;
 const boot=await fetch(origin+'/__npcgen_session'),cookie=boot.headers.get('set-cookie').split(';')[0];
 const settings=await boot.json();
 for(const flag of ['cinematicSequenceEnabled','cinematicPlaybackEnabled','cinematicSourceEnabled','cinematicRemoveEnabled'])assert.equal(settings[flag],true);
 const get=query=>fetch(origin+base+query,{headers:{cookie}});
 const post=(requestType,payload)=>fetch(origin+'/api/requests',{method:'POST',headers:{cookie,origin,'content-type':'application/json',
  'x-npcgen-csrf':settings.csrfToken,'x-npcgen-frontend-context':settings.contextId},body:JSON.stringify({requestType,idempotencyKey:requestType,payload})});
 const sourceCmd={schemaVersion:'ngs.cinematic-source-generate.v1',projectId:'binari',title:'빈 문턱',prompt:'A closed wooden door, ink wash.'};
 const videoCmd={schemaVersion:'ngs.cinematic-sequence-generate.v1',projectId:'binari',sourceSha256:source,motionPrompt:'A pale light drifts.',playback};
 assert.equal((await post('cinematic.source.generate',sourceCmd)).status,202);
 assert.equal((await post('cinematic.sequence.generate',videoCmd)).status,404);
 assert.equal(registered.length,1); // no dependent animation requested by source.
 writeFileSync(join(cine,'sources',source+'.png'),original,{mode:0o600});
 json(join(cine,'sources',source+'.json'),{schemaVersion:'ngs.cinematic-source-result.v1',projectId:'binari',officialRequestId:id,title:sourceCmd.title,sha256:source,bytes:original.length,width:1536,height:1024});
 assert.deepEqual(await (await get('&source='+source+'&sourceInfo=1')).json(),sourcePublished);
 assert.equal((await post('cinematic.sequence.generate',videoCmd)).status,202);
 json(join(out,'manifest.json'),sequence);
 writeFileSync(join(out,'frames','0000.png'),frame,{mode:0o600});
 assert.deepEqual((await (await get('')).json()).sequences,[id]);
 assert.deepEqual(Buffer.from(await (await get('&sequence='+id+'&frame=0')).arrayBuffer()),frame);
 const revised={...playback,cameraCurve:[{frame:0,zoom:1,x:.5,y:.5},{frame:100,zoom:1.2,x:.52,y:.48}]};
 const timeline={schemaVersion:'ngs.cinematic-playback-update.v1',projectId:'binari',sequenceId:id,expectedRevision:0,playback:revised};
 assert.equal((await post('cinematic.playback.update',timeline)).status,202);
 assert.equal((await (await get('&sequence='+id)).json()).revision,0);
 json(join(out,'timeline.json'),{schemaVersion:'ngs.cinematic-playback-state.v1',projectId:'binari',sequenceId:id,revision:1,playback:revised});
 assert.equal((await post('cinematic.playback.update',timeline)).status,409);
 const read=await (await get('&sequence='+id)).json();
 assert.deepEqual([read.revision,read.playback,read.sequence.frames[0].sha256],[1,revised,version]);
 const hide={schemaVersion:'ngs.cinematic-sequences-remove.v1',projectId:'binari',sequenceIds:[id]};
 assert.equal((await post('cinematic.sequences.remove',{...hide,sequenceIds:[id,id]})).status,400);
 assert.equal((await post('cinematic.sequences.remove',hide)).status,202);
 json(join(cine,'sequence-archive.json'),{schemaVersion:'ngs.cinematic-sequence-archive.v1',projectId:'binari',sequenceIds:[id]});
 assert.equal((await get('&sequence='+id+'&frame=0')).status,404);
 assert.deepEqual((await (await get('')).json()).sequences,[]);
 assert.ok((await get('&source='+source)).ok);
});
