import test from 'node:test';
import assert from 'node:assert/strict';
import {buildWellRehearsal,dragWellPlacement} from '../build/well-assembly-ui.mjs';
import {wellAssemblySlots} from '../build/well-puzzle-demo.mjs';

const sha=s=>s.repeat(64),id='request.official.'+sha('c');
function fixture(){
 const regions=['a','b'].map((key,i)=>({id:'zone-'+(i+1),name:'구역 '+i,description:'테스트 배경',backgroundId:'background.'+sha(key),imageSha256:sha(key)}));
 const map={schemaVersion:'ngs.map-metadata.v1',projectId:'binari',mapId:id,officialRequestId:id,revision:1,updatedAt:0,graph:{title:'테스트 맵',
  regions,startRegionId:'zone-1',connections:[{id:'route-1',from:'zone-1',to:'zone-2',label:'이동',hit:{x:10,y:20,width:10,height:10},spawn:{x:10,y:10}}]}};
 const backgrounds=regions.map(r=>({backgroundId:r.backgroundId,pixel:{sha256:r.imageSha256,width:1536,height:1024}}));
 const bindings=Object.fromEntries(Object.keys(wellAssemblySlots).map(k=>[k,k+'-v1']));
 const props=Object.values(bindings).map(propId=>({propId,revision:1,sha256:sha('d')}));
 const media=Object.fromEntries(Object.entries(bindings).map(([role,propId])=>[role,{propId,source:{revision:1,sha256:sha('d')},
  media:{pixel:{mediaType:'image/png',url:'/api/prop-workspace?asset='+propId}}}]));
 return {map,backgrounds,bindings,props,media,layout:{altar:{regionId:'zone-1',x:40,y:60},well:{regionId:'zone-2',x:50,y:60}}};
}

test('Assembly binds all design ports to exact published art, keeping separate positions and the real outgoing map links',()=>{
 const f=fixture(),a=buildWellRehearsal(f);
 assert.equal(a.initialRegion,'zone-1');assert.deepEqual(a.connections,f.map.graph.connections);
 assert.deepEqual(a.positions,f.layout);assert.deepEqual(Object.keys(a.art),Object.keys(wellAssemblySlots));
 assert.match(a.regions[1].src,new RegExp(sha('b')));
 assert.match(a.art.lid,/lid-v1/);
});
test('Assembly refuses stale prop revisions, unpinned backgrounds and nonexistent placement regions',()=>{
 const f=fixture();
 assert.throws(()=>buildWellRehearsal({...f,media:{...f.media,lid:{...f.media.lid,source:{revision:2,sha256:sha('d')}}}}),/PROP_ART/);
 assert.throws(()=>buildWellRehearsal({...f,backgrounds:f.backgrounds.slice(1)}),/MAP_ART/);
 assert.throws(()=>buildWellRehearsal({...f,layout:{...f.layout,well:{...f.layout.well,regionId:'zone-9'}}}),/PLACEMENT/);
});

test('Dragging a base can change zones but a child retains its owner and adjusts only by an offset',()=>{
 const f=fixture(),attachments={bowl:{x:5,y:-10},lid:{x:5,y:-10}};
 const args={regionId:'zone-2',clientX:170,clientY:230,rect:{left:100,top:100,width:200,height:200},layout:f.layout,attachments};
 assert.deepEqual(dragWellPlacement({...args,role:'table'}).layout.altar,{regionId:'zone-2',x:35,y:65});
 assert.equal(dragWellPlacement({...args,role:'bowl'}),null);
 assert.deepEqual(dragWellPlacement({...args,role:'lid'}).attachments.lid,{x:-12,y:5});
 assert.equal(dragWellPlacement({...args,role:'well',clientY:50}),null);
 assert.deepEqual(f.layout.altar,{regionId:'zone-1',x:40,y:60});
});
