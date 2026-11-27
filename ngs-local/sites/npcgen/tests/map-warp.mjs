import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapWarp,orderedMapChain,entryFraction} from '../build/map-warp.mjs';

const regions=Array.from({length:5},(_,i)=>({id:'r'+(i+1),name:'구역 '+(i+1),description:'테스트 구역',backgroundId:'background.'+String(i+1).repeat(64),imageSha256:String(i+1).repeat(64)}));
const chain=orderedMapChain(regions);
const graph={title:'굿터',regions,startRegionId:'r1',connections:chain.map((e,i)=>({...e,
 hit:{x:800,y:220,width:8,height:40},spawn:{x:250+i,y:240}}))};
test('ordered map placement builds only the explicit edges with no assumed coordinates',()=>{
 assert.deepEqual(chain.map(({from,to})=>[from,to]),[['r1','r2'],['r2','r3'],['r3','r4'],['r4','r5']]);
 assert.ok(chain.every(e=>e.hit===null&&e.spawn===null));
 assert.throws(()=>createMapWarp({...graph,connections:chain}),/MAP_WARP_GRAPH_INVALID/);
});
test('movement crosses each narrow portal in sequence and lands on each saved coordinate',()=>{
 const p=createMapWarp(graph,{start:{x:500,y:240}});
 for(let i=0;i<4;i++){
  const state=p.move(950,240);
  assert.deepEqual(state,{regionId:'r'+(i+2),position:{x:250+i,y:240},warp:{id:'order-'+(i+1),from:'r'+(i+1),to:'r'+(i+2)}});
 }
 assert.equal(p.move(950,240).warp,null);
 assert.equal(p.snapshot().regionId,'r5');
});
test('an overlapping destination portal only re-arms after leaving, never during a warp',()=>{
 const modified=structuredClone(graph);
 modified.connections[0].spawn={x:805,y:240};
 const p=createMapWarp(modified,{start:{x:500,y:240}});
 assert.equal(p.move(960,240).regionId,'r2');
 assert.equal(p.move(806,240).warp,null);
 assert.equal(p.move(700,240).warp,null);
 assert.equal(p.move(950,240).regionId,'r3');
});
test('the default warp initialization uses a published start footpoint when present',()=>{
 assert.deepEqual(createMapWarp({...graph,startPoint:{x:700,y:420}}).snapshot(),{regionId:'r1',position:{x:700,y:420}});
});
test('a normal move outside the portal does not warp',()=>{
 const p=createMapWarp(graph,{start:{x:500,y:300}});
 assert.equal(p.move(960,300).warp,null);
 assert.equal(entryFraction({x:500,y:240},{x:800,y:240},graph.connections[0].hit),1);
});

function fakeDom(t){
 class Element extends EventTarget{
  constructor(tag){super();this.tag=tag;this.children=[];this.attrs={};this.style={};this.dataset={};}
  append(...children){for(const child of children){child.remove();child.parent=this;this.children.push(child);}}
  replaceChildren(...children){for(const x of this.children)x.parent=null;this.children=[];this.append(...children);}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(x=>x!==this);this.parent=null;}}
  setAttribute(k,v){this.attrs[k]=v;}
  getAttribute(k){return this.attrs[k];}
  hasAttribute(k){return Object.hasOwn(this.attrs,k);}
  removeAttribute(k){delete this.attrs[k];}
  get parentNode(){return this.parent;}
  contains(n){return n===this||this.descendants().includes(n);}
  querySelectorAll(){return this.descendants().filter(n=>n.attrs['aria-label']);}
  setPointerCapture(){}
  showModal(){this.open=true;}
  close(){if(this.open){this.open=false;this.dispatchEvent(new Event('close'));}}
  descendants(){return this.children.flatMap(x=>[x,...x.descendants()]);}
  querySelector(selector='input'){return this.descendants().find(x=>x.tag===selector.split(':')[0]&&!x.disabled);}
  focus(){focused=this;}
  getBoundingClientRect(){return {left:0,top:0,width:1000,height:1000};}
 }
 let focused;const body=new Element('body'),original=globalThis.document;
 Object.defineProperty(globalThis,'document',{configurable:true,value:{body,createElement:tag=>new Element(tag),get activeElement(){return focused;}}});
 t.after(()=>{if(original===undefined)delete globalThis.document;else globalThis.document=original;});
 return {Element,body,get focused(){return focused;}};
}

