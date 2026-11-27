import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {mapWorkspaceRead} from '../build/map-workspace.mjs';
import {mapCanonical,mapRoot} from '../build/map-contract.mjs';
const oid=c=>'request.official.'+c.repeat(64),mapId=oid('a'),base=mapRoot+'/'+mapId;
const regions=['start','end'].map((id,i)=>({id,name:id,description:id,backgroundId:'background.'+String(i).repeat(64),imageSha256:String(i).repeat(64)}));
const edge={id:'path',from:'start',to:'end',hit:{x:300,y:330,width:100,height:220},spawn:{x:400,y:440},label:'path'};
const graph={title:'굿터',regions,startRegionId:'start',connections:[edge]};
const wall={id:'wall',regionId:'end',shape:'ellipse',rotation:45,rect:{x:500,y:600,width:80,height:140}};
const state=(revision,officialRequestId,graph)=>({schemaVersion:'ngs.map-metadata.v1',projectId:'binari',mapId,revision,updatedAt:revision,officialRequestId,graph});
const raw=v=>Buffer.from(mapCanonical(v)+'\n');
const sha=v=>createHash('sha256').update(v).digest('hex');
function fixture(){
 const fs=new Map();
 const write=(path,data)=>{fs.set(path,raw(data));return sha(fs.get(path));};
 const add=(revision,officialRequestId,graph)=>{
  const path=base+'/'+revision;
  const parts={start:write(path+'.start.json',{startRegionId:graph.startRegionId,...(graph.startPoint?{startPoint:graph.startPoint}:{})}),
   portals:write(path+'.portals.json',{connections:graph.connections}),
   collisions:write(path+'.collisions.json',Object.hasOwn(graph,'colliders')?{colliders:graph.colliders}:{})};
  write(path+'.json',{schemaVersion:'ngs.map-group.v1',projectId:'binari',mapId,revision,updatedAt:revision,officialRequestId,
   title:graph.title,regions:graph.regions,parts});
 };
 const project={
  async readBytes(path){return fs.get(path)??null;},
  async listChildren(path){return path===mapRoot?[{kind:'directory',name:mapId}]:
   [...fs.keys()].filter(k=>k.startsWith(path+'/')).map(k=>({kind:'file',name:k.slice(path.length+1)}));},
 };
 const get=(item=mapId)=>mapWorkspaceRead({query:new URLSearchParams({projectId:'binari',...(item?{item}:{})}),openProject:async()=>project,authorize:async()=>true});
 return {fs,write,add,get};
}
test('legacy and completed split revisions provide the same validated consumer packet',async()=>{
 const f=fixture();f.write(base+'/1.json',state(1,mapId,graph));
 assert.deepEqual((await f.get()).json.map,state(1,mapId,graph));
 const rt={...graph,startPoint:{x:211,y:712},colliders:[wall]};f.add(2,oid('b'),rt);
 assert.deepEqual((await f.get()).json.map,state(2,oid('b'),rt));
 assert.deepEqual((await f.get(null)).json.maps,[{mapId,title:graph.title,revision:2,officialRequestId:oid('b'),updatedAt:2}]);
});
test('replica falls back on incomplete arrival and never reads orphan parts as a revision',async()=>{
 const f=fixture();f.add(1,oid('a'),graph);f.add(2,oid('b'),{...graph,startRegionId:'end',colliders:[wall]});
 f.fs.delete(base+'/2.portals.json');f.write(base+'/3.start.json',{startRegionId:'end'});
 assert.deepEqual((await f.get()).json.map,state(1,mapId,graph));
 assert.equal((await f.get(null)).json.maps[0].revision,1);
 f.fs.delete(base+'/1.json');
 assert.deepEqual((await f.get(null)).json.maps,[]);
});
test('corrupted or mismatched bytes do not silently become map metadata',async()=>{
 const f=fixture();f.add(1,mapId,graph);
 f.write(base+'/1.start.json',{startRegionId:'end'});
 await assert.rejects(f.get(),error=>error.status===503);
});
