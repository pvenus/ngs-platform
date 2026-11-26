import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import test from 'node:test';
import {npcWorkspaceRead} from '../build/npc-workspace.mjs';
import {localNpcWorkspace} from '../build/local-npc-workspace.mjs';
import {npcFolderDeletePayload,validNpcFolderDelete} from '../build/prop-folder-delete-contract.mjs';
import {groupNpcPortraits} from '../build/local-npc-workspace-ui.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value));
const npc='npc.fixture',prefix='npcs/'+npc+'/',hidden='npc.hidden';
const creationTaskId='workflow.task.'+'4'.repeat(64);
const png=Buffer.from([137,80,78,71,13,10,26,10,1]),mp4=Buffer.from('0000ftypfixture');
const asset=sha(png)+'.png',movie=sha(mp4)+'.mp4',doc=Buffer.from('# 원본\n\n기획 문서.');
const rawshape={npcId:npc,generationId:'generation.fixture',posePreset:'idle',presetId:'walk',direction:'s',
 sourceBindingHash:'a'.repeat(64),frameCount:1,fps:24};
const initial=new Map([
 ['npcs/metadata.json',json({actId:'act.fixture',characterOrder:[npc]})],
 [prefix+'metadata.json',json({id:npc,name:'검증 NPC',role:'인물',kind:'npc',chapters:['chapter.1'],
  creationBasis:{requestId:creationTaskId,generationId:'private'},
  planningCategoryOrder:['category.markdown','category.no-fallback'],privateField:'do not project',
  portraitSets:{representative:{portraitAssetId:asset},idle:{pixelAssetId:asset}},
  animationSlotKeys:['idle/jump/n']})],
 ['npcs/'+hidden+'/metadata.json',json({id:hidden,name:'No roster publication'})],
 [prefix+'planning/category.markdown.json',json({id:'category.markdown',name:'설계',planningRole:'overview',
  contentFormat:'markdown.v1',contentSha256:sha(doc)})],
 [prefix+'planning/category.markdown/content.md',doc],
 [prefix+'planning/category.no-fallback.json',json({id:'category.no-fallback',name:'차단',
  contentFormat:'markdown.v1',contentSha256:'f'.repeat(64),content:'unsafe fallback'})],
 [prefix+'assets/portraits/representative/portrait.png',png],
 [prefix+'animations/idle/jump/n.json',json({schemaVersion:'ngs.npc-animation-slot.v1',posePreset:'idle',
  presetId:'jump',direction:'n',assetId:movie,mimeType:'video/mp4',fps:24,frameCount:1})],
 [prefix+'assets/animations/idle/jump/n/video.mp4',mp4],
 [prefix+'animation-sequences/idle/walk/s.json',json({schemaVersion:'ngs.animation-native-png-sequence.v1',
  ...rawshape,frames:[{index:0,assetId:asset}]})],
 [prefix+'assets/animation-sequences/idle/walk/s/raw-0.png',png],
 [prefix+'animation-alpha/idle/walk/s.json',json({schemaVersion:'ngs.animation-alpha-output.v1',
  ...rawshape,frames:[{index:0,rawAssetId:'0'.repeat(64)+'.png',alphaAssetId:asset}]})],
 [prefix+'assets/animation-alpha/idle/walk/s/alpha-0.png',png],
]);
const path=(extra={})=>new URLSearchParams({projectId:'binari',...extra});