test('New Map uses one modal, retains a closed draft, and never submits from opening or closing',async t=>{
 const {mountMapWorkspace,mapDraftKey}=await import('../build/map-workspace-ui.mjs');
 const dom=fakeDom(t),{Element,body}=dom;
 let requests=0;
 const items=new Element('div'),detail=new Element('div'),tools=new Element('div'),draft=new Map(),signal=new AbortController();
 const data={getItem:k=>draft.get(k),setItem:(k,v)=>draft.set(k,v)};
 await mountMapWorkspace({items,detail,tools,projectId:'binari',enabled:true,navigate:()=>'/map',signal:signal.signal,storage:data,
  request:async url=>url.includes('background')?{backgrounds:[]}:{maps:[]},submit:async()=>{requests++;}});
 const root=[...detail.children],opener=tools.children[0];
 assert.equal(opener.attrs['aria-label'],'새 맵');
 assert.equal(body.children.length,0);
 opener.onclick();opener.onclick();
 assert.equal(body.children.length,1);let modal=body.children[0];
 assert.equal(modal.open,true);assert.equal(modal.children[0].textContent,'새 맵 생성 요청');
 const name=modal.querySelector();assert.equal(dom.focused,name);name.value='세션 초안';name.oninput();
 assert.equal(JSON.parse(draft.get(mapDraftKey('binari'))).graph.title,'세션 초안');
 modal.descendants().find(x=>x.tag==='button'&&x.textContent==='닫기').onclick();
 assert.equal(body.children.length,0);assert.equal(dom.focused,opener);
 assert.deepEqual(detail.children,root);
 opener.onclick();modal=body.children[0];
 assert.equal(modal.querySelector().value,'세션 초안');
 assert.equal(modal.dispatchEvent(new Event('cancel',{cancelable:true})),true);
 modal.close();opener.onclick();signal.abort();
 assert.equal(body.children.length,0);assert.equal(requests,0);
});


