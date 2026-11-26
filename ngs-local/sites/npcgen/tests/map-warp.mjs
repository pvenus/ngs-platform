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
