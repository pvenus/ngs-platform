import {bowlStates,permitsAssemblyPortal,spiritPuzzleType} from './assembly-contract.mjs';
import {assemblySpriteBox,applyAssemblySpriteBox,decorationBox,paintDecoration,renderMapDecorations,paintPropDepth,puzzleZOrder} from './assembly-sprite-layout.mjs';
import {mapDecorPinKey} from './map-contract.mjs';
import {mountAssemblyActor,mountAssemblyPerspective} from './assembly-actor.mjs';
import {createPuzzleRuntime,advancePressMeter,prepareCsharpWater} from './puzzle-state-runtime.mjs';

export const wellDemoId='binari.ritual-well-water-demo';
export const wellDemoTitle='굿상에 물 올리기';
export const spiritDemoId=spiritPuzzleType,spiritDemoTitle='영물 현현';
export const wellAssemblySlots=Object.freeze({table:'제상',bowl:'물그릇',well:'우물 몸체',lid:'우물 뚜껑'});
const has=(ref,field,value)=>({ref,field,value});
const state=(ref,value)=>has(ref,'state',value);

// Design knows how to resolve ports, not which background or prop art will be used.
export const wellRules=[
 {event:'pickup',target:'bowl',require:[state('bowl','altar-empty')],
  effects:[state('bowl','carried-empty')],message:'빈 물그릇을 챙겼어요.'},
 {event:'meter-success',target:'lid',require:[state('lid','closed')],effects:[state('lid','open')],message:'뚜껑이 열렸어요. 인벤토리의 빈 그릇을 우물에 놓으세요.'},
 {event:'drop',target:'well',item:'bowl',require:[state('$item','carried-empty'),{...state('lid','open'),message:'우물 뚜껑을 먼저 열어야 해요.'}],
  effects:[state('$item','carried-filled')],blocked:'인벤토리의 빈 그릇만 사용할 수 있어요.',message:'그릇에 물을 담았어요. 제상의 빈 자리에 놓으세요.'},
 {event:'drop',target:'socket',item:'bowl',require:[state('$item','carried-filled'),state('goal','pending')],
  effects:[state('$item','altar-filled'),state('goal','done')],blocked:'물을 담은 그릇만 올릴 수 있어요.',message:'굿상에 물을 올렸어요. 준비 과업 완료!'},
];
const assembly={
 bindings:{bowl:'water-bowl',well:'back-well',lid:'well-lid',socket:'altar-socket',goal:'offering-goal'},
 entities:[
  {id:'water-bowl',states:bowlStates,initial:'altar-empty'},
  {id:'back-well',states:['ready'],initial:'ready'},
  {id:'well-lid',states:['closed','open'],initial:'closed'},
  {id:'altar-socket',states:['ready'],initial:'ready'},
  {id:'offering-goal',states:['pending','done'],initial:'pending'},
 ],
 positions:{altar:{x:23,y:39},well:{x:78,y:39}},
};
export const makeWellPuzzle=()=>createPuzzleRuntime({...assembly,rules:wellRules});
export const prepareWellPuzzle=definition=>definition?prepareCsharpWater(definition,assembly.bindings):Promise.resolve(makeWellPuzzle);
const meter={target:100,gain:18,decay:16};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const button=(label,cls)=>{const b=el('button',label,cls);b.type='button';return b;};