test('shared NPC read parity over actual Local FS and asynchronous object replica', async t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-npc-parity-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const data=new Map(initial);
 const combat=Buffer.from([...png.subarray(0,8),2]),combatAsset=sha(combat)+'.png';
 const npcMeta=JSON.parse(data.get(prefix+'metadata.json'));
 npcMeta.portraitSets.combat={portraitAssetId:combatAsset,pixelAssetId:combatAsset};
 npcMeta.poseViewKeys=['combat/portrait/sw','combat/pixel/sw'];
 data.set(prefix+'metadata.json',json(npcMeta));
 for(const ref of ['portrait','pixel']){
  data.set(prefix+'assets/portraits/combat/'+ref+'.png',combat);
  data.set(prefix+'assets/pose-views/combat/'+ref+'/sw/image.png',combat);
  data.set(prefix+'pose-views/combat/'+ref+'/sw.json',json({
   schemaVersion:'ngs.npc-pose-view.v1',posePreset:'combat',referenceType:ref,direction:'sw',
   assetId:combatAsset,mimeType:'image/png',
   ...(ref==='pixel'?{referenceArtifactId:combatAsset,sourceArtifactId:combatAsset,sourceHash:sha(combat)}
    :{referenceArtifactId:combatAsset}),
  }));
 }
 for(const [name,body] of data){
  const file=join(root,'binari',name);
  mkdirSync(dirname(file),{mode:0o700,recursive:true});writeFileSync(file,body,{mode:0o600});
 }
 const authorize=p=>{assert.equal(p,'binari');};
 const local=query=>localNpcWorkspace({root,query,authorize});
 const objectProject={
  async listFiles(relative){
   return [...data].flatMap(([path,bytes])=>path.startsWith(relative+'/')?[{path,size:bytes.length}]:[]);
  },
  async readBytes(path,max){
   const value=data.get(path);
   if(value?.length>max)throw Error('large');
   return value?Uint8Array.from(value):null;
  },
 };
 const hosted=query=>npcWorkspaceRead({openProject:async()=>objectProject,query,authorize});
 const roster=await hosted(path());
 assert.deepEqual(roster,await local(path()));
 assert.deepEqual(roster.json.npcs.map(row=>row.id),[npc]);
 assert.equal(roster.json.npcs[0].creationTaskId,creationTaskId);
 assert.equal(roster.json.npcs[0].creationBasis,undefined);
 const request=npcFolderDeletePayload({id:npc,expected:{creationTaskId}});
 assert.equal(validNpcFolderDelete(request),true);
 assert.equal(validNpcFolderDelete({...request,expected:{creationTaskId:'old'}}),false);
 const detail=await hosted(path({npcId:npc}));
 assert.deepEqual(detail,await local(path({npcId:npc})));
 assert.equal(detail.json.npc.privateField,undefined);
 assert.equal(detail.json.planning[0].markdown,doc.toString());
 assert.equal(detail.json.planning[1].markdown,undefined);
 assert.equal(detail.json.planning[1].content,undefined);
 const combatViews=detail.json.portraits.filter(row=>row.posePreset==='combat');
 assert.deepEqual(combatViews.map(row=>row.id),[
  'portrait/combat/portrait','portrait/combat/pixel','pose/combat/portrait/sw','pose/combat/pixel/sw',
 ]);
 const groups=groupNpcPortraits(detail.json.portraits);
 assert.deepEqual(groups.map(row=>[row.pose,row.defaultReference]),[['representative','portrait'],['combat','pixel']]);
 assert.deepEqual([...groups[1].references[1].cells.keys()],['center','sw']);
 assert.equal(detail.json.animations.length,1);
 const native=detail.json.frameSets[0].directions[0].frames[0];
 assert.match(native.rawUrl,/native-frame/);assert.equal(native.alphaUrl,null);
 for(const [url,match,mime] of [[detail.json.portraits[0].url,png,'image/png'],
  ...combatViews.map(row=>[row.url,combat,'image/png']),
  [detail.json.animations[0].url,mp4,'video/mp4'],[native.rawUrl,png,'image/png']]){
  const query=new URL(url,'http://localhost').searchParams;
  const h=await hosted(query),l=await local(query);
  assert.equal(h.mime,mime);assert.equal(l.mime,mime);
  assert.deepEqual(Buffer.from(h.bytes),match);assert.deepEqual(Buffer.from(l.bytes),match);
 }
 await assert.rejects(hosted(path({npcId:hidden})),{status:404});
 await assert.rejects(hosted(path({npcId:npc,media:'pose/idle/portrait/sw',sha256:sha(combat)})),{status:404});
 await assert.rejects(hosted(path({npcId:npc,media:'pose/combat/pixel/sw',sha256:sha(png)})),{status:409});
 await assert.rejects(hosted(path({npcId:npc,media:'../project.json',sha256:sha(png)})),{status:400});
 await assert.rejects(hosted(path({npcId:npc,media:'portrait/representative/portrait',sha256:'f'.repeat(64)})),{status:409});
 data.set(prefix+'assets/portraits/representative/portrait.png',Buffer.from('tampered'));
 await assert.rejects(hosted(path({npcId:npc,media:'portrait/representative/portrait',sha256:sha(png)})),{status:503});
 const fault=Object.assign(Error('deny'),{status:403});
 await assert.rejects(npcWorkspaceRead({openProject:()=>assert.fail('no storage before authorization'),query:path(),
  authorize:()=>{throw fault;}}),{status:403});
});

