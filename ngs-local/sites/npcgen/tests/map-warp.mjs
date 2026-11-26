import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapWarp,orderedMapChain,entryFraction} from '../build/map-warp.mjs';

const regions=Array.from({length:5},(_,i)=>({id:'r'+(i+1),name:'구역 '+(i+1),description:'테스트 구역',backgroundId:'background.'+String(i+1).repeat(64),imageSha256:String(i+1).repeat(64)}));
const chain=orderedMapChain(regions);
const graph={title:'굿터',regions,startRegionId:'r1',connections:chain.map((e,i)=>({...e,
 hit:{x:800,y:220,width:8,height:40},spawn:{x:250+i,y:240}}))};
test('ordered map placement builds only the explicit edges with no assumed coordinates',()=>{
 assert.deepEqual(chain.map(({from,to})=>[from,to]),[['r1','r2'],['r2','r3'],['r3','r4'],['r4','r5']]);
 assert.ok(chain.every(e=>e.hit===null&&e.spawn===null));
 assert.throws(()=>createMapWarp({...graph,connections:chain}),/MAP_WARP_GRAPH_INVALID/);
});
test('movement crosses each narrow portal in sequence and lands on each saved coordinate',()=>{
 const p=createMapWarp(graph,{start:{x:500,y:240}});
 for(let i=0;i<4;i++){
  const state=p.move(950,240);
  assert.deepEqual(state,{regionId:'r'+(i+2),position:{x:250+i,y:240},warp:{id:'order-'+(i+1),from:'r'+(i+1),to:'r'+(i+2)}});
 }
 assert.equal(p.move(950,240).warp,null);
 assert.equal(p.snapshot().regionId,'r5');
});
test('an overlapping destination portal only re-arms after leaving, never during a warp',()=>{
 const modified=structuredClone(graph);
 modified.connections[0].spawn={x:805,y:240};
 const p=createMapWarp(modified,{start:{x:500,y:240}});
 assert.equal(p.move(960,240).regionId,'r2');
 assert.equal(p.move(806,240).warp,null);
 assert.equal(p.move(700,240).warp,null);
 assert.equal(p.move(950,240).regionId,'r3');
});
test('a normal move outside the portal does not warp',()=>{
 const p=createMapWarp(graph,{start:{x:500,y:300}});
 assert.equal(p.move(960,300).warp,null);
 assert.equal(entryFraction({x:500,y:240},{x:800,y:240},graph.connections[0].hit),1);
});

test('New Map uses one modal, retains a closed draft, and never submits from opening or closing',async t=>{
 const {mountMapWorkspace,mapDraftKey}=await import('../build/map-workspace-ui.mjs');
 class Element extends EventTarget{
  constructor(tag){super();this.tag=tag;this.children=[];this.attrs={};this.style={};}
  append(...children){for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
  replaceChildren(...children){for(const x of this.children)x.parent=null;this.children=[];this.append(...children);}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}}
  setAttribute(k,v){this.attrs[k]=v;}
  showModal(){this.open=true;}
  close(){if(this.open){this.open=false;this.dispatchEvent(new Event('close'));}}
  descendants(){return this.children.flatMap(x=>[x,...x.descendants()]);}
  querySelector(){return this.descendants().find(x=>x.tag==='input'&&!x.disabled);}
  focus(){focused=this;}
 }
 let focused,requests=0;const body=new Element('body'),original=globalThis.document;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{body,createElement:tag=>new Element(tag)}});
 t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
 const items=new Element('div'),detail=new Element('div'),tools=new Element('div'),draft=new Map(),signal=new AbortController();
 const data={getItem:k=>draft.get(k),setItem:(k,v)=>draft.set(k,v)};
 await mountMapWorkspace({items,detail,tools,projectId:'binari',enabled:true,navigate:()=>'/map',signal:signal.signal,storage:data,
  request:async url=>url.includes('background')?{backgrounds:[]}:{maps:[]},submit:async()=>{requests++;}});
 const root=[...detail.children],opener=tools.children[0];
 assert.equal(opener.attrs['aria-label'],'새 맵');
 assert.equal(body.children.length,0);
 opener.onclick();opener.onclick();
 assert.equal(body.children.length,1);let modal=body.children[0];
 assert.equal(modal.open,true);assert.equal(modal.children[0].textContent,'새 맵 생성 요청');
 const name=modal.querySelector();assert.equal(focused,name);name.value='세션 초안';name.oninput();
 assert.equal(JSON.parse(draft.get(mapDraftKey('binari'))).graph.title,'세션 초안');
 modal.descendants().find(x=>x.tag==='button'&&x.textContent==='닫기').onclick();
 assert.equal(body.children.length,0);assert.equal(focused,opener);
 assert.deepEqual(detail.children,root);
 opener.onclick();modal=body.children[0];
 assert.equal(modal.querySelector().value,'세션 초안');
 assert.equal(modal.dispatchEvent(new Event('cancel',{cancelable:true})),true);
 modal.close();opener.onclick();signal.abort();
 assert.equal(body.children.length,0);assert.equal(requests,0);
});
