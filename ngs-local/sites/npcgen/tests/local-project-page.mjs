import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer,request} from 'node:http';
import {existsSync,mkdtempSync,readFileSync,readdirSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {configuration,createLocalProjectPageServer} from '../build/local-project-page-server.mjs';

const project=Buffer.from('{"name":"비나리"}');
const icon=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXZkAAAAASUVORK5CYII=','base64');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[{path:'binari/project.json',sha256:sha256(project),size:project.length},
 {path:'binari/icon.png',sha256:sha256(icon),size:icon.length}];
const innerBytes=Buffer.from('npc file');
const innerFiles=[{path:'npc.txt',sha256:sha256(innerBytes),size:innerBytes.length}];
const json=(res,value)=>res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(value));
async function listen(t,server){
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port;
}
function fakeHost(origin){
 return new Promise((resolve,reject)=>{
  request(origin,{headers:{Host:'forged.example'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject).end();
 });
}

test('empty local startup with existing auth, grouped PDS sync, icon, and cached revisit',async t=>{
 const folder=mkdtempSync(join(realpathSync(tmpdir()),'ngs-project-page-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const root=join(folder,'data','project-catalog'),calls=[];
 let releaseHeader,headerArrived;
 const headerGate=new Promise(ok=>{releaseHeader=ok;});
 const headerStarted=new Promise(ok=>{headerArrived=ok;});
 const mcpOrigin=await listen(t,createServer(async(req,res)=>{
  assert.equal(req.method,'POST');
  assert.equal(req.url,'/mcp');
  assert.equal(req.headers.cookie,undefined);
  assert.equal(req.headers.authorization,undefined);
  const chunks=[];for await(const b of req)chunks.push(b);
  const message=JSON.parse(Buffer.concat(chunks));
  assert.equal(message.jsonrpc,'2.0');
  if(message.method==='initialize'){
   calls.push(['initialize']);
   return json(res,{jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-06-18',capabilities:{tools:{}}}});
  }
  assert.equal(req.headers['mcp-protocol-version'],'2025-06-18');
  if(message.method==='notifications/initialized'){calls.push(['initialized']);return res.writeHead(202).end();}
  assert.equal(message.method,'tools/call');
  const {name,arguments:args}=message.params;
  calls.push([name,args.scope??null]);
  const tool=structuredContent=>json(res,{jsonrpc:'2.0',id:message.id,result:{structuredContent}});
  if(name==='npc_project_folders_list')return tool({projects:['binari','unapproved']});
  if(name==='npc_folders_compare'){
   if(args.scope.endsWith('/character.test/assets/portraits')||args.scope.endsWith('/character.test/non-media')||
      args.scope.endsWith('/character.test/pose-views')){
    const unavailable=args.scope.endsWith('/pose-views');
    return json(res,{jsonrpc:'2.0',id:message.id,result:{isError:true,content:[{type:'text',text:JSON.stringify({
     error:unavailable?'FOLDER_SOURCE_UNAVAILABLE':'FOLDER_SCOPE_NOT_FOUND',status:unavailable?503:404,
    })}]}});
   }
   if(args.scope==='binari/npcs'){
    assert.deepEqual(args,{scope:'binari/npcs',files:[],includeDeleted:true});
    return tool({scope:args.scope,groups:[{folder:'',files:innerFiles}],deleted:[]});
   }
   assert.deepEqual(args,{scope:'',files:[],includeDeleted:true});
   return tool({scope:'',groups:[{folder:'binari',files},{folder:'unapproved',files:[
    {path:'unapproved/project.json',sha256:sha256(project),size:project.length}]}],deleted:[]});
  }
  assert.equal(name,'npc_folder_file_chunk');
  const bytes=args.scope==='binari/npcs'?innerBytes:args.path.endsWith('project.json')?project:icon;
  if(args.scope===''&&args.path==='binari/project.json'){headerArrived();await headerGate;}
  assert.equal(args.sha256,sha256(bytes));
  assert.equal(args.offset,0);
  return tool({...args,size:bytes.length,nextOffset:null,base64:bytes.toString('base64')});
 }));
 const mcpUrl=mcpOrigin+'/mcp';
 assert.equal(existsSync(join(folder,'data')),false);
 assert.equal(configuration({}).port,5274);
 assert.equal(configuration({}).mcpUrl,'http://127.0.0.1:8030/mcp');
 assert.equal(configuration({NGS_PROJECT_OPS_MCP_URL:mcpUrl}).mcpUrl,mcpUrl);
 assert.throws(()=>configuration({NGS_PROJECT_LISTEN_PORT:'0'}),/LOCAL_PROJECT_PORT_INVALID/);
 assert.throws(()=>createLocalProjectPageServer({root,mcpUrl:'https://example.com/mcp'}),/FOLDER_MCP_UNAVAILABLE/);
 const origin=await listen(t,createLocalProjectPageServer({root,mcpUrl}));
 assert.deepEqual(readdirSync(join(folder,'data')),[]);
 const home=await fetch(origin);
 assert.equal(home.status,200);
 assert.match(await home.text(),/어떤 이야기를 만들까요\?/);
 assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 const js=await fetch(origin+'/local-project-page.js');
 assert.match(js.headers.get('content-type'),/text\/javascript/);
 assert.equal((await fetch(origin+'/api/npcs')).status,404);
 assert.equal((await fetch(origin+'/api/project-folders')).status,401);
 assert.equal(await fakeHost(origin),403);
 assert.equal((await fetch(origin+'/__npcgen_session',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);
 const start=await fetch(origin+'/__npcgen_session');
 const session=await start.json(),cookie=start.headers.get('set-cookie').split(';')[0];
 assert.match(start.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
 assert.equal(session.state,'authenticated');
 const secondStart=await fetch(origin+'/__npcgen_session');
 const second=await secondStart.json(),secondCookie=secondStart.headers.get('set-cookie').split(';')[0];
 assert.notEqual(second.contextId,session.contextId);
 const api=origin+'/api/project-folders';
 const get=(path,authorized=true)=>fetch(api+path,{headers:authorized?{cookie}:{}});
 const post=(path,value,extra={})=>fetch(api+path,{method:'POST',headers:{cookie,origin,
  'Content-Type':'application/json','x-npcgen-csrf':session.csrfToken,
  'x-npcgen-frontend-context':session.contextId,...extra},body:JSON.stringify(value)});
 assert.deepEqual(await (await get('')).json(),{projects:[]});
 assert.deepEqual(await (await get('/discover')).json(),{projects:['binari']});
 assert.equal((await post('/compare',{projectIds:['unapproved']})).status,403);
 assert.equal((await post('/compare',{projectIds:['binari']},{origin:'http://foreign.example'})).status,403);
 assert.equal((await post('/compare',{projectIds:['binari']},{'x-npcgen-csrf':'abc'})).status,403);
 assert.equal((await post('/compare',{projectIds:['binari']},{'x-npcgen-frontend-context':'wrong'})).status,409);
 const secondHeaders={cookie:secondCookie,'x-npcgen-csrf':second.csrfToken,'x-npcgen-frontend-context':second.contextId};
 const pairs=await Promise.all([post('/compare',{projectIds:['binari']}),post('/compare',{projectIds:['binari']},secondHeaders)]);
 for(const pair of pairs)assert.deepEqual(await pair.json(),{groups:[{projectId:'binari',count:2}],unavailable:[]});
 const pending=Promise.all([post('/refresh',{projectId:'binari'}),post('/refresh',{projectId:'binari'},secondHeaders)]);
 try{
  await headerStarted;
  let live;
  for(let attempt=0;attempt<100;attempt++){
   live=await (await get('')).json();
   if(live.refreshes?.[0]?.completed===1)break;
   await new Promise(ok=>setTimeout(ok,10));
  }
  // Separate status preserves progress even before project.json creates a card.
  assert.deepEqual(live,{projects:[],refreshes:[{projectId:'binari',phase:'downloading',completed:1,total:2}]});
  assert.equal((await get('',false)).status,401);
 }finally{releaseHeader();}
 const applies=await pending;
 const refreshed=await applies[0].json();
 assert.equal((await applies[1].json()).project.name,'비나리');

 assert.equal(refreshed.project.name,'비나리');
 assert.equal(refreshed.project.needsRefresh,false);
 const fresh=await (await get('')).json();
 assert.deepEqual(fresh.projects,[refreshed.project]);
 assert.equal((await post('/refresh',{projectId:'binari'}).then(x=>x.json())).status,'cached');
 const servedIcon=await fetch(origin+refreshed.project.iconUrl,{headers:{cookie}});
 assert.equal(servedIcon.headers.get('content-type'),'image/png');
 assert.deepEqual(Buffer.from(await servedIcon.arrayBuffer()),icon);
 assert.equal((await fetch(origin+refreshed.project.iconUrl)).status,401);
 assert.deepEqual(await (await get('/discover')).json(),{projects:['binari']});
 assert.deepEqual(calls,[['initialize'],['initialized'],['npc_project_folders_list',null],
  ['npc_folders_compare',''],['npc_folder_file_chunk',''],['npc_folder_file_chunk','']]);
 assert.deepEqual(readdirSync(join(folder,'data')),['project-catalog']);
 assert.deepEqual(readFileSync(join(root,'binari','project.json')),project);
 const postInner=(route,value)=>fetch(origin+'/api/folders/'+route,{method:'POST',headers:{cookie,origin,
  'Content-Type':'application/json','x-npcgen-csrf':session.csrfToken,
  'x-npcgen-frontend-context':session.contextId},body:JSON.stringify(value)});
 assert.equal((await postInner('compare',{scope:'unapproved/npcs'})).status,403);
 const optional='binari/npcs/character.test/assets/portraits';
 assert.deepEqual(await (await postInner('compare',{scope:optional})).json(),{scope:optional,groups:[],unavailable:[]});
 assert.deepEqual(await (await postInner('compare',{scope:optional})).json(),{scope:optional,groups:[],unavailable:[]});
 assert.equal(calls.filter(([name,scope])=>name==='npc_folders_compare'&&scope===optional).length,1);
 assert.equal((await postInner('compare',{scope:'binari/npcs/character.test/non-media'})).status,404);
 assert.equal((await postInner('compare',{scope:'binari/npcs/character.test/pose-views'})).status,503);

 assert.equal((await postInner('compare',{scope:'binari/npcs/.deleted-family'})).status,400);
 assert.deepEqual(await (await postInner('compare',{scope:'binari/npcs'})).json(),
  {scope:'binari/npcs',groups:[{folder:'',count:1}],unavailable:[]});
 assert.deepEqual(await (await postInner('refresh',{scope:'binari/npcs',folder:''})).json(),
  {scope:'binari/npcs',folder:'',status:'refreshed'});
 assert.equal(readFileSync(join(root,'binari','npcs','npc.txt'),'utf8'),'npc file');
 assert.equal((await fetch(origin+'/api/folders/file?scope=binari%2Fnpcs&path=npc.txt',{headers:{cookie}})).status,404);
});