function nativePublication(data,{owner=npc,posePreset,presetId,direction='n',seed=5}){
 const suffix=[posePreset,presetId,direction].join('/'),scope='npcs/'+owner+'/';
 const image=v=>Buffer.from([...png.subarray(0,8),v]);
 const frame=(i,bytes,key)=>({index:i,[key]:sha(bytes)+'.png',sha256:sha(bytes),bytes:bytes.length,mimeType:'image/png'});
 const core={npcId:owner,generationId:'generation.publish',posePreset,presetId,direction,
  sourceBindingHash:sha(suffix),frameCount:2,fps:24};
 const files={};
 for(const [layer,i] of ['raw','alpha','pixel'].map((name,i)=>[name,i]))files[layer]=[image(seed+i*2),image(seed+i*2+1)];
 const raw={schemaVersion:'ngs.animation-native-png-sequence.v1',requestId:'workflow.task.'+'a'.repeat(64),
  ...core,frames:files.raw.map((bytes,i)=>frame(i,bytes,'assetId'))};
 const rawPath=scope+'animation-sequences/'+suffix+'.json',rawContent=json(raw);
 const alpha={schemaVersion:'ngs.animation-alpha-output.v1',requestId:'workflow.task.'+'b'.repeat(64),...core,
  rawManifestId:'canonical-files/binari/'+rawPath,rawManifestHash:sha(rawContent),rawRequestId:raw.requestId,
  frames:files.alpha.map((bytes,i)=>({...frame(i,bytes,'alphaAssetId'),rawAssetId:raw.frames[i].assetId}))};
 const alphaContent=json(alpha),pixel={schemaVersion:'workflow.animation-pixel-direction.v1',...core,
  rawManifestHash:sha(rawContent),alphaManifestHash:sha(alphaContent),frames:files.pixel.map((bytes,i)=>({
   index:i,assetId:sha(bytes)+'.png',rawAssetId:raw.frames[i].assetId,alphaAssetId:alpha.frames[i].alphaAssetId,
  }))};
 const alphaPath=scope+'animation-alpha/'+suffix+'.json',pixelPath=scope+'animation-processed-directions/'+suffix+'.json';
 data.set(rawPath,rawContent);data.set(alphaPath,alphaContent);data.set(pixelPath,json(pixel));
 const directories={raw:'animation-sequences',alpha:'animation-alpha',pixel:'animation-processed-directions'};
 for(const [layer,values] of Object.entries(files))for(const [i,bytes] of values.entries())
  data.set(scope+'assets/'+directories[layer]+'/'+suffix+'/'+layer+'-'+i+'.png',bytes);
 return {suffix,raw,rawPath,alpha,alphaPath,pixel,pixelPath,files};
}

