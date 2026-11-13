// Deterministic observation-diagram interaction. No world facts or text are inferred.
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).sort().join(',')===keys.split(' ').sort().join(',');
const text=x=>typeof x==='string'&&x.trim()&&x.length<=500;
const num=(x,a,b)=>typeof x==='number'&&Number.isFinite(x)&&x>=a&&x<=b;
const fail=x=>{throw Error(x)};
export function viewGeometry(s,position){
 const cx=s.camera.minX+(s.camera.maxX-s.camera.minX)*position/100,scale=300;
 const o=s.occluder,t=s.target;
 const wall={x:400+(o.x-cx-o.width/2)*scale/o.depth,y:120+(s.camera.height-o.height)*scale/o.depth,w:o.width*scale/o.depth,h:o.height*scale/o.depth};
 const top=120+s.camera.height*scale/(t.depth+t.depthSize/2),bottom=120+s.camera.height*scale/(t.depth-t.depthSize/2);
 const target={x:400+(t.x-cx-t.width/2)*scale/t.depth,y:top,w:t.width*scale/t.depth,h:bottom-top};
 const overlap=Math.max(0,Math.min(wall.x+wall.w,target.x+target.w)-Math.max(wall.x,target.x))*Math.max(0,Math.min(wall.y+wall.h,target.y+target.h)-Math.max(wall.y,target.y));
 return {wall,target,visible:Math.max(0,Math.min(1,1-overlap/(target.w*target.h)))};
}
export function validateSpatial(d){
 const s=d.spatial;
 if(!exact(s,'backgroundItemId camera occluder target conclusions labels')||!d.items.some(i=>i.id===s.backgroundItemId&&i.resource)||!exact(s.camera,'minX maxX height start')||!num(s.camera.minX,-4,0)||!num(s.camera.maxX,0,4)||s.camera.maxX-s.camera.minX<2||!num(s.camera.height,1,2)||!Number.isInteger(s.camera.start)||!num(s.camera.start,0,100))fail('VIEW_CAMERA');
 if(!exact(s.occluder,'itemId x depth width height')||!d.items.some(i=>i.id===s.occluder.itemId)||!num(s.occluder.x,-2,2)||!num(s.occluder.depth,2,4)||!num(s.occluder.width,.5,3)||!num(s.occluder.height,.5,1.5))fail('VIEW_OCCLUDER');
 if(!exact(s.target,'itemId x depth width depthSize')||!d.items.some(i=>i.id===s.target.itemId)||s.target.itemId===s.occluder.itemId||!num(s.target.x,-2,2)||!num(s.target.depth,4,8)||s.target.depth<=s.occluder.depth||!num(s.target.width,.4,1.5)||!num(s.target.depthSize,.5,2))fail('VIEW_TARGET');
 const values=Array.from({length:101},(_,p)=>viewGeometry(s,p));
 if(!values.some(g=>g.visible<=.1)||!values.some(g=>g.visible>=.6)||values.some(g=>!num(g.target.x,0,800-g.target.w)||!num(g.target.y,0,420-g.target.h)))fail('VIEW_UNREACHABLE');
 if(!Array.isArray(s.conclusions)||s.conclusions.length!==3||new Set(s.conclusions.map(c=>c.id)).size!==3||s.conclusions.some(c=>!exact(c,'id label correct feedback')||!/^claim\.[a-z0-9-]+$/.test(c.id)||!text(c.label)||typeof c.correct!=='boolean'||!text(c.feedback))||s.conclusions.filter(c=>c.correct).length!==1)fail('VIEW_CONCLUSIONS');
 const keys='diagram position covered visible inspectCovered inspectVisible discovered question reset';if(!exact(s.labels,keys)||Object.values(s.labels).some(x=>!text(x)))fail('VIEW_LABELS');
 return s;
}
export function spatialState(d){return {position:d.spatial.camera.start,seen:{covered:null,visible:null},answer:null};}
export function actSpatial(run,a){
 const r=structuredClone(run),s=r.definition.spatial;if(r.status!=='active')return r;
 if(a.type==='move'){if(!Number.isInteger(a.position)||!num(a.position,0,100))fail('VIEW_POSITION');r.position=a.position;r.feedback='pending';}
 else if(a.type==='inspect'){
  if(!['covered','visible'].includes(a.part))fail('VIEW_PART');
  const g=viewGeometry(s,r.position);
  if(a.part==='covered'&&g.visible<=.1||a.part==='visible'&&g.visible>=.6){r.seen[a.part]=r.position;r.feedback=r.seen.covered!==null&&r.seen.visible!==null?'partial':'pending';}else{r.attempts++;r.feedback='retry';}
 }
 else if(a.type==='answer'){
  if(r.seen.covered===null||r.seen.visible===null)fail('VIEW_DISCOVERY_REQUIRED');
  const claim=s.conclusions.find(c=>c.id===a.id);if(!claim)fail('VIEW_CLAIM');r.attempts++;r.answer=claim.id;
  if(claim.correct){r.status='cleared';r.feedback='cleared';r.matched=[0];}else r.feedback='retry';
 }
 else if(a.type==='reobserve'){r.position=s.camera.start;r.answer=null;r.feedback='pending';}
 else if(a.type==='finish'){r.status=Object.values(r.seen).some(x=>x!==null)?'partial':'aborted';r.feedback=r.status;}
 else fail('VIEW_ACTION');return r;
}
export function restoreSpatial(initial,saved){
 if(!saved||JSON.stringify(saved.definition)!==JSON.stringify(initial.definition)||JSON.stringify(saved.binding)!==JSON.stringify(initial.binding)||JSON.stringify(saved.available)!==JSON.stringify(initial.available)||!Number.isInteger(saved.position)||!num(saved.position,0,100)||!exact(saved.seen,'covered visible')||!Number.isInteger(saved.attempts)||!num(saved.attempts,0,1000000)||typeof saved.delivered!=='boolean'||!['active','cleared','partial','aborted'].includes(saved.status)||!['pending','partial','retry','cleared','aborted'].includes(saved.feedback)||!Array.isArray(saved.selection)||saved.selection.length||!Array.isArray(saved.matched))fail('VIEW_SAVED');
 for(const k of['covered','visible']){const p=saved.seen[k];if(p!==null&&(!Number.isInteger(p)||!num(p,0,100)||!(k==='covered'?viewGeometry(initial.definition.spatial,p).visible<=.1:viewGeometry(initial.definition.spatial,p).visible>=.6)))fail('VIEW_SAVED_OBSERVATION');}
 const claim=initial.definition.spatial.conclusions.find(c=>c.id===saved.answer),both=Object.values(saved.seen).every(x=>x!==null),any=Object.values(saved.seen).some(x=>x!==null);
 if(saved.answer!==null&&!claim||claim&&!both||saved.status==='cleared'&&(saved.attempts<1||!both||!claim?.correct||JSON.stringify(saved.matched)!=='[0]')||saved.status!=='cleared'&&saved.matched.length||saved.status==='aborted'&&any||saved.status==='partial'&&!any||saved.status==='active'&&saved.delivered)fail('VIEW_SAVED_OUTCOME');
 return {...structuredClone(initial),position:saved.position,seen:structuredClone(saved.seen),answer:saved.answer,attempts:saved.attempts,matched:[...saved.matched],status:saved.status,feedback:saved.feedback,delivered:saved.delivered};
}
export function mountSpatial(root,initial,{image,onOutcome},deliver){
 let run=structuredClone(initial),hint=false;const s=run.definition.spatial;
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e;};
 const svgEl=(tag,attrs)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
 function dispatch(a){run=actSpatial(run,a);const out=deliver(run);if(out){run=out.run;onOutcome(out.event);}update();}
 root.replaceChildren();root.className='investigation-board view-reconstruction';root.append(el('h4',s.labels.diagram));root.append(el('p',run.definition.presentation.instruction,'investigation-objective'));
 const scene=el('div','','view-scene'),bg=run.definition.items.find(i=>i.id===s.backgroundItemId),src=image(bg.resource);if(src){const im=el('img');im.src=src;im.alt=bg.label;im.className='view-background';scene.append(im);}
 const svg=svgEl('svg',{viewBox:'0 0 800 420',role:'group','aria-label':s.labels.diagram});svg.append(svgEl('path',{d:'M0 120H800V420H0Z',fill:'#d9cbb5',opacity:.66}));
 const ground=svgEl('rect',{fill:'#b47c32',stroke:'#332b21','stroke-width':3,rx:3}),groundLines=svgEl('path',{fill:'none',stroke:'#6f4c24','stroke-width':3}),wall=svgEl('rect',{fill:'#807867',stroke:'#333f39','stroke-width':4,rx:8}),joints=svgEl('path',{fill:'none',stroke:'#c4bda9','stroke-width':2}),top=svgEl('rect',{fill:'#b9ad94',stroke:'#333f39','stroke-width':2,rx:5});svg.append(ground,groundLines,wall,joints,top);scene.append(svg);root.append(scene);
 for(const[e,part,name]of[[wall,'covered',s.labels.inspectCovered],[ground,'visible',s.labels.inspectVisible]]){e.setAttribute('role','button');e.setAttribute('tabindex','0');e.setAttribute('aria-label',name);e.style.cursor='pointer';e.onclick=()=>dispatch({type:'inspect',part});e.onkeydown=event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();dispatch({type:'inspect',part});}};}
 for(const e of[groundLines,joints,top])e.style.pointerEvents='none';
 const status=el('p','','view-status');status.setAttribute('role','status');root.append(status);
 const label=el('label',s.labels.position),slider=el('input');slider.type='range';slider.min='0';slider.max='100';slider.step='1';slider.setAttribute('aria-label',s.labels.position);slider.oninput=()=>dispatch({type:'move',position:Number(slider.value)});label.append(slider);root.append(label);
 const moves=el('div','','investigation-actions');for(const[p,t]of[[0,'←'],[50,'•'],[100,'→']]){const b=el('button',t);b.type='button';b.setAttribute('aria-label',s.labels.position+' '+p+'%');b.onclick=()=>dispatch({type:'move',position:p});moves.append(b);}root.append(moves);
 const inspect=el('div','','investigation-actions'),covered=el('button',s.labels.inspectCovered),visible=el('button',s.labels.inspectVisible);for(const[b,part]of[[covered,'covered'],[visible,'visible']]){b.type='button';b.onclick=()=>dispatch({type:'inspect',part});inspect.append(b);}root.append(inspect);
 const discoveries=el('p','','view-discoveries');discoveries.setAttribute('role','status');root.append(discoveries);
 const question=el('fieldset');question.append(el('legend',s.labels.question));const answers=[];for(const c of s.conclusions){const b=el('button',c.label,'view-claim');b.type='button';b.onclick=()=>dispatch({type:'answer',id:c.id});question.append(b);answers.push(b);}root.append(question);
 const actions=el('div','','investigation-actions'),reset=el('button',s.labels.reset),finish=el('button',run.definition.presentation.aborted),h=el('button','힌트 보기');for(const b of[reset,finish,h]){b.type='button';actions.append(b);}reset.onclick=()=>dispatch({type:'reobserve'});finish.onclick=()=>dispatch({type:'finish'});h.onclick=()=>{hint=!hint;update();};root.append(actions);
 const hintBox=el('p','','investigation-hint'),feedback=el('p','','investigation-feedback');feedback.setAttribute('role','status');root.append(hintBox,feedback);
 function update(){
  const g=viewGeometry(s,run.position),w=g.wall,t=g.target;
  for(const[e,r]of[[ground,t],[wall,w]])for(const[k,v]of Object.entries({x:r.x,y:r.y,width:r.w,height:r.h}))e.setAttribute(k,String(v));
  top.setAttribute('x',String(w.x-5));top.setAttribute('y',String(w.y-8));top.setAttribute('width',String(w.w+10));top.setAttribute('height','14');
  joints.setAttribute('d',`M${w.x} ${w.y+w.h*.5}h${w.w} M${w.x+w.w*.33} ${w.y}v${w.h*.5} M${w.x+w.w*.67} ${w.y+w.h*.5}v${w.h*.5}`);
  groundLines.setAttribute('d',`M${t.x+4} ${t.y+t.h*.3}l${t.w-8} ${t.h*.4} M${t.x+t.w*.3} ${t.y+2}v${t.h-4}`);
  ground.setAttribute('aria-disabled',String(run.status!=='active'||g.visible<.6));ground.setAttribute('tabindex',run.status==='active'&&g.visible>=.6?'0':'-1');ground.style.pointerEvents=run.status==='active'&&g.visible>=.6?'auto':'none';wall.setAttribute('tabindex',run.status==='active'?'0':'-1');ground.setAttribute('stroke',run.seen.visible!==null?'#156b55':'#332b21');wall.setAttribute('stroke',run.seen.covered!==null?'#156b55':'#333f39');
  slider.value=String(run.position);slider.disabled=run.status!=='active';slider.setAttribute('aria-valuetext',run.position+'%');status.textContent=(g.visible<=.1?s.labels.covered:g.visible>=.6?s.labels.visible:run.definition.presentation.pending);
  const both=run.seen.covered!==null&&run.seen.visible!==null;covered.disabled=run.status!=='active';visible.disabled=run.status!=='active'||g.visible<.6;
  discoveries.textContent=s.labels.discovered+' · '+run.definition.items.find(i=>i.id===s.occluder.itemId).label+' '+Number(run.seen.covered!==null)+'/1 · '+run.definition.items.find(i=>i.id===s.target.itemId).label+' '+Number(run.seen.visible!==null)+'/1';question.hidden=!both;answers.forEach(b=>b.disabled=run.status!=='active');reset.disabled=finish.disabled=run.status!=='active';h.setAttribute('aria-expanded',String(hint));h.textContent=hint?'힌트 닫기':'힌트 보기';hintBox.hidden=!hint;hintBox.textContent=run.definition.presentation.retry;
  const claim=s.conclusions.find(c=>c.id===run.answer);feedback.textContent=claim?.feedback||run.definition.presentation[run.feedback];
  root.dataset.viewPosition=String(run.position);root.dataset.visibleFraction=g.visible.toFixed(4);root.dataset.discovered=String(both);
 }
 update();return{getState:()=>structuredClone(run),destroy:()=>root.replaceChildren()};
}
