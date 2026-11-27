import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpiritManifestation} from '../build/well-puzzle-demo.mjs';
import {decorationArt,decorationBox,decorationsLoader} from '../build/assembly-sprite-layout.mjs';
import {validAssemblyPuzzle,spiritPuzzleType} from '../build/assembly-contract.mjs';
import {mapSchemas,mapStagesFor,validMapRequest,validMapGraph} from '../build/map-contract.mjs';

const pin={propId:'disturbed-talisman',revision:2,sha256:'1'.repeat(64)},anchor={x:650,y:600};
const id='r2',region={id,width:1000,height:600},row={id:'d-1',regionId:id,prop:pin,visibility:'both',anchor,scale:75};
const art={propId:pin.propId,source:{revision:2,sha256:pin.sha256},media:{
 pixel:{mediaType:'image/png',width:200,height:100,url:'/api/prop-workspace?pixel'},
 spirit:{mediaType:'image/png',width:200,height:100,url:'/api/prop-workspace?spirit'},
}};
const regionRows=['r1','r2'].map((id,i)=>({id,name:id,description:id,backgroundId:'background.'+(i?'2':'1').repeat(64),imageSha256:(i?'2':'1').repeat(64)}));
const graph={title:'Fixture',regions:regionRows,startRegionId:'r1',connections:[{id:'route-1',from:'r1',to:'r2',label:'구역 이동',hit:null,spawn:null}]};
test('Manifestation is initially visible only with ability ON, requires proximity and never turns back',()=>{
 const s=createSpiritManifestation(),other=createSpiritManifestation();
 assert.equal(s.state(),'veiled');assert.equal(s.visible(false),false);assert.equal(s.visible(true),true);
 assert.equal(s.activate({sight:false,near:true}),null);
 assert.equal(s.activate({sight:true,near:false}),null);
 assert.deepEqual(s.activate({sight:true,near:true}),{before:{state:'veiled',location:'scene'},after:{state:'manifested',location:'scene'}});
 assert.equal(s.visible(false),true);assert.equal(s.visible(true),true);
 assert.equal(s.activate({sight:true,near:true}),null);assert.equal(other.visible(false),false);
 const p={id:'spirit-fixture',type:spiritPuzzleType,layout:{spirit:{regionId:id,x:40,y:50}},attachments:{},bindings:{spirit:pin},scale:{spirit:80}};
 assert.equal(validAssemblyPuzzle(p),true);assert.equal(validAssemblyPuzzle({...p,portalConditions:[]}),false);
});
test('Decoration uses its selected lane, with no lost one-sided visibility or geometry at a different zoom',async()=>{
 const images=decorationArt(art,pin);
 assert.deepEqual(decorationBox(row,images,region,false),{src:art.media.pixel.url,x:65,y:60,width:15,height:12.5});
 assert.equal(decorationBox(row,images,region,true).src,art.media.spirit.url);
 assert.equal(decorationBox({...row,visibility:'cinematic'},images,region,false),null);
 assert.equal(decorationBox({...row,visibility:'pixel'},images,region,true),null);
 assert.equal(decorationBox(row,{pixel:images.pixel},region,true),null);
 assert.equal(decorationArt(art,{...pin,revision:1}),null);
 let count=0;const loader=decorationsLoader(async path=>{count++;assert.ok(path.includes(pin.propId));return {prop:art};},'binari');
 await Promise.all([loader.load([row,row]),loader.load([row])]);assert.equal(count,1);
});
test('Optional v3 decoration generation sends only validated mode, notes and candidate pins',()=>{
 const p={schemaVersion:mapSchemas[3],projectId:'binari',graph,intent:'굿터',design:{startNotes:'',portalNotes:'',collisionNotes:'',collisionMode:'none'},
  decorationDesign:{mode:'suggest',notes:'등불은 길 가장자리에',candidates:[{prop:pin,visibility:'cinematic'}]}};
 assert.ok(validMapRequest(p,'map.generate'));
 assert.deepEqual(mapStagesFor(p),['map_start','map_portals','map_collisions','map_decorations']);
 const none={...p,decorationDesign:{mode:'none',notes:'',candidates:[]}};
 assert.ok(validMapRequest(none,'map.generate'));assert.equal(mapStagesFor(none).length,3);
 assert.equal(validMapRequest({...p,graph:{...graph,decorations:[]}},'map.generate'),false);
 assert.equal(validMapRequest({...p,decorationDesign:{...p.decorationDesign,candidates:[...p.decorationDesign.candidates,...p.decorationDesign.candidates]}},'map.generate'),false);
 const complete={...graph,connections:graph.connections.map(e=>({...e,hit:{x:500,y:500,width:50,height:100},spawn:{x:500,y:500}})),decorations:[row]};
 assert.equal(validMapGraph(complete),true);
 assert.equal(validMapGraph({...complete,decorations:[{...row,regionId:'orphan'}]}),false);
});

test('Formal assembly generation v3 takes direction and a pinned prop, never a placement or executable logic',async()=>{
 const {validAssemblyRequest,assemblyPuzzleType,spiritPuzzleType}=await import('../build/assembly-contract.mjs');
 const p={schemaVersion:'ngs.assembly-generate.v3',projectId:'binari',title:'굿터',mapId:'request.official.'+'f'.repeat(64),intent:'뒤뜰을 돌며 단서를 찾는다',
  puzzles:[{id:'well',type:assemblyPuzzleType,intent:'굿상에 물 올리기'},{id:'spirit',type:spiritPuzzleType,prop:pin,intent:'나무 옆 부적을 보이게'}]};
 assert.ok(validAssemblyRequest(p,'assembly.generate'));
 assert.ok(!validAssemblyRequest({...p,schemaVersion:'ngs.assembly-generate.v2'},'assembly.generate'));
 assert.ok(!validAssemblyRequest({...p,puzzles:[{...p.puzzles[1],point:anchor}]},'assembly.generate'));
 assert.ok(!validAssemblyRequest({...p,puzzles:[{id:'spirit',type:spiritPuzzleType,intent:''}]},'assembly.generate'));
});
