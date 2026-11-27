import {createPuzzleRuntime,advancePressMeter} from './puzzle-state-runtime.mjs';

export const wellDemoId='binari.ritual-well-water-demo';
export const wellDemoTitle='굿상에 물 올리기';
export const wellAssemblySlots=Object.freeze({table:'제상',bowl:'물그릇',well:'우물 몸체',lid:'우물 뚜껑'});
const has=(ref,field,value)=>({ref,field,value});
const state=(ref,value)=>has(ref,'state',value);
const place=(ref,value)=>has(ref,'location',value);

// Design knows how to resolve ports, not which background or prop art will be used.
export const wellRules=[
 {event:'pickup',target:'bowl',require:[place('bowl','socket'),state('bowl','empty')],
  effects:[place('bowl','inventory')],message:'빈 물그릇을 챙겼어요.'},
 {event:'meter-success',target:'lid',require:[state('lid','closed')],effects:[state('lid','open')],message:'뚜껑이 열렸어요. 인벤토리의 빈 그릇을 우물에 놓으세요.'},
 {event:'drop',target:'well',item:'bowl',require:[place('$item','inventory'),{...state('lid','open'),message:'우물 뚜껑을 먼저 열어야 해요.'},state('$item','empty')],
  effects:[state('$item','filled')],blocked:'인벤토리의 빈 그릇만 사용할 수 있어요.',message:'그릇에 물을 담았어요. 제상의 빈 자리에 놓으세요.'},
 {event:'drop',target:'socket',item:'bowl',require:[place('$item','inventory'),state('$item','filled'),state('goal','pending')],
  effects:[place('$item','socket'),state('goal','done')],blocked:'물을 담은 그릇만 올릴 수 있어요.',message:'굿상에 물을 올렸어요. 준비 과업 완료!'},
];
const assembly={
 bindings:{bowl:'water-bowl',well:'back-well',lid:'well-lid',socket:'altar-socket',goal:'offering-goal'},
 entities:[
  {id:'water-bowl',states:['empty','filled'],initial:'empty',location:'socket'},
  {id:'back-well',states:['ready'],initial:'ready',location:'scene'},
  {id:'well-lid',states:['closed','open'],initial:'closed',location:'scene'},
  {id:'altar-socket',states:['ready'],initial:'ready',location:'scene'},
  {id:'offering-goal',states:['pending','done'],initial:'pending',location:'scene'},
 ],
 positions:{altar:{x:23,y:39},well:{x:78,y:39}},
};
export const makeWellPuzzle=()=>createPuzzleRuntime({...assembly,rules:wellRules});
const meter={target:100,gain:18,decay:16};
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text)n.textContent=text;return n;};
const button=(label,cls)=>{const b=el('button',label,cls);b.type='button';return b;};

