/** Two independent hosted Worker instances share one existing committed replica/cache bucket. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const here=p=>new URL(p,import.meta.url);
const {Miniflare}=createRequire(process.env.SPACE_TEST_PACKAGE_JSON??here('../../../sites/npcgen/package.json'))('miniflare');
const shared='ngs-local/sites/npcgen/build/';
const base=existsSync(here('../'+shared+'npc-workspace.mjs'))?'../':'../../../';
const files=['object-replica.mjs','replica-whole-file-wire.mjs','npc-workspace.mjs','project-workspace-view.mjs','workspace-read-storage.mjs','object-workspace-read-storage.mjs','workspace-read-registry.mjs','local-concept-category-contract.mjs'];
const asset=(path,relative)=>({type:'ESModule',path,contents:readFileSync(here(relative),'utf8')});
const modules=[
 {type:'ESModule',path:'test.mjs',contents:`
  import {createSpaceFileReplica} from './build/space-file-replica.mjs';
  import {spaceWorkspaceReadResponse} from './build/space-workspace-read-response.mjs';
  export default {async fetch(req,env) {
   const counts={sourceReads:0,cacheReads:0,cacheWrites:0,versionChecks:0,auth:0};
   const cacheKey=key=>typeof key==='string'&&key.includes('/v2/npc-read-cache-v1/');
   let raced=false;
   const bucket=new Proxy(env.BUCKET,{get(target,k){
    const value=target[k];
    if(typeof value!=='function')return value;
    return async (...args)=>{
     const stage=req.headers.get('x-fixture-race');
     if(!raced&&(stage==='build'&&k==='list'||stage==='hit'&&k==='get'&&cacheKey(args[0]))){
      raced=true;
      await env.DB.prepare('INSERT INTO ngs_replica_version_v2(path,sha256,size,sync_id) VALUES(?,?,?,?)')
       .bind('npcs/npc.fixture/unrelated-tombstone.json','a'.repeat(64),0,'race-fixture').run();
     }
     if(k==='get'&&cacheKey(args[0]))counts.cacheReads++;
     else if(k==='put'&&cacheKey(args[0]))counts.cacheWrites++;
     else if(['get','head','list'].includes(k))counts.sourceReads++;
     return value.apply(target,args);
    };
   }});
   const db=new Proxy(env.DB,{get(target,k){
    const value=target[k];
    if(typeof value!=='function')return value;
    return (...args)=>{
     if(k==='prepare'&&args[0].startsWith('SELECT MAX(version) AS version'))counts.versionChecks++;
     return value.apply(target,args);
    };
   }});
   const replica=createSpaceFileReplica({db,bucket});
   const response=await spaceWorkspaceReadResponse(req,replica,{authorize:(user,id,resource)=>{
     counts.auth++;
     return ['viewer-a','viewer-b'].includes(user.userId)&&id==='binari'&&resource==='npcs';
   }})??new Response(null,{status:404});
   const headers=new Headers(response.headers);headers.set('x-fixture-counts',JSON.stringify(counts));
   return new Response(response.body,{status:response.status,headers});
  }};
 `},
 ...['space-file-replica.mjs','space-workspace-read-storage.mjs','space-workspace-read-response.mjs'].map(f=>asset('build/'+f,'../build/'+f)),
 ...files.map(f=>asset(shared+f,base+shared+f)),
];
const mini=new Miniflare({workers:['one','two'].map(name=>({name,compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
 d1Databases:{DB:'same-db'},r2Buckets:{BUCKET:'same-bucket'},modules}))});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root='ngs-replica/v1/binari/';
const obtain=async(worker,user,npcId,status=200,race='')=>{
 const params=new URLSearchParams({projectId:'binari',...(npcId?{npcId}:{})});
 const response=await worker.fetch('http://fixture.test/api/npc-workspace?'+params,{
  headers:{'oai-authenticated-user-id':user,'oai-authenticated-user-email':'fixture@example.invalid','x-fixture-race':race}});
 const body=await response.json();
 const counts=JSON.parse(response.headers.get('x-fixture-counts'));
 assert.equal(response.status,status,JSON.stringify(body));
 assert.equal(counts.auth,1);
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 return {body,counts};
};
try{
 const db=await mini.getD1Database('DB','one'),bucket=await mini.getR2Bucket('BUCKET','one');
 const one=await mini.getWorker('one'),two=await mini.getWorker('two');
 for(const sql of readFileSync(here(base+'ngs-local/dev/0014_space_file_replica_versions.sql'),'utf8').split('--> statement-breakpoint'))
  await db.prepare(sql).run();
 const publish=async(path,value)=>{
  const data=value===null?null:Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  const digest=sha(data??Buffer.from('deleted'));
  const key=data?root+'v2/objects/'+randomUUID():null;
  if(data)await bucket.put(key,data,{customMetadata:{sha256:digest}});
  await db.prepare('INSERT INTO ngs_replica_version_v2(path,sha256,object_key,size,sync_id) VALUES(?,?,?,?,?)')
   .bind(path,digest,key,data?.length??0,'fixture').run();
 };
 const id='npc.fixture',npcRoot='npcs/'+id+'/';
 await publish('npcs/metadata.json',{characterOrder:[id]});
 await publish(npcRoot+'metadata.json',{id,name:'First',planningCategoryOrder:[]});
 const denied=await obtain(two,'not-granted',id,403);
 assert.deepEqual(denied.counts,{sourceReads:0,cacheReads:0,cacheWrites:0,versionChecks:0,auth:1});
 const roster=await obtain(one,'viewer-a',null);
 assert.equal(roster.body.npcs[0].name,'First');
 assert.equal(roster.counts.cacheWrites,1);
 const rosterWarm=await obtain(two,'viewer-b',null);
 assert.deepEqual(rosterWarm.body,roster.body);
 assert.equal(rosterWarm.counts.sourceReads,0);
 const cold=await obtain(one,'viewer-a',id);
 assert.ok(cold.counts.sourceReads>0);
 assert.equal(cold.counts.cacheWrites,1);
 const warm=await obtain(two,'viewer-b',id);
 assert.deepEqual(warm.body,cold.body);
 assert.deepEqual(warm.counts,{sourceReads:0,cacheReads:1,cacheWrites:0,versionChecks:2,auth:1});
 await publish('audio/other.json',{notNpc:true});
 assert.equal((await obtain(one,'viewer-a',id)).counts.sourceReads,0);
 await publish(npcRoot+'metadata.json',{id,name:'New',planningCategoryOrder:[]});
 const racingBuild=await obtain(two,'viewer-b',id,200,'build');
 assert.equal(racingBuild.counts.cacheWrites,0);
 assert.equal(racingBuild.body.npc.name,'New');
 const fresh=await obtain(two,'viewer-b',id);
 assert.equal(fresh.body.npc.name,'New');
 assert.ok(fresh.counts.sourceReads>0);
 assert.equal((await obtain(one,'viewer-a',id)).counts.sourceReads,0);
 const racingHit=await obtain(one,'viewer-a',id,200,'hit');
 assert.ok(racingHit.counts.sourceReads>0);
 assert.equal(racingHit.counts.cacheWrites,0);
 await publish(npcRoot+'metadata.json',{id,name:'Missing markdown',planningCategoryOrder:['category.test']});
 await publish(npcRoot+'planning/category.test.json',{id:'category.test',contentFormat:'markdown.v1',contentSha256:sha(Buffer.from('final'))});
 for(const worker of [one,two]){
  const partial=await obtain(worker,'viewer-a',id);
  assert.equal(partial.body.planning[0].markdown,undefined);
  assert.equal(partial.counts.cacheWrites,0);
  assert.ok(partial.counts.sourceReads>0);
 }
 await publish(npcRoot+'planning/category.test/content.md',Buffer.from('final'));
 assert.equal((await obtain(one,'viewer-a',id)).body.planning[0].markdown,'final');
 await publish(npcRoot+'metadata.json',null);
 await obtain(two,'viewer-b',id,404);
 const index=await bucket.list({prefix:root+'v2/npc-read-cache-v1/'});
 assert.equal(index.objects.length,2);
 console.log(JSON.stringify({cold:cold.counts,warm:warm.counts}));
}finally{await mini.dispose();}
