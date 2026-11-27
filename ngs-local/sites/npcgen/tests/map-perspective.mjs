import test from 'node:test';
import assert from 'node:assert/strict';
import {validMapGraph,validMapPerspective} from '../build/map-contract.mjs';
import {assemblyPerspective} from '../build/assembly-actor.mjs';
import {projectMapTab} from '../build/map-workspace-ui.mjs';
import {validFileUpdate,fileUpdateSchema,mapUpdateRoot} from '../build/file-update-envelope.mjs';

const perspective={near:{point:{x:486,y:645},actorHeight:376,viewWidth:872},far:{point:{x:308,y:366},actorHeight:87,viewWidth:543}};
const region={id:'yard',name:'마당',description:'마당',backgroundId:'background.'+'a'.repeat(64),imageSha256:'b'.repeat(64)};
const base={title:'굿터',startRegionId:'yard',regions:[region],connections:[]};
const depth={...base,regions:[{...region,perspective}]};

test('map metadata and the common file.update accept bounded camera settings; old maps remain valid',()=>{
 assert.equal(validMapGraph(base),true);assert.equal(validMapGraph(depth),true);
 assert.equal(validMapGraph(depth,{partial:true}),false);
 assert.equal(validMapPerspective({...perspective,far:perspective.near}),false);
 assert.equal(validMapPerspective({...perspective,far:{...perspective.far,viewWidth:0}}),false);
 assert.equal(validMapPerspective({...perspective,near:{...perspective.near,actorHeight:true}}),false);
 const official='request.official.'+'e'.repeat(64);
 assert.equal(validFileUpdate({schemaVersion:fileUpdateSchema,projectId:'binari',target:{root:mapUpdateRoot,path:official,kind:'metadata'},expected:{revision:1,officialRequestId:official},content:depth}),true);
});
test('editing perspective is isolated from portal drafts and pinned to matching background art',()=>{
 const edited={...depth,title:'ignore',regions:[{...depth.regions[0],name:'do not apply'}]};
 const scoped=projectMapTab(base,edited,'perspective');
 assert.deepEqual(scoped,depth);
 assert.deepEqual(projectMapTab(base,edited,'links').regions[0],{...region,name:'do not apply'});
 const replacement={...depth,regions:[{...depth.regions[0],imageSha256:'c'.repeat(64)}]};
 assert.deepEqual(projectMapTab(depth,replacement,'perspective'),depth);
 assert(!Object.hasOwn(projectMapTab(depth,replacement,'links').regions[0],'perspective'));
 assert.equal(projectMapTab(depth,{...base,regions:[{...region,perspective:null}]},'perspective').regions[0].perspective,null);
});
test('camera follows foot depth only, uses independent size and zoom, and never exposes outside image',()=>{
 const a=assemblyPerspective(perspective,perspective.near.point),b=assemblyPerspective(perspective,perspective.far.point);
 assert.equal(a.actorHeight,.376);assert.equal(b.actorHeight,.087);
 assert(a.zoom<b.zoom);
 for(const x of [0,300,1000])for(const y of [0,500,1000]){
  const v=assemblyPerspective(perspective,{x,y});
  assert(v.x<=0&&v.y<=0&&v.x>=-100*(v.zoom-1)&&v.y>=-100*(v.zoom-1));
 }
 assert.equal(assemblyPerspective(null,{x:0,y:0}),null);
});