export function mountWellPuzzleDemo(host,{signal,rehearsal}={}){
 if(signal.aborted)return;
 const ids=assembly.bindings,points=rehearsal?.positions??assembly.positions;
 const root=el('section',null,'well-demo'),instructions=el('p','제상이나 우물을 클릭해 대상 선택 · F로 상호작용 시작 · 인벤토리 그릇을 우물이나 제상에 드래그','meta');
 const scene=el('div',null,'well-demo-scene');scene.tabIndex=0;scene.setAttribute('aria-label','앞마당과 뒤뜰이 있는 테스트 배경');
 const altar=el('div',null,'well-demo-station well-demo-altar'),well=el('div',null,'well-demo-station well-demo-well');
 const socket=button('', 'well-demo-target well-demo-socket'),water=button('', 'well-demo-target well-demo-water');
 const addArt=(role,host)=>{const asset=rehearsal?.art?.[role];if(!asset)return null;
  const img=el('img',null,'well-demo-sprite well-demo-sprite-'+role);img.src=asset;img.alt='';img.draggable=false;host.append(img);return img;
 };
 const socketText=el('span'),wellText=el('span'),carriedText=el('span');
 const altarArt=el('div',null,'well-demo-sprite-stack'),rimArt=el('div',null,'well-demo-sprite-stack');
 addArt('table',altarArt);const bowlArt=addArt('bowl',altarArt);addArt('well',rimArt);const lidArt=addArt('lid',rimArt);
 if(altarArt.children.length){socket.classList.add('well-demo-has-art');socket.append(altarArt);}
 if(rimArt.children.length){water.classList.add('well-demo-has-art');water.append(rimArt);}
 socket.append(socketText);water.append(wellText);
 altar.append(el('strong','제상'),socket);well.append(el('strong','우물'),water);scene.append(altar,well);
 const controls=el('div',null,'well-demo-controls'),startButton=button('상호작용 (F)','prop-control'),resetButton=button('처음부터','prop-control');
 const inventory=el('section',null,'well-demo-inventory'),inventoryLabel=el('strong','인벤토리'),carried=button('빈 물그릇','prop-control well-demo-item');
 addArt('bowl',carried);carried.append(carriedText);carried.draggable=true;carried.setAttribute('aria-pressed','false');
 inventory.append(inventoryLabel,carried);controls.append(startButton,inventory,resetButton);
 const status=el('p',null,'well-demo-status');status.setAttribute('role','status');
 const meterView=el('section',null,'well-demo-meter');meterView.hidden=true;
 const title=el('strong','뚜껑 열기'),meterHelp=el('span','스페이스 연타');
 const gauge=el('progress');gauge.max=meter.target;gauge.setAttribute('aria-label','뚜껑 열기 게이지');
 const push=button('힘주기','prop-control'),cancel=button('취소','prop-control');
 meterView.append(title,meterHelp,gauge,push,cancel);(rehearsal?scene:well).append(meterView);status.textContent='제상 위의 빈 물그릇을 챙기세요.';
 let currentRegion=rehearsal?.initialRegion;
 const bg=el('img',null,'well-demo-map-bg'),route=el('nav',null,'well-demo-route'),jump=el('select');
 if(rehearsal){
  scene.classList.add('well-demo-map');bg.alt='';bg.draggable=false;scene.prepend(bg);
  const label=el('label','테스트 구역 바로가기');jump.setAttribute('aria-label','테스트 구역 바로가기');
  for(const region of rehearsal.regions){const option=el('option',region.name);option.value=region.id;jump.append(option);}
  label.append(jump);if(!rehearsal.formal)root.append(label);root.append(route);
 }
 root.append(instructions,scene,controls,status);host.append(root);
 let runtime=makeWellPuzzle(),selected=null,held=false,dragged=false,progress=0,lastTick,raf=null,pressing=false;
 const tell=msg=>{status.textContent=msg;};
 function placeNode(node,p){node.style.left=p.x+'%';node.style.top=p.y+'%';}
 placeNode(altar,points.altar);placeNode(well,points.well);
 if(rehearsal)meterView.style.setProperty('--well-meter-x',points.well.x+'%');
 function showRegion(id){
  if(!rehearsal)return;
  const region=rehearsal.regions.find(r=>r.id===id);if(!region)return;
  currentRegion=id;jump.value=id;scene.dataset.region=id;scene.setAttribute('aria-label',region.name);
  if(bg.getAttribute('src')!==region.src)bg.src=region.src;
  scene.style.aspectRatio=String(region.width/region.height);
  pressing=false;selected=null;
  altar.hidden=points.altar.regionId!==id;well.hidden=points.well.regionId!==id;
  route.replaceChildren(...rehearsal.connections.filter(c=>c.from===id).map(c=>{
   const to=rehearsal.regions.find(r=>r.id===c.to),link=button('이동: '+to.name,'prop-control');
   link.addEventListener('click',()=>{showRegion(c.to);scene.focus();},{once:true});return link;
  }));
  render();
 }
 jump.addEventListener('change',()=>showRegion(jump.value),{signal});
 function selectedAction(){
  const bowl=runtime.get(ids.bowl),lid=runtime.get(ids.lid);
  if(selected===ids.socket&&bowl.location==='socket'&&bowl.state==='empty')return 'pickup';
  if(selected===ids.well&&lid.state==='closed')return 'open';
  return '';
 }
 function render(){
  const bowl=runtime.get(ids.bowl),lid=runtime.get(ids.lid),done=runtime.get(ids.goal).state==='done',action=selectedAction();
  root.dataset.well=lid.state;root.dataset.bowl=bowl.state;root.dataset.complete=String(done);
  socket.dataset.state=bowl.location==='socket'?bowl.state:'vacant';
  socketText.textContent=bowl.location!=='socket'?'빈 그릇 자리':bowl.state==='filled'?'물 담긴 그릇':'빈 물그릇';
  water.dataset.state=lid.state;wellText.textContent=lid.state==='open'?'열린 우물':'닫힌 뚜껑';
  carried.hidden=bowl.location!=='inventory';carriedText.textContent=bowl.state==='filled'?'물 담긴 그릇':'빈 물그릇';
  if(bowlArt)bowlArt.hidden=bowl.location!=='socket';
  if(lidArt)lidArt.hidden=lid.state==='open';
  carried.dataset.state=bowl.state;carried.setAttribute('aria-pressed',String(held));
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
      ...(role==='bowl'&&change.after.location==='socket'?{socket:'altar-socket'}:{})});
    }
    if(role==='goal'&&change.after.state==='done')rehearsal?.onCompleted?.();
   }
  }
  return result;
 }
 function interact(){
  if(pressing)return;
  if(selectedAction()==='pickup')command({type:'pickup',target:ids.bowl});
  else if(selectedAction()==='open'){progress=0;gauge.value=0;pressing=true;tell('스페이스를 연타하세요. 멈추면 게이지가 줄어요.');wake();}
  else tell('제상 위의 그릇이나 닫힌 우물을 선택한 뒤 F를 누르세요.');
  render();if(pressing)scene.focus();
 }
 function force(){
  if(!pressing)return;
  progress=advancePressMeter(progress,{presses:1},meter);gauge.value=progress;
  if(progress<meter.target)return;
  command({type:'meter-success',target:ids.lid});pressing=false;render();scene.focus();
 }
 function drop(target){
  if(rehearsal&&(target===ids.socket?altar.hidden:well.hidden))return;
  if(pressing){tell('뚜껑 열기를 먼저 끝내거나 취소하세요.');return;}
  if(command({type:'drop',target,item:ids.bowl}).ok)held=false;
  render();
 }
 for(const [node,id] of [[socket,ids.socket],[water,ids.well]]){
  node.addEventListener('dragover',e=>{if(dragged){e.preventDefault();e.dataTransfer.dropEffect='move';}},{signal});
  node.addEventListener('drop',e=>{e.preventDefault();if(dragged&&e.dataTransfer.getData('text/plain')===ids.bowl)drop(id);dragged=false;},{signal});
  node.addEventListener('click',()=>{if(pressing)return;if(held){drop(id);return;}selected=id;render();},{signal});
 }
 carried.addEventListener('dragstart',e=>{dragged=true;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',ids.bowl);},{signal});
 carried.addEventListener('dragend',()=>{dragged=false;},{signal});
 carried.addEventListener('click',()=>{held=!held;tell(held?'그릇을 선택했어요. 우물이나 그릇 자리를 누르세요.':'그릇 선택을 해제했어요.');render();},{signal});
 startButton.addEventListener('click',interact,{signal});
 push.addEventListener('click',force,{signal});
 function cancelMeter(){pressing=false;tell('뚜껑을 열지 않았어요. F로 다시 시도할 수 있어요.');render();scene.focus();}
 cancel.addEventListener('click',cancelMeter,{signal});
 resetButton.addEventListener('click',()=>{
  pressing=false;
  runtime=makeWellPuzzle();selected=null;held=dragged=false;
  tell('제상 위의 빈 물그릇을 챙기세요.');if(rehearsal)showRegion(rehearsal.initialRegion);else render();scene.focus();
 },{signal});
 root.addEventListener('keydown',e=>{
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
 const adjustAttachments=()=>{
  if(!rehearsal?.attachments)return;
  const {width,height}=scene.getBoundingClientRect();
  for(const [role,img] of [['bowl',bowlArt],['lid',lidArt]]){
   const offset=rehearsal.attachments[role];
   if(img&&offset)img.style.translate=(offset.x*width/100)+'px '+(offset.y*height/100)+'px';
  }
 };
 const sizeObserver=rehearsal?.attachments?new ResizeObserver(adjustAttachments):null;
 sizeObserver?.observe(scene);
 signal.addEventListener('abort',()=>{cancelAnimationFrame(raf);sizeObserver?.disconnect();root.remove();},{once:true});
 if(rehearsal)showRegion(currentRegion);else render();
}