test('Warp preview reaches the last room, starts over twice, then closes and cleans input',async t=>{
 const {mountMapWorkspace}=await import('../build/map-workspace-ui.mjs');
 const dom=fakeDom(t),{Element}=dom;
 let serial=0,time=0;const frames=new Map();
 const old=[globalThis.requestAnimationFrame,globalThis.cancelAnimationFrame];
 globalThis.requestAnimationFrame=fn=>{frames.set(++serial,fn);return serial;};
 globalThis.cancelAnimationFrame=id=>frames.delete(id);
 t.after(()=>{for(const [i,k] of ['requestAnimationFrame','cancelAnimationFrame'].entries()){
  if(old[i])globalThis[k]=old[i];else delete globalThis[k];
 }});
 const tick=()=>{const batch=[...frames.values()];frames.clear();for(const fn of batch)fn(time+=50);};
 const mapId='request.official.'+'a'.repeat(64);
 const twoRoom={...graph,regions:regions.slice(0,2),connections:[{...graph.connections[0],hit:{x:525,y:830,width:10,height:40}}],
  colliders:[{id:'left-wall',regionId:'r1',rect:{x:510,y:820,width:50,height:80},shape:'ellipse',rotation:45},
   {id:'right-wall',regionId:'r2',rect:{x:111,y:320,width:90,height:130}}]};
 const state={schemaVersion:'ngs.map-metadata.v1',projectId:'binari',mapId,revision:1,updatedAt:1,officialRequestId:mapId,graph:twoRoom};
 const backgrounds=twoRoom.regions.map(r=>({backgroundId:r.backgroundId,sha256:r.imageSha256,title:r.name,width:1000,height:1000}));
 const signal=new AbortController(),detail=new Element('div'),items=new Element('div'),tools=new Element('div');
 await mountMapWorkspace({items,detail,tools,projectId:'binari',item:mapId,enabled:true,navigate:()=>'/map',signal:signal.signal,
  storage:{getItem(){return null;},setItem(){assert.fail('playback must not write a map draft');}},
  request:async path=>path.includes('background')?{backgrounds}:path.includes('item=')?{map:state}:{maps:[]},
  submit:async()=>assert.fail('playback must not submit')});
 const find=text=>detail.descendants().find(n=>n.textContent===text),canvas=()=>detail.descendants().find(n=>n.className==='map-canvas');
 const start=()=>{assert.equal(find('워프 플레이').disabled,false);find('워프 플레이').onclick();};
 const dispatch=(node,type,fields)=>{const e=new Event(type,{cancelable:true});Object.assign(e,fields);node.dispatchEvent(e);return e;};
 const reachLast=how=>{
  assert.ok(find('1 / 2 · 구역 1'));assert.equal(frames.size,0);
  const oldCanvas=canvas();assert.equal(dom.focused,oldCanvas);
  const overlays=box=>box.descendants().filter(n=>n.className?.includes('map-play-collider'));
  assert.equal(overlays(oldCanvas).length,1);
  assert.equal(overlays(oldCanvas)[0].style.transform,'rotate(45deg)');
  assert.equal(overlays(oldCanvas)[0].style.borderRadius,'50%');
  if(how==='keyboard')assert.ok(dispatch(oldCanvas,'keydown',{key:'ㅇ',code:'KeyD'}).defaultPrevented);
  else dispatch(oldCanvas,'pointerdown',{button:0,clientX:700,clientY:850});
  for(let i=0;i<5&&!find('2 / 2 · 구역 2');i++)tick();
  assert.ok(find('2 / 2 · 구역 2'));
  if(how==='keyboard')dispatch(oldCanvas,'keyup',{key:'ㅇ',code:'KeyD'});
  assert.equal(frames.size,0);
  assert.equal(canvas(),oldCanvas,'warp keeps the focused shared scene');
  assert.equal(overlays(canvas()).length,1);
  assert.equal(overlays(canvas())[0].style.transform,'rotate(0deg)');
  assert.equal(dom.focused,oldCanvas);
  const at=find('발 위치: 250, 240');assert.ok(at);
  dispatch(oldCanvas,'keydown',{key:'ArrowDown',code:'ArrowDown'});tick();tick();
  assert.notEqual(at.textContent,'발 위치: 250, 240','actor still moves in a dead-end room');
  dispatch(oldCanvas,'keyup',{key:'ArrowDown',code:'ArrowDown'});
 };
 start();reachLast('keyboard');find('처음부터 다시').onclick();reachLast('pointer');
 find('플레이 닫기').onclick();assert.equal(frames.size,0);assert.equal(dom.focused,find('워프 플레이'));
 start();const liveCanvas=canvas();dispatch(liveCanvas,'keydown',{key:'d',code:'KeyD'});assert.equal(frames.size,1);
 const playView=detail.descendants().find(n=>n.className==='map-play-layout');
 playView.onkeydown({key:'Escape',preventDefault(){}});
 assert.equal(frames.size,0);assert.equal(dispatch(liveCanvas,'keydown',{key:'d',code:'KeyD'}).defaultPrevented,false);
 start();signal.abort();assert.equal(frames.size,0);
});

