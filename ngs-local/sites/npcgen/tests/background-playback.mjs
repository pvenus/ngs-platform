import assert from 'node:assert/strict';
import test from 'node:test';
import {backgroundPhase,createSpiritBlend,playableBackgroundManifest,spiritSightFlag} from '../build/background-playback.mjs';

test('spirit sight reverses from the current blend, not an endpoint, on a shared playback phase',()=>{
 const transition=createSpiritBlend();
 transition.set(true);
 const on=transition.advance(.55/4);
 assert.equal(on,.15625);
 transition.set(false);
 assert.equal(transition.value,on);
 const reverse=transition.advance(.55/8);
 assert.ok(reverse>0&&reverse<on);
 assert.equal(transition.advance(.55),0);
 transition.set(true);assert.equal(transition.advance(.55),1);
 for(const [frames,step] of [[8,6],[45,3]]){
  assert.equal(backgroundPhase((frames-1)*step,frames,step),frames-1);
  assert.equal(backgroundPhase(frames*step,frames,step),frames-2);
  assert.equal(backgroundPhase((2*frames-2)*step,frames,step),0);
 }
});
test('portable resource manifest shares flag, ticks and package-relative paths with web playback',()=>{
 const resource=playableBackgroundManifest(8,45);
 assert.equal(resource.schemaVersion,'ngs.background-playable.v1');
 assert.equal(resource.flag,spiritSightFlag);
 assert.equal(resource.transitionSeconds,.55);
 assert.equal(resource.normal.ticksPerFrame,6);
 assert.equal(resource.spirit.ticksPerFrame,3);
 assert.equal(resource.normal.fps,24);
 assert.equal(resource.normal.still,'normal/still.png');
 assert.equal(resource.normal.frames.at(-1),'normal/frames/0007.png');
 assert.deepEqual(playableBackgroundManifest().spirit.frames,[]);
});

test('mounted resource plays both decoded lanes, toggles programmatically, and releases its clock',async()=>{
 const {mountPlayableBackground}=await import('../build/background-playback.mjs');
 class Node extends EventTarget{
  children=[];dataset={};style={};attributes={};width=1;height=1;
  setAttribute(key,value){this.attributes[key]=value;}
  append(...children){this.children.push(...children);}
  getContext(){return {clearRect(){},drawImage(){}};}
 }
 const descriptors=new Map(),set=(name,value)=>{
  descriptors.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
  Object.defineProperty(globalThis,name,{value,configurable:true,writable:true});
 };
 let frame;
 set('document',{createElement:()=>new Node()});
 set('Image',class{naturalWidth=32;naturalHeight=20;decode(){return Promise.resolve();}});
 set('requestAnimationFrame',fn=>(frame=fn,1));
 set('cancelAnimationFrame',()=>{frame=undefined;});
 try{
  const root=new Node(),abort=new AbortController(),still={width:1536,height:1024,url:'still.png'};
  const frames=Array.from({length:8},(_,i)=>`frame-${i}.png`);
  const player=mountPlayableBackground(root,{stills:{normal:still,spirit:still,title:'안뜰'},loadPair:async()=>({normal:{frames},spirit:{frames}}),signal:abort.signal});
  await player.ready;
  const [button,,stage]=root.children,[normal,spirit]=stage.children;
  assert.equal(stage.dataset.motion,'paired');
  frame(0);frame(250);
  assert.equal(normal.dataset.frame,'1');assert.equal(spirit.dataset.frame,'1');
  assert.equal(player.setFlag('unknown.flag',true),false);
  assert.equal(player.setFlag(spiritSightFlag,true),true);
  frame(500);
  const level=Number(spirit.style.opacity);
  assert.ok(level>0&&level<1);
  assert.equal(button.attributes['aria-pressed'],'true');
  assert.equal(spirit.dataset.frame,'2');
  button.dispatchEvent(new Event('click'));frame(600);
  assert.ok(Number(spirit.style.opacity)<level);
  assert.equal(normal.dataset.frame,spirit.dataset.frame);
  abort.abort();assert.equal(frame,undefined);
  assert.equal(player.setFlag(spiritSightFlag,true),false);
 }finally{
  for(const [name,descriptor] of descriptors){
   if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
  }
 }
});
