import test from 'node:test';
import assert from 'node:assert/strict';
import {assemblyDirection,createAssemblyActor,mountAssemblyActor} from '../build/assembly-actor.mjs';

const point=(x,y)=>({x,y});
const region=(id,c)=>({id,name:id,description:id,backgroundId:'background.'+c.repeat(64),imageSha256:c.repeat(64)});
const graph={
 title:'test',startRegionId:'r1',startPoint:point(500,500),regions:[region('r1','a'),region('r2','b')],
 connections:[{id:'forward',from:'r1',to:'r2',label:'forward',hit:{x:600,y:450,width:10,height:100},spawn:point(340,230)}],
};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-3,a+' != '+b);

test('WASD resolves all eight directions without diagonal speedup',()=>{
 for(const [keys,x,y] of [['w',0,-1],['wa',-1,-1],['a',-1,0],['as',-1,1],['s',0,1],['sd',1,1],['d',1,0],['dw',1,-1]]){
  const v=assemblyDirection(new Set(keys)),scale=Math.hypot(x,y);
  close(v.x,x/scale);close(v.y,y/scale);
 }
 assert.deepEqual(assemblyDirection(new Set('wsad')),point(0,0));
});
test('published start, actual portal hit/spawn and movement in the terminal room',()=>{
 const actor=createAssemblyActor(graph);
 assert.deepEqual(actor.snapshot(),{regionId:'r1',position:point(500,500)});
 assert.deepEqual(actor.move(200,0),{regionId:'r2',position:point(340,230),warp:{id:'forward',from:'r1',to:'r2'}});
 assert.deepEqual(actor.move(160,120),{regionId:'r2',position:point(500,350),warp:null});
 assert.equal(actor.reset().regionId,'r1');
});
test('clips movement before a thin solid collider and lets earlier portals win',()=>{
 function make(x,regionId='r1'){return createAssemblyActor({...graph,colliders:[{id:'block',regionId,rect:{x,y:400,width:1,height:200}}]});}
 for(const x of [550,600]){
  const actor=make(x),state=actor.move(450,0);
  close(state.position.x,x);assert.ok(state.position.x<x);assert.equal(state.warp,null);
  assert.equal(actor.move(450,0).warp,null);
 }
 assert.equal(make(650).move(450,0).regionId,'r2');
 assert.equal(make(550,'r2').move(450,0).regionId,'r2');
});
test('ellipse uses its real curved boundary; rotation is in scene pixels',()=>{
 const g={...graph,connections:[],colliders:[
  {id:'curved',regionId:'r1',shape:'ellipse',rotation:90,rect:{x:650,y:450,width:100,height:100}},
 ]};
 // At 2:1 aspect and 90°, the x radius is 25 graph units, not 50.
 close(createAssemblyActor(g).move(400,0,2).position.x,675);
 const outsideCorner=createAssemblyActor({...g,startPoint:point(500,590)});
 assert.equal(outsideCorner.move(180,0,2).position.x,680);
 const rev={...g,colliders:[{...g.colliders[0],shape:'rect'}]};
 close(createAssemblyActor(rev).move(400,0,2).position.x,675);
 const escaping=createAssemblyActor({...g,startPoint:point(700,500)});
 assert.equal(escaping.move(100,0,2).position.x,800);
 close(escaping.move(-100,0,2).position.x,725);
});
test('scoped marker, movement callbacks, reset, near guard and teardown',()=>{
 const doc={defaultView:new EventTarget(),createElement:()=>new Element()};
 class Element extends EventTarget{
  constructor(control=false){super();this.ownerDocument=doc;this.children=[];this.style={};this.attrs=new Map();this.control=control;}
  hasAttribute(k){return this.attrs.has(k);}
  getAttribute(k){return this.attrs.get(k);}
  setAttribute(k,v){this.attrs.set(k,v);}
  removeAttribute(k){this.attrs.delete(k);}
  append(c){c.remove();c.parentNode=this;this.children.push(c);}
  remove(){if(this.parentNode){this.parentNode.children=this.parentNode.children.filter(c=>c!==this);this.parentNode=null;}}
  contains(c){return c===this||this.children.some(e=>e.contains(c));}
  closest(){return this.control?this:null;}
  getBoundingClientRect(){return {width:1000,height:1000};}
 }
 const controller=new AbortController(),root=new Element(),scene=new Element(),control=new Element(true),regions=[],moves=[],frames=new Map();
 root.append(scene);root.append(control);
 doc.activeElement=scene;
 let count=0;
 const a=mountAssemblyActor(scene,{root,graph,signal:controller.signal,onRegion:r=>regions.push(r),onMove:p=>moves.push(p),
  requestFrame:fn=>{frames.set(++count,fn);return count;},cancelFrame:id=>frames.delete(id),speed:1000});
 assert.equal(scene.getAttribute('tabindex'),'0');
 assert.equal(scene.children[0].style.left,'50%');
 assert.equal(a.isNear('r1',50,54),true);assert.equal(a.isNear('r2',50,54),false);
 const event=(type,key,code)=>{const e=new Event(type,{cancelable:true});Object.defineProperties(e,{key:{value:key},code:{value:code}});root.dispatchEvent(e);return e;};
 const tick=t=>{const batch=[...frames.values()];frames.clear();batch.forEach(f=>f(t));};
 doc.activeElement=control;assert.equal(event('keydown','d').defaultPrevented,false);assert.equal(frames.size,0);
 doc.activeElement=scene;assert.equal(event('keydown','d','KeyL').defaultPrevented,false);assert.equal(event('keydown','ㅇ','KeyD').defaultPrevented,true);tick(0);tick(50);tick(100);
 assert.deepEqual(regions,['r2']);assert.equal(scene.children[0].style.left,'34%');
 tick(150);assert.deepEqual(a.snapshot().position,point(390,230));
 event('keyup','ㅇ','KeyD');assert.equal(frames.size,0);
 a.setEnabled(false);assert.equal(frames.size,0);assert.equal(event('keydown','w').defaultPrevented,false);
 assert.equal(a.reset().regionId,'r1');assert.deepEqual(regions,['r2','r1']);assert.equal(moves.at(-1).regionId,'r1');
 a.setEnabled(true);event('keydown','w');assert.equal(frames.size,1);
 controller.abort();assert.equal(frames.size,0);assert.equal(scene.children.length,0);assert.equal(scene.hasAttribute('tabindex'),false);
 assert.equal(event('keydown','w').defaultPrevented,false);
});