test('published map edits keep a separate start image and show both ends of each connection at once',async t=>{
 const {mountMapWorkspace,mapDraftKey,centerMapPortal}=await import('../build/map-workspace-ui.mjs');
 const dom=fakeDom(t),{Element}=dom,detail=new Element('div'),items=new Element('div'),tools=new Element('div');
 const mapId='request.official.'+'c'.repeat(64),state={schemaVersion:'ngs.map-metadata.v1',projectId:'binari',
  mapId,revision:1,updatedAt:1,officialRequestId:mapId,graph};
 const backgrounds=regions.map(r=>({backgroundId:r.backgroundId,sha256:r.imageSha256,title:r.name,width:1000,height:1000}));
 const draft=new Map();
 const store={getItem:k=>draft.get(k),setItem:(k,v)=>draft.set(k,v)};
 await mountMapWorkspace({items,detail,tools,projectId:'binari',item:mapId,enabled:true,navigate:()=>'/map',storage:store,
  request:async path=>path.includes('background')?{backgrounds}:path.includes('item=')?{map:state}:{maps:[]},
  submit:async()=>assert.fail('editing start or coordinates may only update the session draft')});
 const pick=cls=>detail.descendants().find(n=>n.className===cls);
 const startImages=()=>pick('map-start-thumbnail')?.descendants().filter(n=>n.tag==='img')??[];
 const endpoints=()=>pick('map-connection-pair').descendants().filter(n=>n.tag==='img');
 const parts=()=>pick('map-connection-pair').descendants();
 const pickers=()=>parts().filter(n=>n.className==='map-coordinate-picker');
 const drag=(node,x1,y1,x2,y2,mid)=>{
  const ev=(x,y)=>({button:0,pointerId:1,clientX:x,clientY:y,preventDefault(){}});
  node.onpointerdown(ev(x1,y1));node.onpointermove(ev(x2,y2));mid?.();node.onpointerup(ev(x2,y2));
 };
 const field=text=>detail.descendants().find(n=>n.tag==='label'&&n.textContent===text).children[0];
 const current=()=>JSON.parse(draft.get(mapDraftKey('binari',mapId))).graph;
 const tab=key=>detail.descendants().find(n=>n.id==='map-tab-'+key);
 assert.equal(tab('start').attrs['aria-selected'],'true');
 assert.deepEqual(startImages().map(n=>n.alt),['구역 1']);
 assert.equal(pick('map-connection-pair'),undefined);
 assert.ok(!detail.descendants().some(n=>n.tag==='label'&&n.textContent==='맵 이름'));
 const start=field('워프 플레이를 시작할 구역');start.value='r4';start.onchange();
 assert.deepEqual(startImages().map(n=>n.alt),['구역 4']);
 tab('links').onclick();
 assert.equal(tab('links').attrs['aria-selected'],'true');
 assert.equal(dom.focused,tab('links'));
 assert.ok(!detail.descendants().some(n=>n.attrs['aria-label']==='시작 맵'&&n.tag==='section'));
 assert.equal(current().startRegionId,'r4');assert.deepEqual(endpoints().map(n=>n.alt),['구역 1','구역 2']);
 const select=field('편집할 이동 연결');select.value='order-2';select.onchange();
 assert.deepEqual(endpoints().map(n=>n.alt),['구역 2','구역 3']);
 assert.equal(pickers().length,0,'existing geometry must not be reset by clicking the background');
 const moving=label=>parts().find(n=>n.attrs['aria-label']?.startsWith(label));
 drag(moving('출입구 이동'),804,240,404,450,()=>assert.equal(current().connections[1].hit.x,800));
 drag(moving('도착점 이동'),251,240,520,700);
 assert.deepEqual(current().connections[1].hit,{x:400,y:430,width:8,height:40});
 assert.deepEqual(current().connections[1].spawn,{x:520,y:700});
 drag(moving('오른쪽 아래 모서리'),408,470,460,510);
 assert.deepEqual(current().connections[1].hit,{x:400,y:430,width:60,height:80});
 moving('왼쪽 위 모서리').onkeydown({key:'ArrowLeft',shiftKey:true,preventDefault(){}});
 assert.deepEqual(current().connections[1].hit,{x:390,y:430,width:70,height:80});
 const width=field('너비');width.valueAsNumber=55;width.onchange();
 assert.equal(current().connections[1].hit.width,55);
 assert.deepEqual(current().connections[0],graph.connections[0]);assert.equal(current().startRegionId,'r4');
 const add=detail.descendants().find(n=>n.textContent==='이동 연결 추가');add.onclick();
 assert.equal(pickers().length,2);
 assert.match(pickers()[0].attrs['aria-label'],/출입구/);assert.match(pickers()[1].attrs['aria-label'],/도착점/);
 pickers()[0].onclick({detail:1,clientX:820,clientY:650});
 pickers()[0].onclick({detail:1,clientX:90,clientY:100});
 assert.equal(pickers().length,0);const edge=current().connections.at(-1);
 assert.deepEqual(edge.hit,{x:770,y:610,width:100,height:80});assert.deepEqual(edge.spawn,{x:90,y:100});
 assert.deepEqual(centerMapPortal({x:999,y:3}),{x:900,y:0,width:100,height:80});
});

