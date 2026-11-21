import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import test from 'node:test';
import {npcWorkspaceRead} from '../build/npc-workspace.mjs';
import {localNpcWorkspace} from '../build/local-npc-workspace.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value));
const npc='npc.fixture',prefix='npcs/'+npc+'/',hidden='npc.hidden';
const png=Buffer.from([137,80,78,71,13,10,26,10,1]),mp4=Buffer.from('0000ftypfixture');
const asset=sha(png)+'.png',movie=sha(mp4)+'.mp4',doc=Buffer.from('# 원본\n\n기획 문서.');
const rawshape={npcId:npc,generationId:'generation.fixture',posePreset:'idle',presetId:'walk',direction:'s',
 sourceBindingHash:'a'.repeat(64),frameCount:1,fps:24};
const initial=new Map([
 ['npcs/metadata.json',json({actId:'act.fixture',characterOrder:[npc]})],
 [prefix+'metadata.json',json({id:npc,name:'검증 NPC',role:'인물',kind:'npc',chapters:['chapter.1'],
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
 const detail=await hosted(path({npcId:npc}));
 assert.deepEqual(detail,await local(path({npcId:npc})));
 assert.equal(detail.json.npc.privateField,undefined);
 assert.equal(detail.json.planning[0].markdown,doc.toString());
 assert.equal(detail.json.planning[1].markdown,undefined);
 assert.equal(detail.json.planning[1].content,undefined);
 assert.equal(detail.json.portraits.length,1);
 assert.equal(detail.json.animations.length,1);
 const native=detail.json.frameSets[0].directions[0].frames[0];
 assert.match(native.rawUrl,/native-frame/);assert.equal(native.alphaUrl,null);
 for(const [url,match,mime] of [[detail.json.portraits[0].url,png,'image/png'],
  [detail.json.animations[0].url,mp4,'video/mp4'],[native.rawUrl,png,'image/png']]){
  const query=new URL(url,'http://localhost').searchParams;
  const h=await hosted(query),l=await local(query);
  assert.equal(h.mime,mime);assert.equal(l.mime,mime);
  assert.deepEqual(Buffer.from(h.bytes),match);assert.deepEqual(Buffer.from(l.bytes),match);
 }
 await assert.rejects(hosted(path({npcId:hidden})),{status:404});
 await assert.rejects(hosted(path({npcId:npc,media:'../project.json',sha256:sha(png)})),{status:400});
 await assert.rejects(hosted(path({npcId:npc,media:'portrait/representative/portrait',sha256:'f'.repeat(64)})),{status:409});
 data.set(prefix+'assets/portraits/representative/portrait.png',Buffer.from('tampered'));
 await assert.rejects(hosted(path({npcId:npc,media:'portrait/representative/portrait',sha256:sha(png)})),{status:503});
 const fault=Object.assign(Error('deny'),{status:403});
 await assert.rejects(npcWorkspaceRead({openProject:()=>assert.fail('no storage before authorization'),query:path(),
  authorize:()=>{throw fault;}}),{status:403});
});
