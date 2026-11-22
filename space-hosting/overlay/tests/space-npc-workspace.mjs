/** Shared NPC registry over actual workerd D1/R2, not a separate Space projection. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const here=p=>new URL(p,import.meta.url);
const {Miniflare}=createRequire(process.env.SPACE_TEST_PACKAGE_JSON??here('../../../sites/npcgen/package.json'))('miniflare');
const source=(path,relative)=>({type:'ESModule',path,contents:readFileSync(here(relative),'utf8')});
const shared='ngs-local/sites/npcgen/build/';
const sharedRoot=existsSync(here('../'+shared+'npc-workspace.mjs'))?'../':'../../../';
const files=['object-replica.mjs','replica-whole-file-wire.mjs','npc-workspace.mjs','project-workspace-view.mjs','workspace-read-storage.mjs','object-workspace-read-storage.mjs','workspace-read-registry.mjs','local-concept-category-contract.mjs','npc-motion-selection.mjs'];
const mini=new Miniflare({compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],r2Buckets:['BUCKET'],modules:[
 {type:'ESModule',path:'test.mjs',contents:`
  import {createSpaceFileReplica} from './build/space-file-replica.mjs';
  import {spaceWorkspaceReadResponse} from './build/space-workspace-read-response.mjs';
  export default {async fetch(req,env) {
   const replica=createSpaceFileReplica({db:env.DB,bucket:env.BUCKET});
   return await spaceWorkspaceReadResponse(req,replica,{authorize:(user,id,resource)=>user.userId==='fake-authorized'&&id==='binari'&&resource==='npcs'})??new Response(null,{status:404});
  }};
 `},
 source('build/space-file-replica.mjs','../build/space-file-replica.mjs'),
 source('build/space-workspace-read-storage.mjs','../build/space-workspace-read-storage.mjs'),
 source('build/space-workspace-read-response.mjs','../build/space-workspace-read-response.mjs'),
 ...files.map(file=>source(shared+file,sharedRoot+shared+file)),
 ]});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from([137,80,78,71,13,10,26,10,20]),id='npc.synthetic',decoy='npc.not-listed',prefix='npcs/'+id+'/';
const request=(q,allowed=true)=>mini.dispatchFetch('http://fixture.test/api/npc-workspace?'+q,
 {headers:{'oai-authenticated-user-id':allowed?'fake-authorized':'fake-not-authorized','oai-authenticated-user-email':'fixture@example.invalid'}});
try{
 const db=await mini.getD1Database('DB'),bucket=await mini.getR2Bucket('BUCKET');
 const migration=readFileSync(here(sharedRoot+'ngs-local/dev/0014_space_file_replica_versions.sql'),'utf8');
 for(const sql of migration.split('--> statement-breakpoint'))await db.prepare(sql).run();
 const put=async (relative,body)=>{
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  await bucket.put('ngs-replica/v1/binari/files/'+relative,bytes,{sha256:sha(bytes),customMetadata:{sha256:sha(bytes)}});
 };
 const document=Buffer.from('# Synthetic planning.');
 await put('npcs/metadata.json',{actId:'act.synthetic',characterOrder:[id]});
 await put('npcs/'+decoy+'/metadata.json',{id:decoy,name:'unlisted'});
 await put(prefix+'metadata.json',{id,name:'Synthetic',privateKey:'not in DTO',planningCategoryOrder:['category.synthetic'],
  portraitSets:{representative:{portraitAssetId:sha(png)+'.png'}}});
 await put(prefix+'planning/category.synthetic.json',{id:'category.synthetic',name:'Plan',contentFormat:'markdown.v1',contentSha256:sha(document)});
 await put(prefix+'planning/category.synthetic/content.md',document);
 await put(prefix+'assets/portraits/representative/portrait.png',png);
 assert.equal((await request('projectId=binari',false)).status,403);
 const body=await (await request('projectId=binari&npcId='+id)).json();
 assert.deepEqual(body.npcs.map(npc=>npc.id),[id]);assert.equal(body.npc.privateKey,undefined);
 assert.equal(body.planning[0].markdown,document.toString());
 assert.equal((await request('projectId=binari&npcId='+decoy)).status,404);
 const media=new URL('http://fixture.test'+body.portraits[0].url);
 const good=await request(media.searchParams);
 assert.equal(good.headers.get('Content-Type'),'image/png');
 assert.deepEqual(Buffer.from(await good.arrayBuffer()),png);
 media.searchParams.set('sha256','0'.repeat(64));
 assert.equal((await request(media.searchParams)).status,409);
 await put(prefix+'assets/portraits/representative/portrait.png',Buffer.from('wrong artifact'));
 media.searchParams.set('sha256',sha(png));
 assert.equal((await request(media.searchParams)).status,503);
 console.log('Space NPC shared registry: actual D1/R2 roster, Markdown, authorized pinned media and denial PASS');
}finally{await mini.dispose();}