test('colliders draw, move, resize and delete by region and only Apply queues the exact edited map',async t=>{
 const {mountMapWorkspace,mapDraftKey}=await import('../build/map-workspace-ui.mjs');
 const {validMapRequest}=await import('../build/map-contract.mjs');
 const {Element}=fakeDom(t),detail=new Element('div'),items=new Element('div'),tools=new Element('div');
 const mapId='request.official.'+'d'.repeat(64),state={schemaVersion:'ngs.map-metadata.v1',projectId:'binari',
  mapId,revision:1,updatedAt:1,officialRequestId:mapId,graph};
 const backgrounds=regions.map(r=>({backgroundId:r.backgroundId,sha256:r.imageSha256,title:r.name,width:1000,height:1000}));
 const saved=new Map(),requests=[];
 await mountMapWorkspace({items,detail,tools,projectId:'binari',item:mapId,enabled:true,navigate:()=>'/map',
  storage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
  request:async path=>path.includes('background')?{backgrounds}:path.includes('item=')?{map:state}:{maps:[]},
  submit:async packet=>{requests.push(packet);return Response.json({status:'queued',queueId:'ngs.local.15d60410-3f24-480d-9072-cd51f3d2a006'},{status:202});}});
 const currentTab=key=>detail.descendants().find(n=>n.id==='map-tab-'+key);
 const startField=detail.descendants().find(n=>n.tag==='label'&&n.textContent==='워프 플레이를 시작할 구역').children[0];
 startField.value='r3';startField.onchange();
 currentTab('links').onclick();
 const edgeName=detail.descendants().find(n=>n.tag==='label'&&n.textContent==='이동 이름').children[0];
 edgeName.value='게시하지 않을 연결 초안';edgeName.oninput();
 currentTab('colliders').onclick();
 const card=()=>detail.descendants().find(n=>n.attrs['aria-label']==='충돌 영역'&&n.tag==='section');
 const find=text=>card().descendants().find(n=>n.textContent===text);
 const field=label=>card().descendants().find(n=>n.tag==='label'&&n.textContent===label).children[0];
 const gesture=(node,x1,y1,x2,y2,mid)=>{
  const e=(x,y)=>({button:0,pointerId:8,clientX:x,clientY:y,preventDefault(){}});
  node.onpointerdown(e(x1,y1));node.onpointermove(e(x2,y2));mid?.();node.onpointerup(e(x2,y2));
 };
 const local=()=>JSON.parse(saved.get(mapDraftKey('binari',mapId))??'null')?.graph;
 const startDraw=()=>{find('새 충돌 영역 그리기').onclick();return card().descendants().find(n=>n.className==='map-collider-draw');};
 assert.deepEqual(card().descendants().filter(n=>n.tag==='img').map(n=>n.alt),['구역 1']);
 gesture(startDraw(),800,600,650,350,()=>assert.equal(local().colliders,undefined));
 const first=local().colliders[0];assert.equal(first.regionId,'r1');assert.equal(first.shape,'rect');assert.deepEqual(first.rect,{x:650,y:350,width:150,height:250});
 const control=label=>card().descendants().find(n=>n.attrs['aria-label']?.startsWith(label));
 gesture(control('충돌 영역 이동'),650,350,670,370);
 assert.deepEqual(local().colliders[0].rect,{x:670,y:370,width:150,height:250});
 gesture(control('오른쪽 아래 모서리'),820,620,880,700);
 assert.deepEqual(local().colliders[0].rect,{x:670,y:370,width:210,height:330});
 const room=field('충돌을 편집할 구역');room.value='r2';room.onchange();
 assert.equal(control('충돌 영역 이동'),undefined);
 assert.deepEqual(card().descendants().filter(n=>n.tag==='img').map(n=>n.alt),['구역 2']);
 const shape=field('새 영역 모양');shape.value='ellipse';shape.onchange();
 find('좌표로 충돌 영역 추가').onclick();
 assert.equal(local().colliders[1].shape,'ellipse');
 assert.equal(card().descendants().find(n=>n.className?.includes('map-collider-marker')).style.borderRadius,'50%');
 const width=field('너비');width.valueAsNumber=140;width.onchange();
 const height=field('높이');height.valueAsNumber=70;height.onchange();
 const angle=field('회전 (°)');angle.valueAsNumber=45;angle.onchange();
 const rotated=local().colliders[1];
 assert.deepEqual([rotated.rect.width,rotated.rect.height,rotated.rotation],[140,70,45]);
 assert.equal(card().descendants().find(n=>n.className?.includes('map-collider-marker')).style.transform,'rotate(45deg)');
 find('선택한 충돌 영역 삭제').onclick();
 assert.deepEqual(local().colliders.map(c=>c.id),[first.id]);assert.equal(requests.length,0);
 gesture(startDraw(),400,400,600,500);
 assert.equal(local().colliders[1].shape,'ellipse');
 const turn=field('회전 (°)');turn.valueAsNumber=90;turn.onchange();
 await detail.descendants().find(n=>n.textContent==='충돌 영역 적용').onclick();
 assert.equal(requests.length,1);const {payload,requestType}=requests[0];
 assert.equal(requestType,'map.update');assert.ok(validMapRequest(payload,requestType));
 assert.equal(payload.expectedRevision,1);assert.deepEqual(payload.graph.colliders,local().colliders);
 assert.deepEqual(payload.graph.connections,graph.connections);
 assert.equal(payload.graph.startRegionId,graph.startRegionId);
 assert.equal(local().startRegionId,'r3');assert.equal(local().connections[0].label,'게시하지 않을 연결 초안');
 const {chooseMapDraft,projectMapTab}=await import('../build/map-workspace-ui.mjs');
 const packed=JSON.parse(saved.get(mapDraftKey('binari',mapId)));
 const next={...state,revision:2,officialRequestId:packed.submission.id,graph:payload.graph};
 const rebased=chooseMapDraft(packed,next);
 assert.equal(rebased.conflict,false);assert.equal(rebased.done,true);
 assert.deepEqual(rebased.graph.colliders,payload.graph.colliders);
 assert.equal(rebased.graph.startRegionId,'r3');
 assert.equal(rebased.graph.connections[0].label,'게시하지 않을 연결 초안');
 assert.equal(projectMapTab(next.graph,rebased.graph,'links').startRegionId,'r1');
 assert.equal(projectMapTab(next.graph,rebased.graph,'start').connections[0].label,graph.connections[0].label);
 assert.equal(chooseMapDraft(packed,{...next,officialRequestId:'request.official.'+'8'.repeat(64),graph:{...graph,startRegionId:'r5'}}).conflict,true);
});

