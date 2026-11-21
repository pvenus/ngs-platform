import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const source=readFileSync(new URL('../build/local-project-page.js',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace(/\nroute\(\);\s*$/,'\n');
const path='/api/space/project-catalog', requestId='space.catalog.11111111-2222-4333-8444-555555555555';
const project={projectId:'binari',name:'비나리',iconUrl:null,needsRefresh:false};
const session={state:'authenticated',backend:'space',readOnly:true};
const pending=()=>Response.json({requestId,status:'pending'},{status:202});
const ready=(projects=[project])=>Response.json({requestId,status:'ready',projects});
function dom(){
 return {children:[],attrs:{},textContent:'',hidden:false,className:'',classList:{remove(){},toggle(){}},
  append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
  insertBefore(node,existing){const i=this.children.indexOf(node);if(i!==-1)this.children.splice(i,1);
   const at=this.children.indexOf(existing);if(at===-1)this.children.push(node);else this.children.splice(at,0,node);},
  setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},
  addEventListener(){},remove(){},
 };
}
function browser(handler,search=''){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,dom());return nodes.get(id);};
 const calls=[];
 const context={document:{querySelector:node,documentElement:{dataset:{audioWorkspace:'enabled'}},createElement:()=>dom(),
  createElementNS:()=>dom()},location:{search},window:{addEventListener(){}},Intl,URLSearchParams,AbortController,AbortSignal,
  setTimeout:fn=>setTimeout(fn,0),clearTimeout,fetch:async(url,opts)=>{
   calls.push([url,opts.method??'GET',opts.body,opts.headers]);
   return handler(url,opts,calls.length,node);
  }};
 runInNewContext(source,context);
 return {context,calls,node};
}
test('native hosted session polls one exact ticket and renders only live project rows',async()=>{
 const app=browser((url,opts,n,node)=>{
  if(n===1)return Response.json(session);
  if(n===2)return pending();
  assert.match(node('#status').textContent,/원본 목록을 기다리고/);
  return ready();
 });
 await app.context.load();
 assert.deepEqual(app.calls.map(([url,method,body])=>[url,method,body]),[
  ['/__npcgen_session','GET',undefined],[path,'POST','{}'],[path+'?requestId='+requestId,'GET',undefined],
 ]);
 assert.equal(app.calls[1][3]['Content-Type'],'application/json');
 assert.equal(Object.keys(app.calls[1][3]).length,1);
 const [card]=app.node('#projects').children;
 assert.equal(card.children[0].children[1].textContent,'비나리');
 assert.equal(card.children[0].attrs.href,'/?projectId=binari');
 assert.equal(app.node('#status').textContent,'');
});
test('explicit empty, expired, unavailable and altered ticket never fabricate a local project',async()=>{
 for(const [reply,message] of [
  [()=>ready([]),/확인된 프로젝트가 없습니다/],
  [()=>new Response(null,{status:404}),/응답이 아직 없습니다/],
  [()=>new Response(null,{status:503}),/연결하지 못했습니다/],
  [()=>Response.json({requestId:requestId.replace(/^space\.catalog\.1/,'space.catalog.2'),status:'ready',projects:[project]}),/연결하지 못했습니다/],
  [()=>ready([{...project,iconUrl:'/api/project-folders/icon'}]),/연결하지 못했습니다/],
 ]){
  const app=browser((url,opts,n)=>n===1?Response.json(session):n===2?pending():reply());
  await app.context.load();
  assert.match(app.node('#status').textContent,message);
  assert.deepEqual(app.node('#projects').children,[]);
 }
});
test('local boot remains unchanged and hosted deep links stop before unavailable detail APIs',async()=>{
 const local=browser((url,_opts,n)=>n===1?Response.json({state:'authenticated',contextId:'local',csrfToken:'owned'}):
  Response.json({projects:[]}));
 await local.context.load();
 assert.deepEqual(local.calls.map(([url,method])=>[url,method]),[
  ['/__npcgen_session','GET'],['/api/project-folders','GET'],['/api/project-folders/discover','GET'],
 ]);
 const space=browser(()=>Response.json(session),'?projectId=binari');
 await space.context.loadWorkspace(new URLSearchParams('?projectId=binari'));
 assert.deepEqual(space.calls.map(([url,method])=>[url,method]),[['/__npcgen_session','GET']]);
 assert.match(space.node('#workspace-status').textContent,/프로젝트 목록만 연결/);
});
