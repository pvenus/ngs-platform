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
import {admitPropRequest,propWorkspaceRead} from '../build/prop-workspace.mjs';
import {loopingPropPreview} from '../build/prop-workspace-ui.mjs';

const pin='1'.repeat(64),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const propId='paper-candle',p='props/'+propId;
const png=(w,h,animated=false)=>{
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(w);ihdr.writeUInt32BE(h,4);ihdr[8]=8;ihdr[9]=6;
 const chunk=(name,data)=>{
  const payload=Buffer.concat([Buffer.from(name),data]),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc32(payload));
  return Buffer.concat([head,payload,tail]);
 };
 const raw=Buffer.alloc(h*(w*4+1));raw[4]=255;
 const list=[Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',ihdr)];
 const fcTL=seq=>{
  const ctl=Buffer.alloc(26);ctl.writeUInt32BE(seq);ctl.writeUInt32BE(w,4);ctl.writeUInt32BE(h,8);
  ctl.writeUInt16BE(50,20);ctl.writeUInt16BE(1000,22);return chunk('fcTL',ctl);
 };
 if(animated)list.push(chunk('acTL',Buffer.from([0,0,0,2,0,0,0,1])),fcTL(0));
 list.push(chunk('IDAT',deflateSync(raw)));
 if(animated){
  raw[1]=255;
  list.push(fcTL(1),chunk('fdAT',Buffer.concat([Buffer.from([0,0,0,2]),deflateSync(raw)])));
 }
 list.push(chunk('IEND',Buffer.alloc(0)));return Buffer.concat(list);
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

test('only the inline APNG copy loops: checksum valid, original frame bytes and timing unchanged',async()=>{
 const input=png(40,40,true),before=Buffer.from(input);
 const preview=loopingPropPreview(input,2);
 assert.equal(preview.type,'image/apng');
 const output=Buffer.from(await preview.arrayBuffer()),at=33;
 assert.deepEqual(input,before);
 assert.deepEqual(output.subarray(0,at+12),input.subarray(0,at+12));
 assert.equal(input.readUInt32BE(at+12),1);
 assert.equal(output.readUInt32BE(at+12),0);
 assert.equal(output.readUInt32BE(at+16),crc32(output.subarray(at+4,at+16)));
 assert.deepEqual(output.subarray(at+20),input.subarray(at+20));
 for(const invalid of [input.subarray(0,at+19),png(40,40),Buffer.alloc(0)])
  assert.throws(()=>loopingPropPreview(invalid,2),/PROP_PREVIEW_INVALID/);
 assert.throws(()=>loopingPropPreview(input,3),/PROP_PREVIEW_INVALID/);
});

test('shared Prop DOM keeps tabs, independently loops and stops previews, and verifies batch requests',async t=>{
 const {mountPropWorkspace}=await import('../build/prop-workspace-ui.mjs');
 class Element{
  constructor(tag){
   this.tag=tag;this.tagName=tag.toUpperCase();this.children=[];this.attributes={};this.events={};this.dataset={};
   this.styles={};this.style={setProperty:(key,value)=>{this.styles[key]=value;}};
   this.classList={add:(...names)=>{this.className=[this.className,...names].filter(Boolean).join(' ');}};
  }
  append(...children){for(const child of children)child.parentElement=this;this.children.push(...children);}
  replaceChildren(...children){this.children=[];this.append(...children);}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(key,value){this.events[key]=value;}
  click(){if(!this.disabled)return this.events.click?.({});}
  focus(){this.focused=true;}
  showModal(){this.open=true;}
  close(){this.open=false;this.events.close?.({});}
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
  const stills=walk(basic.detail,x=>x.tag==='img');
  assert.equal(stills.length,2);
  const ratios=walk(basic.detail,x=>x.className==='prop-preview-pair')[0].styles;
  assert.deepEqual(ratios,{'--prop-detail-columns':stills[0].width+'fr','--prop-pixel-columns':stills[1].width+'fr'});
  assert.deepEqual(walk(basic.detail,x=>x.className==='prop-preview-dimensions').map(x=>x.textContent),
   stills.map(x=>x.width+' × '+x.height+' px'));
  assert.equal(walk(basic.detail,x=>x.attributes['aria-label']==='프랍 애니메이션 목록').length,0);
  assert.equal(walk(basic.detail,x=>x.textContent==='재생성 요청').length,1);
  const previewController=new AbortController(),nativeFetch=fetch,fetches=[];
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
   fetches.push({url,opts});return new Response(png(20,20,true));
  });
  const animated=await mount({propTab:'animation',propAnimation:second.id,signal:previewController.signal});
  const menu=walk(animated.detail,x=>x.attributes['aria-label']==='프랍 애니메이션 목록')[0];
  const [firstRow,secondRow]=menu.children;
  assert.deepEqual(menu.children.map(x=>[x.children[1].children[1].textContent,x.children[1].attributes['aria-current']??null]),
   [['initial',null],['flame-flicker','page']]);
  assert.match(secondRow.children[1].href,/propTab=animation&propAnimation=flame-flicker/);
  assert.equal(walk(animated.detail,x=>x.tag==='img').length,0);
  assert.equal(walk(animated.detail,x=>x.textContent==='재생성 요청'||x.textContent==='애니메이션 생성 요청').length,0);
  assert.equal(walk(animated.detail,x=>x.textContent==='선택 삭제 요청')[0].disabled,true);
  const play=walk(secondRow,x=>x.textContent==='픽셀 재생')[0];await play.click();
  assert.equal(walk(firstRow,x=>x.tag==='img').length,0);
  const [preview]=walk(secondRow,x=>x.tag==='img');
  assert.equal(preview.alt,'불꽃 떨림 픽셀');
  assert.match(preview.src,/^blob:/);
  assert.equal(Buffer.from(await (await nativeFetch(preview.src)).arrayBuffer()).readUInt32BE(45),0);
  assert.equal(fetches[0].url,second.media.pixel.url);
  assert.equal(fetches[0].opts.credentials,'same-origin');
  assert.equal(play.textContent,'픽셀 정지');
  const nonSelected=walk(firstRow,x=>x.textContent==='디테일 재생')[0];await nonSelected.click();
  const [detailPreview]=walk(firstRow,x=>x.tag==='img');
  assert.equal(fetches[1].url,first.media.detail.url);
  assert.equal(Buffer.from(await (await nativeFetch(detailPreview.src)).arrayBuffer()).readUInt32BE(45),0);
  await play.click();
  assert.equal(walk(secondRow,x=>x.tag==='img').length,0);
  assert.equal(play.textContent,'픽셀 재생');
  assert.equal(walk(firstRow,x=>x.tag==='img').length,1);
  await assert.rejects(nativeFetch(preview.src));
  previewController.abort();
  assert.equal(walk(firstRow,x=>x.tag==='img').length,0);
  await assert.rejects(nativeFetch(detailPreview.src));
  assert.equal(fetches.length,2);

  const controller=new AbortController();
  let allow=false,releasePending;
  const calls=[];
  const removable=await mount({propTab:'animation',signal:controller.signal,async removeAnimations(payload,options){
   calls.push({payload,options});
   if(!allow)return {accepted:false};
   return await new Promise(resolve=>{releasePending=resolve;});
  }},[first,second,{...first,id:'not-a-clip',media:{...first.media,pixel:{mediaType:'image/apng',url:'https://wrong.invalid/out'}}}]);
  const get=(tag,text)=>walk(removable.detail,x=>x.tag===tag&&x.textContent===text)[0];
  const select=get('button','전체 선택'),remove=get('button','선택 삭제 요청'),confirm=get('button','삭제 요청'),cancel=get('button','취소');
  const boxes=walk(removable.detail,x=>x.type==='checkbox');
  assert.deepEqual(boxes.map(x=>x.attributes['aria-label']),['점화 선택','불꽃 떨림 선택']);
  assert.equal(remove.disabled,true);
  select.click();assert.equal(select.textContent,'전체 선택 해제');
  assert.deepEqual(boxes.map(x=>x.checked),[true,true]);
  select.click();assert.deepEqual(boxes.map(x=>x.checked),[false,false]);
  boxes[1].checked=true;boxes[1].events.change();
  remove.click();assert.equal(walk(removable.detail,x=>x.tag==='dialog')[0].open,true);
  cancel.click();assert.equal(calls.length,0);
  remove.click();await confirm.click();
  assert.deepEqual(calls[0].payload,{propId,source,animationIds:[second.id]});
  assert.equal(calls[0].options.signal,controller.signal);
  assert.equal(boxes[1].checked,true);
  assert.match(walk(removable.detail,x=>x.className==='meta prop-request-status')[0].textContent,/확인하지 못했습니다/);
  allow=true;select.click();remove.click();const queued=confirm.click();await confirm.click();
  assert.equal(calls.length,2);assert.deepEqual(calls[1].payload.animationIds,[first.id,second.id]);
  for(const check of boxes)assert.equal(check.disabled,true);
  releasePending({accepted:true});await queued;
  const visible=walk(removable.detail,x=>x.tag==='ul'&&x.attributes['aria-label']==='프랍 애니메이션 목록')[0];
  assert.equal(visible.children.length,2);
  assert.deepEqual(boxes.map(x=>x.checked),[false,false]);
  assert.equal(walk(removable.detail,x=>x.textContent==='삭제 요청됨'&&x.hidden===false).length,2);
  assert.match(walk(removable.detail,x=>x.className==='meta prop-request-status')[0].textContent,/파일 동기화 후/);
  const allowed=await mount({propTab:'animation',actions:['generate','regenerate','animation']});
  assert.equal(walk(allowed.detail,x=>x.textContent==='애니메이션 생성 요청').length,1);
  assert.equal(walk(allowed.detail,x=>x.tag==='img').length,0);
  const empty=await mount({propTab:'animation',propAnimation:'not-published'},[]);
  assert.equal(walk(empty.detail,x=>x.textContent==='게시된 애니메이션이 없습니다.').length,1);
  assert.equal(walk(empty.detail,x=>x.tag==='img').length,0);
 }finally{
  if(own)Object.defineProperty(globalThis,'document',own);
  else delete globalThis.document;
 }
});

test('existing-prop animation capability does not authorize animated create/regenerate',async()=>{
 const actions=['generate','regenerate','animation'];
 for(const k of ['generate','regenerate']){
  const payload=propPayload(k,{propId,...(k==='regenerate'?{source}:{}),intent:'정적 소품 수정',designContextSha256:pin,motion:'subtle'});
  await assert.rejects(admitPropRequest({openProject:()=>assert.fail('no source read for unavailable motion'),
   actions,command:{requestType:propTypes[k],payload}}),{status:404});
 }
});
