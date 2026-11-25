import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {refreshAudioResults} from '../build/local-audio-workspace.mjs';
import {motionPresetConvertType} from '../build/motion-preset-convert-2d.mjs';
import {cinematicType} from '../build/cinematic-contract.mjs';

const source=readFileSync(new URL('../build/local-project-page.js',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace(/\nroute\(\);\s*$/,'\n');
const path='/api/space/project-catalog', requestId='space.catalog.11111111-2222-4333-8444-555555555555';
const project={projectId:'binari',name:'비나리',iconUrl:null,needsRefresh:false};
const session={state:'authenticated',backend:'space',readOnly:true};
const pending=()=>Response.json({requestId,status:'pending'},{status:202});
const ready=(projects=[project])=>Response.json({requestId,status:'ready',projects});
function dom(){
 const selectors=new Map(),events=new Map();
 return {children:[],attrs:{},dataset:{},textContent:'',hidden:false,className:'',classList:{remove(){},toggle(){}},
  append(...nodes){this.children.push(...nodes);},replaceChildren(...nodes){this.children=nodes;},
  insertBefore(node,existing){const i=this.children.indexOf(node);if(i!==-1)this.children.splice(i,1);
   const at=this.children.indexOf(existing);if(at===-1)this.children.push(node);else this.children.splice(at,0,node);},
  setAttribute(key,value){this.attrs[key]=value;},removeAttribute(key){delete this.attrs[key];},
  querySelector(key){if(!selectors.has(key))selectors.set(key,dom());return selectors.get(key);},
  addEventListener(name,handler){events.set(name,handler);},fire(name){events.get(name)?.();},remove(){},
 };
}
function browser(handler,search='',extra={},progressEnabled=false){
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,dom());return nodes.get(id);};
 const calls=[],events=new Map(),syncTimer=new Map();
 let sequence=0;
 const document={querySelector:id=>!progressEnabled&&id.endsWith('-sync-progress')?null:node(id),
  documentElement:{dataset:{audioWorkspace:'enabled'}},createElement:()=>dom(),createElementNS:()=>dom(),
  hidden:false,addEventListener(name,fn,opts){events.set(name,{fn,signal:opts?.signal});}};
 const context={document,location:{search},window:{addEventListener(){}},Intl,URLSearchParams,AbortController,AbortSignal,
  mountAudioWorkspace:()=>dom(),showAudioResults:()=>{},refreshAudioResults,cinematicType,motionPresetConvertType,motionConversionForm:()=>null,setInterval:()=>42,clearInterval(){},
  setTimeout:(fn,ms)=>{
   if(ms===2500){const id=++sequence;syncTimer.set(id,fn);return id;}
   return setTimeout(fn,ms===2000?ms:0);
  },clearTimeout:id=>{if(typeof id==='number')syncTimer.delete(id);else clearTimeout(id);},fetch:async(url,opts)=>{
   calls.push([url,opts.method??'GET',opts.body,opts.headers,opts]);
   return handler(url,opts,calls.length,node);
  },...extra};
 runInNewContext(source,context);
 return {context,calls,node,
  setHidden(value){document.hidden=value;const item=events.get('visibilitychange');if(!item?.signal?.aborted)item?.fn();},
  async nextProgress(){const next=syncTimer.values().next().value;assert.ok(next);await next();},
  pendingProgress:()=>syncTimer.size};
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

test('authenticated local queue displays pending rows on demand, then removes acknowledged rows without navigation',async()=>{
 let rows=[{projectId:'binari',requestType:'audio.generate',queuedAt:Date.UTC(2026,10,21)}];
 const app=browser(url=>url==='/__npcgen_session'?Response.json({state:'authenticated',contextId:'local',csrfToken:'owned'}):
  url==='/api/requests'?Response.json({requests:rows}):Response.json({projects:[]}));
 await app.context.load();
 const panel=app.node('#local-request-queue');
 assert.equal(panel.hidden,false);
 assert.equal(app.calls.some(([path])=>path==='/api/requests'),false);
 panel.open=true;panel.fire('toggle');
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(panel.querySelector('p').textContent,/등록 대기 1건/);
 assert.match(panel.querySelector('ul').children[0].textContent,/binari · BGM 생성/);
 rows=[];panel.fire('toggle');
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(panel.querySelector('p').textContent,/대기 중인 요청이 없습니다/);
 assert.deepEqual(panel.querySelector('ul').children,[]);
 panel.open=false;panel.fire('toggle');
});

const readyReplica={state:'authenticated',backend:'space',readOnly:false,queueEnabled:true,requestWritable:false,
 contextId:'space.'+'a'.repeat(64),csrfToken:'b'.repeat(64)};
test('Space replica reads its own project and BGM lists without legacy compare or apply',async()=>{
 const app=browser(url=>{
  if(url==='/__npcgen_session')return Response.json(readyReplica);
  if(url==='/api/project-folders')return Response.json({projects:[project]});
  if(url==='/api/audio-workspace?projectId=binari')return Response.json({results:[]});
  throw Error('unexpected '+url);
 });
 await app.context.load();
 assert.deepEqual(app.calls.map(([url,method])=>[url,method]),[
  ['/__npcgen_session','GET'],['/api/project-folders','GET'],
 ]);
 assert.equal(app.node('#projects').children[0].children[0].attrs.href,'/?projectId=binari&catalogArea=audio');
 await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=audio'));
 assert.deepEqual(app.calls.slice(2).map(([url,method])=>[url,method]),[
  ['/__npcgen_session','GET'],['/api/project-folders','GET'],['/api/audio-workspace?projectId=binari','GET'],
 ]);
 assert.equal(app.node('#workspace-status').textContent,'');
 await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=npcs'));
 assert.match(app.node('#workspace-status').textContent,/아직 Space에 연결되지 않았습니다/);
});

test('Space project queue capability enables its audio controls but not the local 60-second option',async()=>{
 for(const requestWritable of [false,true]){
  const app=browser(url=>{
   if(url==='/__npcgen_session')return Response.json({...readyReplica,workspaceReady:true,requestWritable});
   if(url==='/api/project-folders')return Response.json({projects:[project]});
   if(url==='/api/audio-workspace?projectId=binari')return Response.json({results:[]});
   throw Error('unexpected '+url);
  },'',{
   mountAudioWorkspace:settings=>{
    assert.equal(settings.allowFullLength,false);
    for(const method of ['submit','loadConcepts','onAccepted'])
     assert.equal(typeof settings[method],requestWritable?'function':'undefined');
    return dom();
   },
   showAudioResults:(_host,_rows,_signal,actions)=>{
    assert.equal(typeof actions?.submitDelete,requestWritable?'function':'undefined');
   },
  });
  await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=audio'));
  assert.equal(app.node('#workspace-status').textContent,'');
  assert.ok(app.calls.every(([,method])=>method==='GET'));
 }
});

test('Space initial empty replica retries only authorized reads and stops when the project card arrives',async()=>{
 const session={state:'authenticated',backend:'space',readOnly:false,queueEnabled:true,requestWritable:false,
  contextId:'space.'+'a'.repeat(64),csrfToken:'b'.repeat(64)};
 const app=browser((url,opts,n,node)=>{
  if(n===1)return Response.json(session);
  assert.equal(url,'/api/project-folders');
  assert.equal(opts.method,undefined);
  assert.equal(opts.body,undefined);
  if(n===2)return Response.json({projects:[]});
  assert.match(node('#status').textContent,/파일을 기다리는 중/);
  if(n===3)return new Response(null,{status:503});
  return Response.json({projects:[project]});
 });
 await app.context.load();
 assert.deepEqual(app.calls.map(([url,method])=>[url,method]),[
  ['/__npcgen_session','GET'],['/api/project-folders','GET'],['/api/project-folders','GET'],['/api/project-folders','GET'],
 ]);
 assert.equal(app.node('#projects').children[0].children[0].attrs.href,'/?projectId=binari&catalogArea=audio');
 assert.equal(app.node('#status').textContent,'');
});

test('Space initial empty refresh is bounded and immediately stops after authorization is revoked',async()=>{
 const session={state:'authenticated',backend:'space',readOnly:false,queueEnabled:true,requestWritable:false,
  contextId:'space.'+'a'.repeat(64),csrfToken:'b'.repeat(64)};
 const empty=()=>Response.json({projects:[]});
 const waiting=browser((url,opts,n)=>n===1?Response.json(session):empty());
 await waiting.context.load();
 assert.equal(waiting.calls.length,14); // session, initial read, at most 12 repeat reads.
 assert.match(waiting.node('#status').textContent,/아직 도착하지 않았습니다/);
 const revoked=browser((url,opts,n)=>n===1?Response.json(session):n===2?empty():new Response(null,{status:403}));
 await revoked.context.load();
 assert.equal(revoked.calls.length,3);
 assert.deepEqual(revoked.node('#projects').children,[]);
});

test('ready Space opens the same default project and shared NPC viewer without a browser sync call',async()=>{
 const calls=[];
 const scope='binari/npcs',config={...readyReplica,workspaceReady:true};
 const app=browser((url,opts)=>{
  assert.equal(opts.method,undefined);
  if(url==='/__npcgen_session')return Response.json(config);
  if(url==='/api/project-folders')return Response.json({projects:[project]});
  if(url==='/api/npc-workspace?projectId=binari')return Response.json({npcs:[{id:'npc.test',scope:scope+'/npc.test'}]});
  throw Error('unexpected '+url);
 },'',{loadNpcFolder:async settings=>{
  calls.push(settings);
  await settings.request('/api/npc-workspace?projectId=binari');
  const result=await settings.post('compare',{scope});
  assert.equal(result.groups.length,0);
  await assert.rejects(()=>settings.post('refresh',{scope,folder:''}),/SPACE_BROWSER_DOWNLOAD_FORBIDDEN/);
  settings.note('');
 }});
 await app.context.load();
 assert.equal(app.node('#projects').children[0].children[0].attrs.href,'/?projectId=binari');
 await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=npcs'));
 assert.equal(calls.length,1);assert.equal(calls[0].projectId,'binari');
 assert.equal(calls[0].submitOneStop,undefined);assert.equal(calls[0].submitPlanning,undefined);
 assert.deepEqual(app.calls.slice(2).map(([url,method])=>[url,method]),[
  ['/__npcgen_session','GET'],['/api/project-folders','GET'],['/api/npc-workspace?projectId=binari','GET'],
 ]);
 assert.equal(app.node('#workspace-status').textContent,'');
});

test('Space ready concept and 8-direction motion use the same shared project-detail views',async()=>{
 const reads=[],config={...readyReplica,workspaceReady:true};
 const clip='motion-presets/idle/assets/n/video.mp4';
 const app=browser((url,opts)=>{
  assert.equal(opts.method,undefined);reads.push(url);
  if(url==='/__npcgen_session')return Response.json(config);
  if(url==='/api/project-folders')return Response.json({projects:[project]});
  const q=new URL(url,'http://fixture').searchParams;
  if(q.get('tab')==='concept'){
   if(q.get('file'))return Response.json({markdown:'# 세계관'});
   const item={id:'world',label:'세계관',title:'세계관',scope:'binari/concept/sections/world'};
   return Response.json({items:[item],item,files:[{path:'concept/sections/world/content.md',kind:'markdown'}]});
  }
  if(q.get('tab')==='motion-presets'){
   const item={id:'idle',label:'아이들',scope:'binari/motion-presets/idle'};
   return Response.json({items:[item],item,motionPreset:{directions:[{direction:'n',path:clip}]}});
  }
  throw Error('unexpected '+url);
 },'',{conceptMarkdown:body=>({renderedMarkdown:body})});
 await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=concept&item=world'));
 assert.equal(app.node('#concept-category-tools').hidden,true);
 assert.equal(app.node('#workspace-detail').children[2].children[0].renderedMarkdown,'# 세계관');
 assert.ok(reads.some(url=>url.includes('tab=concept&item=world&file=')));
 await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=motion-presets&item=idle'));
 const compass=app.node('#workspace-detail').children[2];
 assert.equal(compass.children.length,9);
 assert.equal(compass.children.filter(node=>!!node.dataset.direction).length,8);
 assert.match(compass.children[1].children[1].children[0].src,/tab=motion-presets&item=idle&file=/);
 assert.ok(app.calls.every(([_,method])=>method==='GET'));
});

test('Space workspaceReady is not a write grant, but a verified project participant uses common intake',async()=>{
 for(const requestWritable of [false,true]){
  const config={...readyReplica,workspaceReady:true,requestWritable};
  const seen=[];
  const app=browser((url,opts)=>{
   assert.equal(opts.method,undefined);
   if(url==='/__npcgen_session')return Response.json(config);
   if(url==='/api/project-folders')return Response.json({projects:[project]});
   throw Error('unexpected '+url);
  },'',{loadNpcFolder:async settings=>seen.push([settings.submitOneStop,settings.submitPlanning])});
  await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=npcs'));
  assert.equal(typeof seen[0][0],requestWritable?'function':'undefined');
  assert.equal(seen[0][0],seen[0][1]);
 }
 const malformed={...readyReplica,workspaceReady:'true'};
 const refused=browser(()=>Response.json(malformed));
 await refused.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=npcs'));
 assert.deepEqual(refused.calls.map(([url])=>url),['/__npcgen_session']);
});

const progressPath='/api/ngs-sync-progress?projectId=binari';
const progressActive={state:'syncing',fileName:'abc.png',percent:67,completed:10,total:100,failed:0};
const progressIdle={state:'idle',fileName:null,percent:null,completed:0,total:0,failed:0};
const nextTurn=()=>new Promise(resolve=>setImmediate(resolve));
const projectAuth={state:'authenticated',contextId:'local',csrfToken:'owned'};
const activeSpaceProgress={...readyReplica,workspaceReady:true};

test('authenticated Local and Space render a file meter and distinct complete count from the same GET',async()=>{
 for(const session of [projectAuth,activeSpaceProgress]){
  let row=progressActive;
  const app=browser((url,opts)=>{
   if(url==='/__npcgen_session')return Response.json(session);
   if(url==='/api/project-folders')return Response.json({projects:[project]});
   if(url==='/api/project-workspace?projectId=binari&tab=motion-presets')return Response.json({items:[]});
   assert.equal(url,progressPath);
   assert.equal(opts.method,undefined);assert.equal(opts.credentials,'same-origin');assert.equal(opts.cache,'no-store');
   assert.equal(opts.redirect,'error');
   return Response.json(row);
  },'',{},true);
  await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=motion-presets'));
  await nextTurn();
  const slot=app.node('#workspace-sync-progress');
  assert.equal(slot.hidden,false);
  assert.deepEqual(slot.children[0].children[0].children.map(n=>n.textContent),['동기화 중','abc.png','67%','완료 10/100']);
  assert.equal(slot.children[0].children[1].value,67);
  row={...progressActive,state:'partial',fileName:null,percent:null,failed:90};
  await app.nextProgress();
  assert.deepEqual(slot.children[0].children[0].children.map(n=>n.textContent),['일부 파일 미완료','완료 10/100','실패 90']);
  assert.equal(slot.children[0].children.length,1);
  row=progressIdle;
  await app.nextProgress();
  assert.equal(slot.hidden,true);
  assert.equal(slot.children.length,0);
 }
});

test('authorized empty hosted catalog shows MCP progress without fabricating a project card',async()=>{
 const app=browser((url,opts)=>{
  assert.equal(opts.method,undefined);
  if(url==='/__npcgen_session')return Response.json(activeSpaceProgress);
  if(url==='/api/project-folders')return Response.json({projects:[]});
  if(url===progressPath)return Response.json(progressActive);
  throw Error('unexpected '+url);
 },'',{},true);
 await app.context.load();
 assert.equal(app.node('#projects').children.length,0);
 assert.equal(app.node('#home-sync-progress').hidden,false);
 assert.equal(app.node('#home-sync-progress').children[0].children[0].children[1].textContent,'abc.png');
});

test('visibility stops progress polling; errors clear stale rows and authorization revocation stops project polling',async()=>{
 let fail=null, row={...progressActive,fileName:'..\/internal/secret.png'};
 const app=browser(url=>{
  if(url==='/__npcgen_session')return Response.json(activeSpaceProgress);
  if(url==='/api/project-folders')return Response.json({projects:[project]});
  if(url.startsWith('/api/project-workspace?'))return Response.json({items:[]});
  assert.equal(url,progressPath);
  return fail?new Response(null,{status:fail}):Response.json(row);
 },'',{},true);
 await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=motion-presets'));
 await nextTurn();
 const slot=app.node('#workspace-sync-progress');
 assert.equal(slot.hidden,true);
 row=progressActive;await app.nextProgress();
 assert.equal(slot.hidden,false);
 app.setHidden(true);
 assert.equal(app.pendingProgress(),0);
 app.setHidden(false);await nextTurn();
 assert.equal(app.pendingProgress(),1);
 fail=503;
 await app.nextProgress();assert.equal(slot.hidden,false);
 await app.nextProgress();assert.equal(slot.hidden,true);
 fail=403;
 await app.nextProgress();assert.equal(app.pendingProgress(),0);assert.equal(slot.hidden,true);
});

test('a published 2D variant is labeled and keeps its directional preview without a conversion form',async()=>{
 const config={...readyReplica,workspaceReady:true,requestWritable:true};
 const id='walk-2d',path='motion-presets/assets/'+'a'.repeat(64)+'.mp4';
 const row={id,label:'걷기 2D'};
 const app=browser((url,opts)=>{
  assert.equal(opts.method,undefined);
  if(url==='/__npcgen_session')return Response.json(config);
  if(url==='/api/project-folders')return Response.json({projects:[project]});
  return Response.json({items:[row],item:row,motionPreset:{presetId:id,label:row.label,directions:[{direction:'n',path}],
   variant:{kind:'2d',sourcePresetId:'walk',sourcePresetHash:'b'.repeat(64)}}});
 },'',{motionConversionForm:()=>assert.fail('2D variants must not be offered as sources')});
 await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=motion-presets&item='+id));
 const [title,sub,marker,compass]=app.node('#workspace-detail').children;
 assert.equal(title.textContent,'걷기 2D');
 assert.match(marker.textContent,/2D 마네킹 변환 결과 .* 원본 프리셋: walk/);
 assert.equal(compass.children.length,9);
 assert.match(compass.children[1].children[1].children[0].src,/item=walk-2d&file=/);
});

test('Local and Space wire the same Basic NPC capability to shared UI, with no hosted bypass',async()=>{
 for(const hosted of [false,true])for(const available of [false,true]){
  const config={...(hosted?{...readyReplica,workspaceReady:true,requestWritable:true}:projectAuth),
   ...(available?{npcBasicPortraitEnabled:true}:{})};
  const seen=[];
  const app=browser(url=>{
   if(url==='/__npcgen_session')return Response.json(config);
   if(url==='/api/project-folders')return Response.json({projects:[project]});
   throw Error('unexpected '+url);
  },'',{loadNpcFolder:async settings=>seen.push(settings)});
  await app.context.loadWorkspace(new URLSearchParams('?projectId=binari&catalogArea=npcs'));
  assert.equal(seen.length,1);
  assert.equal(seen[0].basicPortraitRequests,available);
 }
});