test('new map form requires explicit start and collision policy and sends grouped notes',async t=>{
 const {mountMapWorkspace}=await import('../build/map-workspace-ui.mjs');
 const {validMapRequest}=await import('../build/map-contract.mjs');
 const {Element,body}=fakeDom(t),items=new Element('ul'),detail=new Element('div'),tools=new Element('div');
 const backgrounds=regions.slice(0,2).map(r=>({backgroundId:r.backgroundId,sha256:r.imageSha256,title:r.name,width:1000,height:1000}));
 const posts=[],saved=new Map(),signal=new AbortController();
 t.after(()=>signal.abort());
 await mountMapWorkspace({items,detail,tools,projectId:'binari',enabled:true,navigate:()=>'/map',signal:signal.signal,storage:{
  getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},
  request:async path=>path.includes('background')?{backgrounds}:{maps:[]},
  submit:async packet=>{posts.push(packet);return Response.json({status:'queued',queueId:'ngs.local.15d60410-3f24-480d-9072-cd51f3d2a006'},{status:202});}});
 tools.children[0].onclick();
 const find=label=>body.descendants().find(n=>n.textContent===label);
 const field=label=>find(label).children[0];
 const change=(label,value,event='onchange')=>{const input=field(label);input.value=value;input[event]();};
 const send=()=>find('요청 보내기').onclick();
 change('맵 이름','새 굿터','oninput');
 for(const b of backgrounds){change('완성된 배경',b.backgroundId);find('선택 배경으로 구역 추가').onclick();}
 find('배치 순서대로 단방향 연결').onclick();
 change('맵 그룹 제작 의도 (필수)','선택한 배경과 동선 유지','oninput');
 await send();assert.equal(posts.length,0);
 change('시작 구역 (필수)',field('시작 구역 (필수)').children[1].value);
 await send();assert.equal(posts.length,0);
 change('충돌 방식 (필수)','suggest');
 change('시작 맵 요청 사항 (선택)','문턱 안쪽','oninput');
 change('포털 요청 사항 (선택)','통로의 가운데','oninput');
 change('충돌 영역 요청 사항 (선택)','돌담만','oninput');
 await send();
 assert.equal(posts.length,1);
 const {payload,requestType}=posts[0];
 assert.equal(requestType,'map.generate');assert.equal(payload.schemaVersion,'ngs.map-generate.v2');
 assert.equal(payload.graph.startRegionId,payload.graph.regions[0].id);
 assert.deepEqual(payload.design,{startNotes:'문턱 안쪽',portalNotes:'통로의 가운데',collisionNotes:'돌담만',collisionMode:'suggest'});
 assert.ok(validMapRequest(payload,requestType));
 assert.ok(!validMapRequest({...payload,graph:{...payload.graph,startPoint:{x:300,y:400}}},requestType));
});
