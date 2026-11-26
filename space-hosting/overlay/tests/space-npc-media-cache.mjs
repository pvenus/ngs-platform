/** Real Workerd named-cache and D1/R2 with authorized fixtures only. */
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const here=p=>new URL(p,import.meta.url);
const {Miniflare}=createRequire(process.env.SPACE_TEST_PACKAGE_JSON??here('../../../sites/npcgen/package.json'))('miniflare');
const shared='ngs-local/sites/npcgen/build/';
const base=existsSync(here('../'+shared+'npc-workspace.mjs'))?'../':'../../../';
const files=['object-replica.mjs','audio-result-index.mjs','replica-whole-file-wire.mjs','npc-workspace.mjs','project-workspace-view.mjs','workspace-read-storage.mjs','object-workspace-read-storage.mjs','workspace-read-registry.mjs','background-workspace.mjs','cinematic-sequence-contract.mjs','cinematic-timeline.mjs','cinematic-player.mjs','cinematic-contract.mjs','cinematic-workspace.mjs','prop-workspace.mjs','prop-folder-delete-contract.mjs','prop-workspace-contract.mjs','prop-design-pin.mjs','prop-package-contract.mjs','local-concept-category-contract.mjs','npc-motion-selection.mjs'];
const asset=(path,relative)=>({type:'ESModule',path,contents:readFileSync(here(relative),'utf8')});
const mini=new Miniflare({compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],r2Buckets:['BUCKET'],modules:[
 {type:'ESModule',path:'test.mjs',contents:`
  import {createSpaceFileReplica} from './build/space-file-replica.mjs';
  import {spaceWorkspaceReadResponse} from './build/space-workspace-read-response.mjs';
  export default {async fetch(req,env){
   const counts={assetHead:0,assetGet:0,auth:0,cacheObjectsPut:0};
   const target=req.headers.get('x-fixture-asset');
   const bucket=new Proxy(env.BUCKET,{get(t,k){
    const original=t[k];if(typeof original!=='function')return original;
    return (...args)=>{
     if(args[0]===target&&k==='head')counts.assetHead++;
     if(args[0]===target&&k==='get')counts.assetGet++;
     if(k==='put')counts.cacheObjectsPut++;
     return original.apply(t,args);
    };
   }});
   const cacheOrigin=req.headers.has('x-fixture-invalid-cache')?'invalid:':new URL(req.url).origin;
   const reply=await spaceWorkspaceReadResponse(req,createSpaceFileReplica({db:env.DB,bucket,cacheOrigin}),{
    authorize:(user,id,resource)=>{
     counts.auth++;
     return ['viewer-a','viewer-b'].includes(user.userId)&&id==='binari'&&resource==='npcs'
      &&!req.headers.has('x-fixture-revoke');
    },
   })??new Response(null,{status:404});
   const headers=new Headers(reply.headers);headers.set('x-fixture-counts',JSON.stringify(counts));
   return new Response(reply.body,{status:reply.status,headers});
  }};
 `},
 ...['space-file-replica.mjs','space-workspace-read-storage.mjs','space-workspace-read-response.mjs'].map(f=>asset('build/'+f,'../build/'+f)),
 ...files.map(f=>asset(shared+f,base+shared+f)),
 ]});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const root='ngs-replica/v1/binari/';
const id='npc.fixture',image='npcs/'+id+'/assets/portraits/representative/portrait.png';
const png=x=>Buffer.from([137,80,78,71,13,10,26,10,x]);
const media=(sha256,locator='portrait/representative/portrait')=>'/api/npc-workspace?'+new URLSearchParams({projectId:'binari',npcId:id,media:locator,sha256});
async function get(path,key,status=200,{user='viewer-a',method='GET',extra={}}={}){
 const headers={'x-fixture-asset':key,'oai-authenticated-user-id':user,
  'oai-authenticated-user-email':'fixture@example.invalid',...extra};
 const response=await mini.dispatchFetch('http://fixture.invalid'+path,{method,headers});
 assert.equal(response.status,status,await response.clone().text());
 assert.equal(response.headers.get('cache-control'),'private, no-store');
 return {body:Buffer.from(await response.arrayBuffer()),counts:JSON.parse(response.headers.get('x-fixture-counts'))};
}
try{
 const db=await mini.getD1Database('DB'),bucket=await mini.getR2Bucket('BUCKET');
 for(const sql of readFileSync(here(base+'ngs-local/dev/0014_space_file_replica_versions.sql'),'utf8').split('--> statement-breakpoint'))
  await db.prepare(sql).run();
 const publish=async(path,value)=>{
  const bytes=value===null?null:Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value));
  const sha=hash(bytes??Buffer.from('deleted')),key=bytes?root+'v2/objects/'+randomUUID():null;
  if(bytes)await bucket.put(key,bytes,{customMetadata:{sha256:sha}});
  await db.prepare('INSERT INTO ngs_replica_version_v2(path,sha256,object_key,size,sync_id) VALUES(?,?,?,?,?)')
   .bind(path,sha,key,bytes?.length??0,'fixture').run();
  return {sha,key};
 };
 const select=asset=>publish('npcs/'+id+'/metadata.json',{id,name:'Fixture',portraitSets:{representative:{portraitAssetId:asset.sha+'.png'}}});
 await publish('npcs/metadata.json',{characterOrder:[id]});
 const image1=await publish(image,png(11));await select(image1);
 const cold=await get(media(image1.sha),image1.key);
 assert.deepEqual(cold.body,png(11));assert.equal(cold.counts.assetGet,1);
 const warm=await get(media(image1.sha),image1.key,200,{user:'viewer-b'});
 assert.deepEqual(warm.body,cold.body);
 assert.deepEqual(warm.counts,{assetHead:1,assetGet:0,auth:1,cacheObjectsPut:0});
 const denied=await get(media(image1.sha),image1.key,403,{user:'viewer-b',extra:{'x-fixture-revoke':'1'}});
 assert.deepEqual(denied.counts,{assetHead:0,assetGet:0,auth:1,cacheObjectsPut:0});
 const wrong=await get(media('d'.repeat(64)),image1.key,409);
 assert.equal(wrong.counts.assetGet,0);assert.equal(wrong.counts.assetHead,0);
 assert.equal((await get(media(image1.sha),image1.key,405,{method:'HEAD'})).counts.assetGet,0);
 const range=await get(media(image1.sha),image1.key,200,{extra:{Range:'bytes=0-4'}});
 assert.equal(range.counts.assetGet,1);assert.deepEqual(range.body,png(11)); // preserve pre-existing full NPC media response
 const image2=await publish(image,png(22));await select(image2);
 assert.equal((await get(media(image1.sha),image1.key,409)).counts.assetGet,0);
 const fallback=await get(media(image2.sha),image2.key,200,{extra:{'x-fixture-invalid-cache':'1'}});
 assert.equal(fallback.counts.assetGet,1);assert.deepEqual(fallback.body,png(22));
 assert.equal((await get(media(image2.sha),image2.key)).counts.assetGet,1); // failure did not fill
 assert.equal((await get(media(image2.sha),image2.key)).counts.assetGet,0);
 await bucket.put(image2.key,png(99),{customMetadata:{sha256:image2.sha}}); // untrusted origin changed ETag
 assert.equal((await get(media(image2.sha),image2.key,503)).counts.assetGet,1);
 await publish(image,null);
 assert.equal((await get(media(image2.sha),image2.key,404)).counts.assetGet,0);
 console.log(JSON.stringify({cold:cold.counts,warm:warm.counts}));
}finally{await mini.dispose();}
