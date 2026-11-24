import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {crc32,deflateSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {createLocalProjectPageServer} from '../build/local-project-page-server.mjs';
import {canonicalPropPackage} from '../build/prop-package-contract.mjs';
import {propPayload,propTypes,validPropPayload} from '../build/prop-workspace-contract.mjs';
import {propWorkspaceRead} from '../build/prop-workspace.mjs';

const pin='1'.repeat(64),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const propId='paper-candle',p='props/'+propId;
const png=(w,h)=>{
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 const chunk=(name,data)=>{
  const payload=Buffer.concat([Buffer.from(name),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(payload));
  return Buffer.concat([head,payload,tail]);
 };
 const raw=Buffer.alloc(h*(w*4+1));raw[4]=255;
 return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
};
const bytes=png(40,40);
const still=(size,body=bytes)=>({assetId:digest(body)+'.png',sha256:digest(body),bytes:body.length,
 width:size,height:size,mediaType:'image/png',frameDurationsMs:[]});
const clip=(size,fill)=>({...still(size,Buffer.alloc(100,fill)),mediaType:'image/apng',frameDurationsMs:[50,50]});
const media={detail:still(40),pixel:still(20,png(20,20))};
const release={schemaVersion:'ngs.prop-package.v1',projectId:'binari',propId,revision:1,title:'한지 촛불',
 officialRequestId:'request.official.'+pin,requestSha256:pin,designContextSha256:pin,parentSha256:null,media,
 interaction:{pixelOpen:{action:'open',x:0,y:0,width:20,height:20},detailTrigger:null},
 animations:[{id:'initial',title:'점화',officialRequestId:'request.official.'+pin,requestSha256:pin,media:{detail:clip(40,1),pixel:clip(20,2)}}]};
const manifest=Buffer.from(canonicalPropPackage(release));
const source={revision:1,sha256:digest(manifest)};
const pointer={schemaVersion:'ngs.prop-pointer.v1',projectId:'binari',propId,title:release.title,...source};
const fixture=new Map([
 [p+'/metadata.json',Buffer.from(JSON.stringify(pointer))],
 [p+'/releases/1/manifest.json',manifest],
 [p+'/assets/'+media.detail.assetId,bytes],
 [p+'/assets/'+pin+'.png',Buffer.from('not advertised')],
]);
const animation=propPayload('animation',{propId,source,motionId:'flicker-light',prompt:'불꽃만 한 번 짧게 흔들림'});
test('roster only reads published folder pointers; selected manifest lazily pins sibling assets',async()=>{
 const seen=[],query=value=>new URLSearchParams(value);
 const project={listChildren:async dir=>(assert.equal(dir,'props'),[{name:propId,kind:'directory'},{name:'pending',kind:'directory'}]),
  readBytes:async path=>(seen.push(path),fixture.get(path)??null)};
 const read=q=>propWorkspaceRead({query:query(q),openProject:async()=>project,authorize:(id,resource)=>{
  assert.equal(id,'binari');assert.equal(resource,'props');
 }});
 assert.deepEqual((await read('projectId=binari')).json.props,[{propId,title:pointer.title,...source}]);
 assert.ok(seen.every(path=>path.endsWith('/metadata.json')));
 seen.length=0;
 const body=(await read({projectId:'binari',propId})).json.prop;
 assert.deepEqual(body.source,source);assert.deepEqual(body.animations.map(a=>a.id),['initial']);
 assert.equal(seen.some(path=>path.includes('/assets/')),false);
 const preview=new URL(body.media.detail.url,'https://fixture.example');
 assert.deepEqual((await read(preview.searchParams)).bytes,bytes);
 preview.searchParams.set('asset',pin);
 await assert.rejects(read(preview.searchParams),{status:404});
 preview.searchParams.set('sha256',pin);
 await assert.rejects(read(preview.searchParams),{status:409});
 await assert.rejects(read('projectId=binari&propId=../npcs'),{status:400});
});
test('exact no-preset named request, current pin, double submission protection delegated to existing queue',async t=>{
 const dir=mkdtempSync(join(realpathSync(tmpdir()),'prop-ui-fixture-'));
 const root=join(dir,'projects');mkdirSync(root,{mode:0o700});t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const make=(key,bytes)=>{
  const name=join(root,'binari',key);mkdirSync(dirname(name),{recursive:true,mode:0o700});writeFileSync(name,bytes,{mode:0o600});
 };
 for(const [key,raw] of fixture)make(key,raw);
 const sent=[];
 let enabled=true;
 const server=createLocalProjectPageServer({root,requestQueue:{enqueue(cmd){sent.push(cmd);return {status:'queued',queueId:'fixture'};}},
  readPropActions:async()=>enabled?['animation']:[]});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>new Promise(ok=>server.close(ok)));
 const origin='http://127.0.0.1:'+server.address().port,api='/api/prop-workspace?projectId=binari';
 const call=(path,opts)=>fetch(origin+path,opts);
 assert.equal((await call(api)).status,401);
 const auth=await call('/__npcgen_session'),session=await auth.json(),cookie=auth.headers.get('set-cookie').split(';')[0];
 assert.deepEqual(session.propActions,['animation']);
 const read=await call(api+'&propId='+propId,{headers:{cookie}});assert.equal(read.status,200);
 const post=(payload,type=propTypes.animation,csrf=session.csrfToken)=>call('/api/requests',{method:'POST',headers:{
  cookie,origin,'Content-Type':'application/json','X-NPCGen-Csrf':csrf,'X-NPCGen-Frontend-Context':session.contextId,
 },body:JSON.stringify({requestType:type,idempotencyKey:'isolated-fixture',payload})});
 assert.equal(validPropPayload(propTypes.animation,animation),true);
 assert.equal((await post({...animation,preset:'wrong'})).status,400);
 assert.equal((await post({...animation,source:{...source,revision:2}})).status,409);
 assert.equal((await post({...animation,motionId:'initial'})).status,409);
 assert.equal((await post(propPayload('generate',{propId:'new-prop',intent:'fixture',designContextSha256:pin}),propTypes.generate)).status,404);
 assert.equal((await post(animation,propTypes.animation,'invalid')).status,403);
 assert.equal((await post(animation,'prop.update')).status,404);
 assert.equal((await post(animation,'prop.image-generate')).status,404);
 assert.equal(sent.length,0);
 assert.equal((await post(animation)).status,202);
 assert.deepEqual(sent.map(r=>r.payload),[animation]);
 enabled=false;
 assert.equal((await post(animation)).status,404);
 assert.equal((await (await call('/__npcgen_session',{headers:{cookie}})).json()).propActions,undefined);
 assert.equal(sent.length,1);
});

test('regeneration binds the selected immutable source and full replacement intent, not edits or a scope picker',()=>{
 const payload=propPayload('regenerate',{propId,source,intent:'같은 용도에 새 외형과 작동 상태'});
 payload.designContextSha256=pin;
 assert.equal(validPropPayload(propTypes.regenerate,payload),true);
 assert.equal(validPropPayload(propTypes.regenerate,{...payload,motion:'subtle'}),true);
 assert.equal(validPropPayload(propTypes.regenerate,{...payload,scope:'appearance'}),false);
 assert.equal(validPropPayload('prop.update',payload),false);
 assert.equal(validPropPayload(propTypes.animation,{...animation,prompt:'embedding: opaque'}),false);
});

test('shared Prop DOM matches NPC cards and isolates animation folders and media by tab',async()=>{
 const {mountPropWorkspace}=await import('../build/prop-workspace-ui.mjs');
 class Element{
  constructor(tag){
   this.tag=tag;this.children=[];this.attributes={};this.events={};
   this.classList={add:(...names)=>{this.className=[this.className,...names].filter(Boolean).join(' ');}};
  }
  append(...children){for(const child of children)child.parentElement=this;this.children.push(...children);}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(key,value){this.events[key]=value;}
  click(){this.events.click?.({});}
 }
 const document={createElement:tag=>new Element(tag)};
 const own=Object.getOwnPropertyDescriptor(globalThis,'document');
 Object.defineProperty(globalThis,'document',{value:document,configurable:true});
 try{
  const body=await propWorkspaceRead({query:new URLSearchParams({projectId:'binari',propId}),authorize:()=>{},
   openProject:()=>({readBytes:async path=>fixture.get(path)??null})});
  const first=body.json.prop.animations[0],second={...first,id:'flame-flicker',title:'불꽃 떨림'};
  const walk=(el,keep)=>[...(keep(el)?[el]:[]),...el.children.flatMap(child=>walk(child,keep))];
  async function mount(props={},published=[first,second]){
   const pane=new Element('aside'),items=new Element('ul'),detail=new Element('article'),tools=new Element('span');
   pane.append(items);
   await mountPropWorkspace({items,detail,tools,item:propId,navigate:values=>'/?'+new URLSearchParams(
    {projectId:'binari',catalogArea:'props',...values}),submit:()=>assert.fail('visual navigation must not submit'),
    actions:['generate','regenerate'],
    request:async path=>new URL(path,'https://fixture').searchParams.has('propId')
     ?{prop:{...body.json.prop,animations:published}}:{props:[pointer]},...props});
   return {items,detail,tools};
  }
  const basic=await mount();
  const row=basic.items.children[0].children[0];
  assert.match(row.className,/request-item npc-roster-entry/);
  assert.equal(row.attributes['aria-current'],'page');
  assert.deepEqual(row.children.map(x=>[x.tag,x.textContent]),[['strong',pointer.title],['span',propId]]);
  assert.equal(basic.tools.children[0].attributes['aria-label'],'프랍 생성');
  assert.match(basic.tools.children[0].className,/npc-one-stop-trigger/);
  assert.deepEqual(walk(basic.detail,x=>x.attributes.role==='tab').map(x=>[x.textContent,x.attributes['aria-selected']]),
   [['기본 정보','true'],['애니메이션','false']]);
  assert.equal(walk(basic.detail,x=>x.tag==='img').length,2);
  assert.equal(walk(basic.detail,x=>x.attributes['aria-label']==='애니메이션 폴더').length,0);
  assert.equal(walk(basic.detail,x=>x.textContent==='재생성 요청').length,1);
  const animated=await mount({propTab:'animation',propAnimation:second.id});
  const menu=walk(animated.detail,x=>x.attributes['aria-label']==='애니메이션 폴더')[0];
  assert.deepEqual(menu.children.slice(1).map(x=>[x.children[1].textContent,x.attributes['aria-current']??null]),
   [['initial',null],['flame-flicker','page']]);
  assert.match(menu.children[2].href,/propTab=animation&propAnimation=flame-flicker/);
  assert.equal(walk(animated.detail,x=>x.tag==='img').length,0);
  assert.equal(walk(animated.detail,x=>x.textContent==='재생성 요청'||x.textContent==='애니메이션 생성 요청').length,0);
  walk(animated.detail,x=>x.textContent==='픽셀 재생')[0].click();
  const [preview]=walk(animated.detail,x=>x.tag==='img');
  assert.equal(preview.alt,'불꽃 떨림 픽셀');
  assert.equal(preview.src,second.media.pixel.url);
  const empty=await mount({propTab:'animation',propAnimation:'not-published'},[]);
  assert.equal(walk(empty.detail,x=>x.textContent==='게시된 애니메이션이 없습니다.').length,1);
  assert.equal(walk(empty.detail,x=>x.tag==='img').length,0);
 }finally{
  if(own)Object.defineProperty(globalThis,'document',own);
  else delete globalThis.document;
 }
});
