import test from 'node:test';
import assert from 'node:assert/strict';
import {validAssemblyRequest,validAssemblyState,assemblyReachable} from '../build/assembly-contract.mjs';
import {assemblyWorkspaceRead} from '../build/assembly-workspace.mjs';

const id='request.official.'+'c'.repeat(64),pin={propId:'test-prop',revision:2,sha256:'a'.repeat(64)};
const puzzle={id:'placed-water',type:'binari.ritual-well-water-demo',layout:{altar:{regionId:'a',x:40,y:70},well:{regionId:'b',x:70,y:70}},
 attachments:{bowl:{x:1,y:-8},lid:{x:0,y:0}},bindings:{table:pin,bowl:pin,well:pin,lid:pin}};
const state={schemaVersion:'ngs.assembly.v1',projectId:'binari',assemblyId:id,revision:1,updatedAt:12,officialRequestId:id,title:'테스트 조립',
 map:{mapId:id,revision:2,officialRequestId:id},puzzles:[puzzle]};
test('Formal assembly update retains explicit complete bindings and permits removing the final puzzle',()=>{
 const base={schemaVersion:'ngs.assembly-update.v1',projectId:'binari',assemblyId:id,expectedRevision:1};
 assert.ok(validAssemblyState(state));assert.ok(validAssemblyRequest({...base,puzzles:[puzzle]},'assembly.update'));
 assert.ok(validAssemblyRequest({...base,puzzles:[]},'assembly.update'));
 assert.ok(!validAssemblyRequest({...base,puzzles:[{...puzzle,bindings:{...puzzle.bindings,lid:null}}]},'assembly.update'));
 const graph={startRegionId:'a',regions:[{id:'a'},{id:'b'}],connections:[{from:'a',to:'b'}]};
 assert.ok(!assemblyReachable(graph,[puzzle]));
 assert.ok(assemblyReachable({...graph,connections:[...graph.connections,{from:'b',to:'a'}]},[puzzle]));
});
test('Local replica serves the newest exact immutable assembly without rewriting map or props',async()=>{
 const root='cinematics/assemblies',base=root+'/'+id;
 const p={listChildren:async path=>path===root?[{kind:'directory',name:id}]:[{kind:'file',name:'1.json'},{kind:'file',name:'2.json'}],
  readBytes:async path=>path===base+'/1.json'?Buffer.from(JSON.stringify(state)):null};
 const read=query=>assemblyWorkspaceRead({query:new URLSearchParams(query),openProject:()=>p,authorize:()=>{}});
 assert.deepEqual((await read({projectId:'binari',item:id})).json,{assembly:state});
 assert.deepEqual((await read({projectId:'binari'})).json.assemblies.map(x=>[x.assemblyId,x.revision]),[[id,1]]);
});
