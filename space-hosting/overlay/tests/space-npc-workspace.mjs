/** Shared NPC registry over actual workerd D1/R2, not a separate Space projection. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const here=p=>new URL(p,import.meta.url);
const {Miniflare}=createRequire(process.env.SPACE_TEST_PACKAGE_JSON??here('../../../sites/npcgen/package.json'))('miniflare');
const source=(path,relative)=>({type:'ESModule',path,contents:readFileSync(here(relative),'utf8')});
const shared='ngs-local/sites/npcgen/build/';
const files=['npc-workspace.mjs','project-workspace-view.mjs','workspace-read-storage.mjs','workspace-read-registry.mjs','local-concept-category-contract.mjs'];
const mini=new Miniflare({compatibilityDate:'2025-11-01',compatibilityFlags:['nodejs_compat'],
 d1Databases:['DB'],r2Buckets:['BUCKET'],modules:[
 {type:'ESModule',path:'test.mjs',contents:`
  import {createSpaceFileReplica} from './build/space-file-replica.mjs';
  import {openSpaceWorkspaceProject} from './build/space-workspace-read-storage.mjs';
  import {npcWorkspaceRead} from './${shared}npc-workspace.mjs';
  import {dispatchWorkspaceRead} from './${shared}workspace-read-registry.mjs';
  export default {async fetch(req,env) {
   const {pathname,searchParams}=new URL(req.url);
   const replica=createSpaceFileReplica({db:env.DB,bucket:env.BUCKET});
   try{
    const result=await dispatchWorkspaceRead({pathname,query:searchParams,npcRead:npcWorkspaceRead,
     openProject: id=>openSpaceWorkspaceProject(replica,id),
     authorize: id=>{if(id!=='binari'||req.headers.get('test-project-grant')!=='yes')throw Object.assign(Error('denied'),{status:403});}});
    return result?.bytes?new Response(result.bytes,{headers:{'Content-Type':result.mime}}):result?.json?
     Response.json(result.json):new Response(null,{status:404});
   }catch(e){return Response.json({error:e.message},{status:e.status??500});}
  }};
 `},
 source('build/space-file-replica.mjs','../build/space-file-replica.mjs'),
 source('build/space-workspace-read-storage.mjs','../build/space-workspace-read-storage.mjs'),
 ...files.map(file=>source(shared+file,'../../../'+shared+file)),
 ]});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from([137,80,78,71,13,10,26,10,20]),id='npc.synthetic',decoy='npc.not-listed',prefix='npcs/'+id+'/';
const request=(q,allowed=true)=>mini.dispatchFetch('http://fixture.test/api/npc-workspace?'+q,
 {headers:allowed?{'test-project-grant':'yes'}:{}});
try{
 const db=await mini.getD1Database('DB'),bucket=await mini.getR2Bucket('BUCKET');
 const migration=readFileSync(here('../drizzle/0014_space_file_replica_versions.sql'),'utf8');
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