test('selected mixed NPC animations discover exact published scopes, preserve legacy and play all three layers',async t=>{
 const root=mkdtempSync(join(realpathSync(tmpdir()),'ngs-npc-motion-view-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 const data=new Map(initial);
 const run2d=nativePublication(data,{posePreset:'idle',presetId:'run-2d',seed:20});
 const attack=nativePublication(data,{posePreset:'combat',presetId:'sword-attack-flat',direction:'sw',seed:40});
 const also=nativePublication(data,{posePreset:'idle',presetId:'run-flat',seed:55});
 nativePublication(data,{owner:hidden,posePreset:'combat',presetId:'other-npc'});
 const bad={...attack.raw,npcId:hidden,presetId:'wrong-owner',direction:'sw'};
 data.set(prefix+'animation-sequences/combat/wrong-owner/sw.json',json(bad));
 for(const [name,body] of data){
  const file=join(root,'binari',name);
  mkdirSync(dirname(file),{mode:0o700,recursive:true});writeFileSync(file,body,{mode:0o600});
 }
 const seen=[],listed=[];
 const objectProject={
  async listFiles(relative){
   listed.push(relative);
   return [...data].flatMap(([path,bytes])=>path.startsWith(relative+'/')?[{path,size:bytes.length}]:[]);
  },
  async readBytes(path,max){
   seen.push(path);const value=data.get(path);
   if(value?.length>max)throw Error('large');return value?Uint8Array.from(value):null;
  },
 };
 const authorize=p=>assert.equal(p,'binari');
 const local=query=>localNpcWorkspace({root,query,authorize});
 const hosted=query=>npcWorkspaceRead({openProject:async()=>objectProject,query,authorize});
 const detail=await hosted(path({npcId:npc}));
 assert.deepEqual(detail,await local(path({npcId:npc})));
 assert.ok(detail.json.portraits.every(row=>row.posePreset!=='combat'),'combat portraits are not required');
 assert.deepEqual(detail.json.frameSets.map(x=>x.posePreset+'/'+x.presetId),
  ['combat/sword-attack-flat','idle/run-2d','idle/run-flat','idle/walk']);
 assert.ok(seen.every(name=>!name.endsWith('.png')&&!name.endsWith('.mp4')));
 assert.deepEqual([...new Set(listed)].sort(),[prefix+'animation-processed-directions',prefix+'animation-sequences',prefix+'assets'].sort());
 for(const output of [run2d,attack,also]){
  const track=detail.json.frameSets.find(x=>output.suffix.startsWith(x.posePreset+'/'+x.presetId+'/')).directions[0];
  assert.equal(track.frameCount,2);
  for(const [i,row] of track.frames.entries())for(const layer of ['raw','alpha','pixel']){
   const query=new URL(row[layer+'Url'],'http://localhost').searchParams;
   assert.equal(query.get('media'),'native-frame/'+output.suffix+'/'+i+'/'+layer);
   assert.deepEqual(Buffer.from((await hosted(query)).bytes),output.files[layer][i]);
   assert.deepEqual(Buffer.from((await local(query)).bytes),output.files[layer][i]);
  }
 }
 const media=(locator,sha256,npcId=npc)=>hosted(path({npcId,media:locator,sha256}));
 const validPix='native-frame/'+attack.suffix+'/0/pixel',validSha=sha(attack.files.pixel[0]);
 await assert.rejects(media(validPix,validSha,hidden),{status:404});
 await assert.rejects(media('native-frame/combat/wrong-owner/sw/0/raw',sha(attack.files.raw[0])),{status:404});
 await assert.rejects(media('native-frame/idle/../sw/0/pixel',validSha),{status:400});
 await assert.rejects(media('native-frame/combat/run-2d/sw/0/pixel',validSha),{status:404});
 await assert.rejects(media('native-frame/'+attack.suffix+'/2/pixel',validSha),{status:404});
 await assert.rejects(media(validPix,sha(run2d.files.pixel[0])),{status:409});
 // Prefix and exact raw manifest hash both guard against a cross-source processed row.
 data.set(attack.alphaPath,json({...attack.alpha,rawManifestId:'canonical-files/binari/npcs/'+hidden+'/animation-sequences/'+attack.suffix+'.json'}));
 await assert.rejects(media(validPix,validSha),{status:404});
 data.set(attack.alphaPath,json(attack.alpha));
 data.set(attack.rawPath,json({...attack.raw,unrelatedSubstitution:true}));
 await assert.rejects(media(validPix,validSha),{status:404});
 data.set(attack.rawPath,json(attack.raw));
 data.set(attack.pixelPath,json({...attack.pixel,alphaManifestHash:sha('forged')}));
 await assert.rejects(media(validPix,validSha),{status:404});
 assert.deepEqual(Buffer.from((await media('native-frame/'+attack.suffix+'/0/raw',sha(attack.files.raw[0]))).bytes),attack.files.raw[0]);
});

test('same replica generation does not reuse a fixed-walk/run viewer cache',async()=>{
 const data=new Map(initial),coverage={reads:0,writes:0};
 for(const key of ['animation-sequences/idle/walk/s.json','animation-alpha/idle/walk/s.json'])data.delete(prefix+key);
 data.set(prefix+'metadata.json',json({id:npc,name:'Fixture'}));
 nativePublication(data,{posePreset:'combat',presetId:'sword-attack-flat'});
 let snapshot={projectId:'binari',npcs:[{id:npc}],npc:{id:npc},frameSets:[]};
 const project={npcCache:{version:async()=>100,read:async()=>snapshot,
  store:async(_id,_version,value)=>{coverage.writes++;snapshot=value;}},
  readBytes:async(path)=>{coverage.reads++;return data.get(path)??null;},
  listFiles:async(root)=>[...data.keys()].filter(path=>path.startsWith(root+'/')).map(path=>({path}))};
 const args={openProject:async()=>project,query:path({npcId:npc}),authorize:()=>{}};
 const current=await npcWorkspaceRead(args);
 assert.equal(coverage.writes,1);
 assert.equal(current.json.frameSets[0].presetId,'sword-attack-flat');
 assert.equal(Object.hasOwn(current.json,'view'),false);
 const reads=coverage.reads;
 assert.deepEqual(await npcWorkspaceRead(args),current);
 assert.equal(coverage.reads,reads);
});
