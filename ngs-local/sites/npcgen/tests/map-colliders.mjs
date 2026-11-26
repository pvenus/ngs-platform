import test from 'node:test';
import assert from 'node:assert/strict';
import {applyMapCoordinates,mapGraphMatches,validMapGraph,validMapRequest,validMapState} from '../build/map-contract.mjs';
import {createMapWarp} from '../build/map-warp.mjs';

const room=(id,sha)=>({id,name:id,description:'room',backgroundId:'background.'+sha.repeat(64),imageSha256:sha.repeat(64)});
const portal={id:'edge-1',from:'first',to:'second',hit:{x:800,y:200,width:10,height:100},spawn:{x:400,y:250},label:'portal'};
const graph={title:'test',startRegionId:'first',regions:[room('first','a'),room('second','b')],connections:[portal]};
const collider=(x=700,regionId='first')=>({id:'wall-1',regionId,rect:{x,y:200,width:1,height:100}});
const id='request.official.'+'a'.repeat(64);
const generate=graph=>({schemaVersion:'ngs.map-generate.v1',projectId:'binari',intent:'test',graph});
const update=graph=>({schemaVersion:'ngs.map-update.v1',projectId:'binari',mapId:id,expectedRevision:1,graph});
const saved=graph=>({schemaVersion:'ngs.map-metadata.v1',projectId:'binari',mapId:id,revision:1,updatedAt:1,officialRequestId:id,graph});
const play=(colliders,start={x:600,y:250})=>createMapWarp({...graph,colliders},{start});

test('colliders are optional, bounded and exact; only an edit may supply nonempty walls',()=>{
 const partial={...graph,connections:[{...portal,hit:null,spawn:null}]};
 const withWall={...graph,colliders:[collider()]};
 assert.equal(validMapState(saved(graph)),true);
 assert.equal(validMapState(saved(withWall)),true);
 assert.equal(validMapRequest(update(withWall),'map.update'),true);
 assert.equal(validMapRequest(generate(partial),'map.generate'),true);
 assert.equal(validMapRequest(generate({...partial,colliders:[]}),'map.generate'),true);
 assert.equal(validMapRequest(generate({...partial,colliders:[collider()]}),'map.generate'),false);
 for(const colliders of [null,[null],[collider(),collider()],[collider(1000)],[collider(700,'unknown')],
  [{...collider(),id:'Invalid'}],[{...collider(),extra:true}],
  Array.from({length:97},(_,i)=>({...collider(),id:'wall-'+i}))]){
  assert.equal(validMapGraph({...graph,colliders}),false);
 }
 assert.deepEqual(applyMapCoordinates(partial,{coordinates:[{id:portal.id,hit:portal.hit,spawn:portal.spawn}]}),graph);
 assert.equal(mapGraphMatches(withWall,withWall),true);
 assert.equal(mapGraphMatches(withWall,graph),false);
});

test('a thin wall on the current map clips long moves and wins ties against a portal',()=>{
 for(const x of [700,800]){
  const p=play([collider(x)]);
  const state=p.move(990,250);
  assert.equal(state.regionId,'first');assert.equal(state.warp,null);
  assert.ok(state.position.x<x&&state.position.x>x-0.01);
  assert.equal(p.move(990,250).warp,null);
  assert.equal(p.move(990,350).regionId,'first');
 }
});
test('an earlier portal wins, and walls in other rooms do not alter the path',()=>{
 for(const wall of [collider(850),collider(700,'second')]){
  const p=play([wall]);
  assert.deepEqual(p.move(990,250),{regionId:'second',position:portal.spawn,
   warp:{id:'edge-1',from:'first',to:'second'}});
 }
});
test('a player starting inside a wall can step out but cannot enter it again',()=>{
 const p=play([{...collider(),rect:{x:650,y:200,width:100,height:100}}],{x:700,y:250});
 assert.equal(p.move(680,250).position.x,680);
 assert.equal(p.move(600,250).position.x,600);
 assert.ok(p.move(700,250).position.x<650);
});