export function mountWellPuzzleDemo(host,{signal,rehearsal}={}){
 if(signal.aborted)return;
 const ids=assembly.bindings,points=rehearsal?.positions??assembly.positions,worldSized=Boolean(rehearsal?.artSizes),useActor=Boolean(rehearsal?.graph);
 let actor=null,spirit=false;
 const root=el('section',null,'well-demo'),instructions=el('p',useActor?'WASD로 8방향 이동 · 포털에 걸어 들어가기 · 프랍 가까이에서 F 또는 그릇 드롭':'제상이나 우물을 클릭해 대상 선택 · F로 상호작용 시작 · 인벤토리 그릇을 우물이나 제상에 드래그','meta');
 const decorLayer=el('div',null,'map-decoration-layer');
 const scene=el('div',null,'well-demo-scene');scene.tabIndex=0;scene.setAttribute('aria-label','앞마당과 뒤뜰이 있는 테스트 배경');
 const altar=el('div',null,'well-demo-station well-demo-altar'),well=el('div',null,'well-demo-station well-demo-well');
 const socket=button('', 'well-demo-target well-demo-socket'),water=button('', 'well-demo-target well-demo-water');
 const artImages=[];
 const spirits=spiritManifestationLayer(scene,rehearsal?.manifestations??[],rehearsal?.regions??[]);
 const addArt=(role,host)=>{const asset=rehearsal?.art?.[role];if(!asset)return null;
  const img=el('img',null,'well-demo-sprite well-demo-sprite-'+role);img.src=asset;img.alt='';img.draggable=false;host.append(img);artImages.push([role,img]);return img;
 };
 const socketText=el('span'),wellText=el('span'),carriedText=el('span');
 const altarArt=el('div',null,'well-demo-sprite-stack'),rimArt=el('div',null,'well-demo-sprite-stack');
 const tableArt=addArt('table',worldSized?scene:altarArt),bowlArt=addArt('bowl',worldSized?scene:altarArt);
 const wellArt=addArt('well',worldSized?scene:rimArt),lidArt=addArt('lid',worldSized?scene:rimArt);
 const worldArt={table:tableArt,bowl:bowlArt,well:wellArt,lid:lidArt};
 if(worldSized){
  scene.classList.add('well-world-sized');for(const [role,img] of Object.entries(worldArt))if(img){img.className='well-world-sprite';img.dataset.role=role;paintPropDepth(img,puzzleZOrder(rehearsal.zOrder,role),'puzzle');}
 }
 if(altarArt.children.length){socket.classList.add('well-demo-has-art');socket.append(altarArt);}
 if(rimArt.children.length){water.classList.add('well-demo-has-art');water.append(rimArt);}
 socket.append(socketText);water.append(wellText);
 altar.append(el('strong','제상'),socket);well.append(el('strong','우물'),water);scene.append(altar,well);
 const controls=el('div',null,'well-demo-controls'),startButton=button('상호작용 (F)','prop-control'),resetButton=button('처음부터','prop-control');
 const inventory=el('section',null,'well-demo-inventory'),inventoryLabel=el('strong','인벤토리'),carried=button('빈 물그릇','prop-control well-demo-item');
 addArt('bowl',carried);carried.append(carriedText);carried.draggable=true;carried.setAttribute('aria-pressed','false');
 inventory.append(inventoryLabel,carried);controls.append(startButton,inventory,resetButton);
 const spiritToggle=button('서진 능력 · OFF','prop-control well-spirit-toggle');
 spiritToggle.setAttribute('aria-label','서진 능력');spiritToggle.setAttribute('aria-pressed','false');
 controls.append(spiritToggle);
 const status=el('p',null,'well-demo-status');status.setAttribute('role','status');
 const meterView=el('section',null,'well-demo-meter');meterView.hidden=true;
 const title=el('strong','뚜껑 열기'),meterHelp=el('span','스페이스 연타');
 const gauge=el('progress');gauge.max=meter.target;gauge.setAttribute('aria-label','뚜껑 열기 게이지');
 const push=button('힘주기','prop-control'),cancel=button('취소','prop-control');
 meterView.append(title,meterHelp,gauge,push,cancel);(rehearsal?scene:well).append(meterView);status.textContent='제상 위의 빈 물그릇을 챙기세요.';
 let currentRegion=rehearsal?.initialRegion;
 const bg=el('img',null,'well-demo-map-bg'),route=el('nav',null,'well-demo-route'),jump=el('select'),portals=el('div',null,'well-play-portals');
 if(rehearsal){
  scene.classList.add('well-demo-map','prop-depth-scene');bg.alt='';bg.draggable=false;scene.prepend(bg,decorLayer);if(useActor)scene.append(portals);
  const label=el('label','테스트 구역 바로가기');jump.setAttribute('aria-label','테스트 구역 바로가기');
  for(const region of rehearsal.regions){const option=el('option',region.name);option.value=region.id;jump.append(option);}
  label.append(jump);if(!useActor)root.append(label);root.append(route);
 }
 root.append(instructions,scene,controls,status);host.append(root);
 const makeRuntime=rehearsal?.makeRuntime??makeWellPuzzle;
 let runtime=makeRuntime(),selected=null,held=false,dragged=false,progress=0,lastTick,raf=null,pressing=false;
 const tell=msg=>{status.textContent=msg;};
 function placeNode(node,p){node.style.left=p.x+'%';node.style.top=p.y+'%';}
 // World-sized art and targets share scene-relative coordinates. Their
 // station wrappers cover the whole scene, not a second offset origin.
 if(!worldSized){placeNode(altar,points.altar);placeNode(well,points.well);}
 if(rehearsal)meterView.style.setProperty('--well-meter-x',points.well.x+'%');
 function box(role,region){
  return assemblySpriteBox({role,layout:points,attachments:rehearsal.attachments,asset:rehearsal.artSizes?.[role],scale:rehearsal.scale,region});
 }
 function paintSight(){
  const repaint=(image,normal,alternate)=>{
   const hasAlternate=Boolean(spirit&&alternate&&alternate!==normal);
   const src=hasAlternate?alternate:normal;
   if(src&&image.getAttribute('src')!==src)image.src=src;
   image.dataset.sightArt=hasAlternate?'spirit':'normal';
  };
  const region=rehearsal?.regions.find(r=>r.id===currentRegion);
  if(region)repaint(bg,region.pixelSrc??region.src,region.spiritSrc);
  if(rehearsal?.decorArt)renderMapDecorations(decorLayer,rehearsal.graph?.decorations??[],rehearsal.decorArt,region,spirit,mapDecorPinKey);
  spirits.paint(currentRegion,spirit);
  for(const [role,img] of artImages)repaint(img,rehearsal.art[role],rehearsal.spiritArt?.[role]);
 }
 root.addEventListener('keydown',ev=>{
  if(ev.code!=='KeyF'&&ev.key?.toLowerCase()!=='f'||ev.repeat||!actor)return;
  if(spirits.activate(currentRegion,spirit,point=>actor.isNear(point.regionId,point.x,point.y))){
   ev.preventDefault();ev.stopImmediatePropagation();paintSight();
  }
 },{capture:true,signal});
 spiritToggle.addEventListener('click',()=>{
  spirit=!spirit;spiritToggle.textContent=spirit?'서진 능력 · ON':'서진 능력 · OFF';
  spiritToggle.setAttribute('aria-pressed',String(spirit));paintSight();
  if(useActor)scene.focus({preventScroll:true});
 },{signal});
 function showRegion(id){
  if(!rehearsal)return;
  const region=rehearsal.regions.find(r=>r.id===id);if(!region)return;
  currentRegion=id;jump.value=id;scene.dataset.region=id;scene.setAttribute('aria-label',region.name);
  paintSight();
  scene.style.aspectRatio=String(region.width/region.height);
  pressing=false;selected=null;
  altar.hidden=points.altar.regionId!==id;well.hidden=points.well.regionId!==id;
  if(worldSized){
   for(const [role,img] of Object.entries(worldArt))if(img)applyAssemblySpriteBox(img,box(role,region));
   applyAssemblySpriteBox(socket,box('table',region));applyAssemblySpriteBox(water,box('well',region));
  }
  if(useActor)portals.replaceChildren(...rehearsal.connections.filter(c=>c.from===id).map(c=>{
   const marker=el('div',null,'well-play-portal'),to=rehearsal.regions.find(r=>r.id===c.to);
   Object.assign(marker.style,{left:c.hit.x/10+'%',top:c.hit.y/10+'%',width:c.hit.width/10+'%',height:c.hit.height/10+'%'});
   marker.title='포털: '+to.name;marker.setAttribute('aria-label',marker.title);return marker;
  }));
  route.replaceChildren(...rehearsal.connections.filter(c=>!useActor&&c.from===id).map(c=>{
   const to=rehearsal.regions.find(r=>r.id===c.to),link=button('이동: '+to.name,'prop-control');
   link.addEventListener('click',()=>{showRegion(c.to);scene.focus();},{once:true});return link;
  }));
  render();
 }
 jump.addEventListener('change',()=>showRegion(jump.value),{signal});
 function stationNear(role){
  if(!useActor)return true;
  const point=role==='bowl'||role==='table'?points.altar:points.well,delta=rehearsal.attachments?.[role];
  return Boolean(actor?.isNear(point.regionId,point.x+(delta?.x??0),point.y+(delta?.y??0)));
 }
 function selectedAction(){
  const bowl=runtime.get(ids.bowl),lid=runtime.get(ids.lid);
  const canPickup=bowl.state==='altar-empty',canOpen=lid.state==='closed';
  if(useActor){
   if(selected===ids.well&&canOpen&&stationNear('well'))return 'open';
   if(canPickup&&stationNear('bowl'))return 'pickup';
   if(canOpen&&stationNear('well'))return 'open';
   return '';
  }
  if(selected===ids.socket&&canPickup)return 'pickup';
  if(selected===ids.well&&canOpen)return 'open';
  return '';
 }
 function render(){
  const bowl=runtime.get(ids.bowl),lid=runtime.get(ids.lid),done=runtime.get(ids.goal).state==='done',action=selectedAction();
  const atAltar=bowl.state.startsWith('altar-'),filled=bowl.state.endsWith('-filled');
  root.dataset.well=lid.state;root.dataset.bowl=filled?'filled':'empty';root.dataset.complete=String(done);
  socket.dataset.state=atAltar?(filled?'filled':'empty'):'vacant';
  socketText.textContent=!atAltar?'빈 그릇 자리':filled?'물 담긴 그릇':'빈 물그릇';
  water.dataset.state=lid.state;wellText.textContent=lid.state==='open'?'열린 우물':'닫힌 뚜껑';
  carried.hidden=atAltar;carriedText.textContent=filled?'물 담긴 그릇':'빈 물그릇';
  if(bowlArt)bowlArt.hidden=!atAltar||(worldSized&&points.altar.regionId!==currentRegion);
  if(lidArt)lidArt.hidden=lid.state==='open'||(worldSized&&points.well.regionId!==currentRegion);
  carried.dataset.state=filled?'filled':'empty';carried.setAttribute('aria-pressed',String(held));
  meterView.hidden=!pressing;
  socket.setAttribute('aria-pressed',String(selected===ids.socket));water.setAttribute('aria-pressed',String(selected===ids.well));
  startButton.disabled=!action||pressing;startButton.textContent=action==='pickup'?'F · 그릇 줍기':action==='open'?'F · 뚜껑 열기':'F · 상호작용 시작';
 }
 function command(event){
  const result=runtime.dispatch(event);
  if(result.message)tell(result.message);
  if(result.ok){
   for(const change of result.changes??[]){
    const role=Object.keys(ids).find(role=>ids[role]===change.id);
    if(role==='bowl'||role==='lid'){
     rehearsal?.onPropChanged?.({...change,role,regionId:currentRegion,
      ...(role==='bowl'&&change.after.state.startsWith('altar-')?{socket:'altar-socket'}:{})});
    }
    if(role==='goal'&&change.after.state==='done')rehearsal?.onCompleted?.();
   }
  }
  return result;
 }
 function interact(){
  if(pressing)return;
  if(selectedAction()==='pickup')command({type:'pickup',target:ids.bowl});
  else if(selectedAction()==='open'){progress=0;gauge.value=0;pressing=true;actor?.setEnabled(false);tell('스페이스를 연타하세요. 멈추면 게이지가 줄어요.');wake();}
  else tell(useActor?'그릇이나 닫힌 우물 가까이에서 F를 누르세요.':'제상 위의 그릇이나 닫힌 우물을 선택한 뒤 F를 누르세요.');
  render();if(pressing||useActor)scene.focus();
 }
 function force(){
  if(!pressing)return;
  progress=advancePressMeter(progress,{presses:1},meter);gauge.value=progress;
  if(progress<meter.target)return;
  command({type:'meter-success',target:ids.lid});pressing=false;actor?.setEnabled(true);render();scene.focus();
 }
 function drop(target){
  if(rehearsal&&(target===ids.socket?altar.hidden:well.hidden))return;
  if(useActor&&!stationNear(target===ids.socket?'bowl':'well')){tell('액터를 대상 가까이 이동한 뒤 그릇을 놓아 주세요.');scene.focus();return;}
  if(pressing){tell('뚜껑 열기를 먼저 끝내거나 취소하세요.');return;}
  if(command({type:'drop',target,item:ids.bowl}).ok)held=false;
  render();if(useActor)scene.focus();
 }
 for(const [node,id] of [[socket,ids.socket],[water,ids.well]]){
  node.addEventListener('dragover',e=>{if(dragged){e.preventDefault();e.dataTransfer.dropEffect='move';}},{signal});
  node.addEventListener('drop',e=>{e.preventDefault();if(dragged&&e.dataTransfer.getData('text/plain')===ids.bowl)drop(id);dragged=false;},{signal});
  node.addEventListener('click',()=>{if(pressing)return;if(held){drop(id);return;}selected=id;render();if(useActor)scene.focus();},{signal});
 }
 carried.addEventListener('dragstart',e=>{dragged=true;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',ids.bowl);},{signal});
 carried.addEventListener('dragend',()=>{dragged=false;},{signal});
 carried.addEventListener('click',()=>{held=!held;tell(held?'그릇을 선택했어요. 우물이나 그릇 자리를 누르세요.':'그릇 선택을 해제했어요.');render();if(useActor)scene.focus();},{signal});
 startButton.addEventListener('click',interact,{signal});
 push.addEventListener('click',force,{signal});
 function cancelMeter(){pressing=false;actor?.setEnabled(true);tell('뚜껑을 열지 않았어요. F로 다시 시도할 수 있어요.');render();scene.focus();}
 cancel.addEventListener('click',cancelMeter,{signal});
 resetButton.addEventListener('click',()=>{
  pressing=false;
  runtime.close?.();runtime=makeRuntime();selected=null;held=dragged=false;
  tell('제상 위의 빈 물그릇을 챙기세요.');if(actor){actor.setEnabled(true);actor.reset();}else if(rehearsal)showRegion(rehearsal.initialRegion);else render();scene.focus();
 },{signal});
 root.addEventListener('keydown',e=>{
  if(e.target===spiritToggle)return;
  if(pressing){
   if(e.code==='Space'){e.preventDefault();if(!e.repeat)force();}
   else if(e.code==='Escape'){e.preventDefault();cancelMeter();}
   return;
  }
  if(e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.code==='KeyF'){e.preventDefault();if(!e.repeat)interact();}
 },{signal});
 function frame(at){
  if(signal.aborted)return;
  raf=null;
  const seconds=Math.min(.1,(at-(lastTick??at))/1000);lastTick=at;
  if(pressing){progress=advancePressMeter(progress,{seconds},meter);gauge.value=progress;raf=requestAnimationFrame(frame);}
 }
 function wake(){if(raf===null){lastTick=undefined;raf=requestAnimationFrame(frame);}}
 signal.addEventListener('abort',()=>{runtime.close?.();cancelAnimationFrame(raf);root.remove();},{once:true});
 if(useActor){
  const camera=mountAssemblyPerspective(scene,controls,rehearsal.graph,signal,meterView);
  actor=mountAssemblyActor(scene,{graph:rehearsal.graph,root,signal,onRegion:showRegion,onMove:state=>{camera?.paint(state);render();},
   canTraverse:edge=>permitsAssemblyPortal(rehearsal.portalConditions,edge.id,role=>runtime.get(ids[role])?.state)});
  showRegion(actor.snapshot().regionId);camera?.paint(actor.snapshot());
 }else if(rehearsal)showRegion(currentRegion);else render();
}

// Shared one-way switch, independent of view mode, map movement and presentation.
export function createSpiritManifestation(){
 const id='spirit';
 const runtime=createPuzzleRuntime({bindings:{spirit:id},entities:[{id,states:['veiled','manifested'],initial:'veiled',location:'scene'}],
  rules:[{event:'manifest',target:'spirit',require:[has('spirit','state','veiled')],effects:[has('spirit','state','manifested')]}]});
 return {
  state:()=>runtime.get(id).state,
  visible:sight=>Boolean(sight||runtime.get(id).state==='manifested'),
  activate:({sight,near})=>{
   if(!sight||!near)return null;
   const before=runtime.get(id);if(before.state!=='veiled')return null;
   const result=runtime.dispatch({type:'manifest',target:id});
   return result.ok?{before,after:runtime.get(id)}:null;
  },
 };
}
function spiritManifestationLayer(scene,configs,regions){
 if(!configs.length)return {paint(){},activate(){return false;}};
 const layer=el('div',null,'map-decoration-layer spirit-manifestation-layer');
 scene.append(layer);
 const targets=configs.map(cfg=>{
  const badge=el(cfg.media?'img':'span',cfg.media?null:'✦','map-decor-sprite spirit-manifestation-prop');
  badge.dataset.manifestationId=cfg.id??'preview';badge.hidden=true;
  if(cfg.media){badge.alt='';badge.draggable=false;}
  paintPropDepth(badge,puzzleZOrder(cfg.zOrder,'spirit'),'spirit');
  layer.append(badge);return {cfg,badge,model:createSpiritManifestation()};
 });
 function paint(regionId,sight){
  const region=regions.find(r=>r.id===regionId);
  for(const {cfg,badge,model} of targets){
   const visible=cfg.point.regionId===regionId&&model.visible(sight);
   badge.dataset.state=model.state();badge.dataset.view=sight?'cinematic':'pixel';
   if(cfg.media){
    const row={visibility:'both',anchor:{x:cfg.point.x*10,y:cfg.point.y*10},scale:cfg.scale,zOrder:puzzleZOrder(cfg.zOrder,'spirit')};
    paintDecoration(badge,visible?decorationBox(row,cfg.media,region,sight):null,'spirit');
   }else{
    badge.hidden=!visible;badge.style.left=cfg.point.x+'%';badge.style.top=cfg.point.y+'%';
   }
  }
 }
 function activate(regionId,sight,near){
  for(const {cfg,model} of targets){
   if(cfg.point.regionId!==regionId)continue;
   const result=model.activate({sight,near:near(cfg.point)});
   if(result){cfg.onReveal?.(result);paint(regionId,sight);return true;}
  }
  return false;
 }
 return {paint,activate};
}
export function mountSpiritManifestation(host,{signal,rehearsal}){
 if(signal?.aborted)return;
 const root=el('section',null,'well-demo spirit-manifestation-demo');
 const scene=el('div',null,'well-demo-scene'),regionArt=el('img',null,'well-demo-map-bg'),decor=el('div',null,'map-decoration-layer');
 const controls=el('div',null,'well-demo-controls'),switchSight=button('서진 능력 · OFF','prop-control well-spirit-toggle');
 const engage=button('상호작용 (F)','prop-control'),story=el('p',null,'well-demo-status');
 scene.tabIndex=0;scene.setAttribute('aria-label','영물 현현 플레이');
 story.setAttribute('role','status');if(!rehearsal)story.textContent='서진 능력을 켜고 F로 상호작용한 뒤, 능력을 꺼서 결과를 확인하세요.';
 if(rehearsal){scene.classList.add('well-demo-map','prop-depth-scene');regionArt.alt='';regionArt.draggable=false;scene.append(regionArt,decor);}
 const point=rehearsal?.point??{regionId:'test',x:50,y:56};
 const layers=spiritManifestationLayer(scene,rehearsal?.manifestations??[{...rehearsal,point}],rehearsal?.regions??[]);
 let sight=false,actor,regionId=rehearsal?.graph.startRegionId??'test';
 const display=()=>{
  switchSight.textContent='서진 능력 · '+(sight?'ON':'OFF');switchSight.setAttribute('aria-pressed',String(sight));
  scene.dataset.region=regionId;
  const region=rehearsal?.regions.find(r=>r.id===regionId);
  if(region){
   const url=sight?region.spiritSrc??region.src:region.pixelSrc??region.src;
   if(regionArt.getAttribute('src')!==url)regionArt.src=url;
   regionArt.dataset.sightArt=sight?'spirit':'normal';scene.style.aspectRatio=String(region.width/region.height);
   if(rehearsal.decorArt)renderMapDecorations(decor,rehearsal.graph.decorations??[],rehearsal.decorArt,region,sight,mapDecorPinKey);
  }
  scene.dataset.spirit=sight?'on':'off';layers.paint(regionId,sight);
 };
 const activate=()=>{
  if(layers.activate(regionId,sight,p=>!actor||actor.isNear(p.regionId,p.x,p.y)))story.textContent='영물이 모습을 드러냈어요.';
 };
 switchSight.setAttribute('aria-label','서진 능력');switchSight.addEventListener('click',()=>{sight=!sight;display();scene.focus({preventScroll:true});},{signal});
 engage.addEventListener('click',()=>{activate();scene.focus({preventScroll:true});},{signal});
 root.addEventListener('keydown',ev=>{
  if(!ev.repeat&&(ev.code==='KeyF'||ev.key?.toLowerCase()==='f')){ev.preventDefault();activate();}
 },{signal});
 controls.append(switchSight,engage);root.append(scene,controls,story);host.append(root);
 if(rehearsal){
  const camera=mountAssemblyPerspective(scene,controls,rehearsal.graph,signal);
  actor=mountAssemblyActor(scene,{graph:rehearsal.graph,root,signal,onRegion:id=>{regionId=id;display();},onMove:state=>camera?.paint(state)});
  camera?.paint(actor.snapshot());
 }
 display();signal?.addEventListener('abort',()=>root.remove(),{once:true});scene.focus({preventScroll:true});
}
