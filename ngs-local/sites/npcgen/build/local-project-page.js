import {conceptDetailOperations,conceptMarkdown,createConceptCategoryActions,syncConceptDetail} from './local-concept-category-ui.mjs';
import {followAcceptedAudioResult,followDeletedAudioResults,mountAudioWorkspace,readAudioSoundConcepts,refreshAudioResults,showAudioResults} from './local-audio-workspace.mjs';
import {loadNpcFolder} from './local-npc-workspace-ui.mjs';

/* Project-list lifecycle only: local cards first, one stale comparison, separate applies. */
const cards=new Map(),states=new Map(),progress=new Map(),cardNodes=new Map();
const grid=document.querySelector('#projects'),status=document.querySelector('#status');
const label={refreshing:'파일 비교 중',failed:'갱신하지 못했습니다.'};
const numbers=new Intl.NumberFormat('ko-KR');
let run;

function render(){
 for(const [id,node] of cardNodes){
  if(!cards.has(id)){node.card.remove();cardNodes.delete(id);}
 }
 let index=0;
 for(const project of cards.values()){
  let node=cardNodes.get(project.projectId);
  if(!node){
   const card=nodeOf('li','project-card-entry'),link=nodeOf('a','project-icon-card'),art=nodeOf('span','project-icon-art');
   const name=nodeOf('strong'),text=nodeOf('span'),description=nodeOf('span','project-card-description','세계관 · 이야기 · 인물');
   const arrow=nodeOf('span','project-card-arrow','↗');
   arrow.setAttribute('aria-hidden','true');text.setAttribute('role','status');
   card.append(link);link.append(art,name,text,description,arrow);
   node={card,link,art,name,text};
   cardNodes.set(project.projectId,node);
  }
  if(node.iconUrl!==project.iconUrl||node.name.textContent!==project.name){
   if(typeof project.iconUrl==='string'&&project.iconUrl.startsWith('/api/project-folders/icon?')){
    const image=document.createElement('img');image.src=project.iconUrl;image.alt='';
    image.addEventListener('error',()=>{if(image.parentNode===node.art)node.art.textContent=project.name.slice(0,2);},{once:true});
    node.art.replaceChildren(image);
   }else node.art.textContent=project.name.slice(0,2);
   node.iconUrl=project.iconUrl;
   node.name.textContent=project.name;
  }
  if(project.available===false){
   node.link.removeAttribute('href');
   node.link.setAttribute('aria-disabled','true');
  }else{
   node.link.setAttribute('href',navigation({projectId:project.projectId}));
   node.link.removeAttribute('aria-disabled');
  }
  node.link.setAttribute('aria-label',project.name+' 프로젝트 열기');
  const state=states.get(project.projectId),count=progress.get(project.projectId);
  const message=state==='downloading'&&count
   ? '동기화 중 '+numbers.format(count.completed)+' / '+numbers.format(count.total)+'개'
   : label[state]??'';
  if(node.text.textContent!==message)node.text.textContent=message;
  node.text.hidden=!message;
  node.text.className='card-status '+(state??'');
  if(grid.children[index]!==node.card)grid.insertBefore(node.card,grid.children[index]??null);
  index++;
 }
}

async function load(){
 run?.abort();
 run=new AbortController();
 const {signal}=run;
 states.clear();progress.clear();render();
 status.textContent=cards.size?'':'프로젝트를 불러오고 있습니다.';
 const sameOrigin=async(url,options={})=>{
  const response=await fetch(url,{cache:'no-store',signal,...options});
  if(!response.ok)throw Error('PROJECT_PAGE_READ_FAILED');
  return response.json();
 };
 try{
  const session=await sameOrigin('/__npcgen_session');
  const post=(path,body)=>sameOrigin('/api/project-folders/'+path,{method:'POST',headers:{
   'Content-Type':'application/json','X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId,
  },body:JSON.stringify(body)});
  const local=await sameOrigin('/api/project-folders');
  if(signal.aborted)return;
  cards.clear();
  for(const row of local.projects){
   cards.set(row.projectId,row);
   if(row.refreshState)states.set(row.projectId,row.refreshState);
  }
  // A first-time project can be actively downloading before its header file exists.
  for(const row of local.refreshes??[]){
   if(!cards.has(row.projectId))cards.set(row.projectId,{projectId:row.projectId,name:row.projectId,needsRefresh:true,available:false});
   if(row.phase==='downloading'){progress.set(row.projectId,row);states.set(row.projectId,'downloading');}
   else states.set(row.projectId,'refreshing');
  }
  render();status.textContent='';
  try{
   const remote=await sameOrigin('/api/project-folders/discover');
   if(signal.aborted)return;
   for(const projectId of remote.projects)if(!cards.has(projectId))cards.set(projectId,{projectId,name:projectId,needsRefresh:true,available:false});
  }catch(error){if(!cards.size)throw error;}

  const projectIds=[...cards.values()].filter(row=>row.needsRefresh||row.refreshState==='refreshing').map(row=>row.projectId);
  if(signal.aborted)return;
  for(const id of projectIds)if(!progress.has(id))states.set(id,'refreshing');
  render();
  if(!projectIds.length){
   if(!cards.size)status.textContent='조회 가능한 프로젝트가 없습니다.';
   return;
  }
  let compared;
  try{compared=await post('compare',{projectIds});}
  catch{
   if(!signal.aborted){for(const id of projectIds)states.set(id,'failed');render();}
   return;
  }
  if(signal.aborted)return;
  const changed=new Map(compared.groups.map(row=>[row.projectId,row.count])),failed=new Set(compared.unavailable);
  const applying=new Set();
  for(const id of projectIds){
   if(failed.has(id)){states.set(id,'failed');progress.delete(id);}
   else if(changed.has(id)){
    applying.add(id);
    if(!progress.has(id))progress.set(id,{completed:0,total:changed.get(id)});
    states.set(id,'downloading');
   }else{
    progress.delete(id);states.delete(id);
    const row=cards.get(id);row.needsRefresh=false;delete row.refreshState;
   }
  }
  render();
  let timer;
  function scheduleStatus(){
   if(!applying.size||signal.aborted)return;
   timer=setTimeout(async()=>{
    if(!applying.size||signal.aborted)return;
    try{
     const update=await sameOrigin('/api/project-folders');
     let changed=false;
     for(const row of update.refreshes??[]){
      if(signal.aborted||!applying.has(row.projectId)||row.phase!=='downloading')continue;
      const prior=progress.get(row.projectId);
      if(prior?.completed!==row.completed||prior?.total!==row.total){progress.set(row.projectId,row);changed=true;}
     }
     if(changed)render();
    }catch{/* The apply response is authoritative for success or failure. */}
    scheduleStatus();
   },500);
  }
  try{
   const pending=[...applying].map(async projectId=>{
    try{
     const response=await post('refresh',{projectId});
     if(signal.aborted)return;
     if(response.status==='removed'&&response.project===null&&response.projectId===projectId)cards.delete(projectId);
     else if(response.project?.projectId===projectId)cards.set(projectId,response.project);
     else throw Error('PROJECT_FILE_MISSING');
     states.delete(projectId);
    }catch{if(!signal.aborted)states.set(projectId,'failed');}
    finally{applying.delete(projectId);if(!signal.aborted){progress.delete(projectId);render();}}
   });
   scheduleStatus();
   await Promise.all(pending);
   if(!signal.aborted&&!cards.size)status.textContent='조회 가능한 프로젝트가 없습니다.';
  }finally{clearTimeout(timer);}
 }catch(error){
  if(!signal.aborted)status.textContent=cards.size?'기존 목록을 유지합니다.':'프로젝트를 불러오지 못했습니다.';
 }
}

const areas=[
 ['concept','마스터 컨셉',true],['story','스토리 설계',false],['assembly','조립·플레이',false],
 ['npcs','NPC 설계',true],['motion-presets','모션 프리셋',true],['production','퍼즐 설계',false],
 ['resources','배경·프랍 설계',false],['audio','음원 설계',document.documentElement?.dataset.audioWorkspace==='enabled'],['docs','작성 참고',false],
];
const iconPaths={
 concept:'M4 19V5a1 1 0 0 1 1-1h7v16H5a1 1 0 0 1-1-1Zm8-15h7a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7M7 8h2m6 0h2m-10 4h2m6 0h2',
 npcs:'M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M20 21v-2a4 4 0 0 0-3-4m-7-3a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7-1a4 4 0 0 0 0-7',
 'motion-presets':'M3 13h4l3-7 4 12 3-8 2 3h2',
 audio:'M9 18V5l12-2v13M9 18a3 2 0 1 1-6 0 3 2 0 0 1 6 0ZM21 16a3 2 0 1 1-6 0 3 2 0 0 1 6 0Z',
};
function nodeOf(tag,className,text){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=text;
 return node;
}
function navigation(values){
 const params=new URLSearchParams();
 for(const [key,value] of Object.entries(values))if(value)params.set(key,value);
 return params.size?'/?'+params:'/';
}
function navIcon(area){
 const icon=document.createElementNS('http://www.w3.org/2000/svg','svg');
 icon.setAttribute('viewBox','0 0 24 24');icon.setAttribute('fill','none');
 icon.setAttribute('stroke','currentColor');icon.setAttribute('stroke-width','1.6');
 icon.setAttribute('stroke-linecap','round');icon.setAttribute('stroke-linejoin','round');
 icon.setAttribute('aria-hidden','true');
 const p=document.createElementNS(icon.namespaceURI,'path');
 p.setAttribute('d',iconPaths[area]??'M5 5h14v14H5z M8 9h8m-8 4h5');
 icon.append(p);
 return icon;
}

async function loadWorkspace(search){
 run?.abort();
 run=new AbortController();
 const {signal}=run;
 const projectId=search.get('projectId'),tab=search.get('catalogArea')??'concept';
 const item=search.get('item'),file=search.get('file');
 const api=(extra={})=>'/api/project-workspace?'+new URLSearchParams({projectId,tab,...extra});
 const next=extra=>navigation({projectId,catalogArea:tab,...extra});
 const status=document.querySelector('#workspace-status');
 const nav=document.querySelector('#project-categories'),workspace=document.querySelector('#project-workspace');
 const items=document.querySelector('#workspace-items'),detail=document.querySelector('#workspace-detail');
 const listToolbar=document.querySelector('#concept-category-tools');
 listToolbar.replaceChildren();listToolbar.hidden=true;
 let conceptActions=null;
 const supported=(area,enabled)=>enabled&&(area!=='audio'||projectId==='binari');
 const [_,label,enabled]=areas.find(([id])=>id===tab)??['','프로젝트',false];
 document.querySelector('#items-title').textContent=tab==='audio'&&supported(tab,enabled)?'음원 종류':'항목';
 document.querySelector('#app').classList.remove('project-home');
 workspace.classList.toggle('npc-folder-workspace',tab==='npcs');
 document.querySelector('#project-home').hidden=true;
 for(const id of ['#project-workspace','#workspace-identity','#workspace-tools'])document.querySelector(id).hidden=false;
 document.querySelector('#workspace-title').textContent=projectId;
 document.querySelector('#workspace-icon').textContent=projectId.slice(0,2);
 document.querySelector('#area-title').textContent=label;
 nav.replaceChildren(...areas.map(([id,name,active])=>{
  const available=supported(id,active);
  const link=nodeOf(available?'a':'span',available?'':'unavailable-area');
  if(available){link.href=navigation({projectId,catalogArea:id});if(id===tab)link.setAttribute('aria-current','page');}
  else link.setAttribute('aria-disabled','true');
  link.append(navIcon(id),nodeOf('span','',name));
  if(!available)link.append(nodeOf('small','','미연결'));
  return link;
 }));
 items.replaceChildren();
 detail.replaceChildren();
 status.className='meta';status.textContent='';
 if(!supported(tab,enabled)){
  detail.append(nodeOf('h3','',label),nodeOf('p','meta','이 화면은 현재 읽기 기능에 연결되어 있지 않습니다.'));
  return;
 }
 async function request(url,options={}){
  const response=await fetch(url,{cache:'no-store',signal,...options});
  if(!response.ok)throw Error('PROJECT_WORKSPACE_UNAVAILABLE');
  return response.json();
 }
 function note(text,error=false){
  if(signal.aborted)return;
  status.textContent=text;status.className=error?'meta error':'meta';
 }
 function showHeader(row){
  if(!row||signal.aborted)return;
  document.querySelector('#workspace-title').textContent=row.name;
  const art=document.querySelector('#workspace-icon');
  if(row.iconUrl?.startsWith('/api/project-folders/icon?')){
   const image=nodeOf('img');image.alt='';image.src=row.iconUrl;
   image.addEventListener('error',()=>{if(image.parentNode===art)art.textContent=row.name.slice(0,2);},{once:true});
   art.replaceChildren(image);
  }else art.textContent=row.name.slice(0,2);
 }
 function renderList(rows){
  const list=[];
  for(const row of rows??[]){
   const entry=nodeOf('li'),link=nodeOf('a','request-item',row.label);
   link.href=next({item:row.id});if(item===row.id)link.setAttribute('aria-current','page');
   entry.append(link);list.push(entry);
  }
  if(!list.length)list.push(nodeOf('li','meta','게시된 항목이 없습니다.'));
  items.replaceChildren(...list);
 }
 function renderMotionPreset(selected,directions){
  const labels={nw:'북서',n:'북',ne:'북동',w:'서',e:'동',sw:'남서',s:'남',se:'남동'};
  const previews=new Map((Array.isArray(directions)?directions:[]).map(row=>[row.direction,row.path]));
  const compass=nodeOf('div','motion-preset-compass');
  compass.setAttribute('role','group');compass.setAttribute('aria-label','8방향 모션 미리보기');
  for(const direction of ['nw','n','ne','w',null,'e','sw','s','se']){
   if(direction===null){
    const center=nodeOf('span','motion-preset-compass-center');
    center.setAttribute('aria-hidden','true');compass.append(center);continue;
   }
   const card=nodeOf('figure','motion-preset-direction');
   card.dataset.direction=direction;
   const name=labels[direction]+' ('+direction.toUpperCase()+')';
   const stage=nodeOf('div','motion-preset-preview'),path=previews.get(direction);
   const empty=text=>stage.replaceChildren(nodeOf('p','meta',text));
   if(path){
    const clip=nodeOf('video');clip.controls=true;clip.preload='metadata';clip.playsInline=true;
    clip.setAttribute('aria-label',name+' 모션');clip.src=api({item:selected.id,file:path});
    clip.addEventListener('error',()=>empty('영상을 읽지 못했습니다.'),{once:true});
    stage.append(clip);
   }else empty('등록된 영상 없음');
   card.append(nodeOf('figcaption','',name),stage);
   compass.append(card);
  }
  detail.replaceChildren(nodeOf('h3','',selected.label),nodeOf('p','meta','Filex 사본 · 읽기 전용'),compass);
 }
 async function renderDetail(data){
  const selected=data.item;
  if(!selected){
   detail.replaceChildren(nodeOf('h3','',label),nodeOf('p','meta',item?'선택한 항목이 현재 사본에 없습니다.':'왼쪽 목록에서 항목을 선택하세요.'));
   return;
  }
  if(tab==='motion-presets'){renderMotionPreset(selected,data.motionPreset?.directions);return;}
  const files=(data.files??[]).filter(row=>['markdown','json','image','video'].includes(row.kind));
  const markdown=tab==='concept'?files.find(row=>row.kind==='markdown'):null;
  const current=markdown??(file?files.find(row=>row.path===file):files.find(row=>row.kind==='json')??files[0]);
  const title=nodeOf('h3','',selected.label),sub=nodeOf('p','meta','Filex 사본 · 읽기 전용');
  const fileNavigation=[];
  if(!markdown){
   const tabs=nodeOf('nav','detail-file-nav');
   tabs.setAttribute('aria-label','항목 파일');
   for(const row of files){
    const link=nodeOf('a','',row.label);link.href=next({item:selected.id,file:row.path});
    if(current?.path===row.path)link.setAttribute('aria-current','page');
    tabs.append(link);
   }
   fileNavigation.push(tabs);
  }
  const view=nodeOf('div','detail-file-body');
  const operations=conceptActions?conceptDetailOperations(selected):[];
  if(operations.length){
   const bar=nodeOf('header','concept-category-heading');
   const target={id:selected.id,title:selected.title},actions=nodeOf('div','concept-category-detail-tools');
   actions.append(...operations.map(operation=>conceptActions.trigger(operation,{target})));
   bar.append(title,actions);
   detail.replaceChildren(bar,sub,...fileNavigation,view);
  }else detail.replaceChildren(title,sub,...fileNavigation,view);
  if(!current){view.append(nodeOf('p','meta',file?'선택한 파일을 표시할 수 없습니다.':'표시할 수 있는 게시 파일이 없습니다.'));return;}
  const url=api({item:selected.id,file:current.path});
  if(current.kind==='image'){
   const image=nodeOf('img');image.src=url;image.alt=current.label;
   image.addEventListener('error',()=>view.replaceChildren(nodeOf('p','meta error','이미지를 읽지 못했습니다.')),{once:true});
   view.append(image);
  }else if(current.kind==='video'){
   const clip=nodeOf('video');clip.controls=true;clip.preload='metadata';clip.src=url;clip.setAttribute('aria-label',current.label);
   clip.addEventListener('error',()=>view.replaceChildren(nodeOf('p','meta error','영상을 읽지 못했습니다.')),{once:true});
   view.append(clip);
  }else{
   view.append(nodeOf('p','meta','파일을 읽고 있습니다.'));
   try{
    const value=await request(url);
    if(signal.aborted)return;
    if(current.kind==='markdown'){
     if(typeof value?.markdown!=='string')throw Error('CONCEPT_MARKDOWN_UNAVAILABLE');
     view.replaceChildren(conceptMarkdown(value.markdown));return;
    }
    const body=typeof value==='string'?value:[value?.body,value?.content,value?.text,value?.markdown,value?.description,value?.summary].find(text=>typeof text==='string'&&text.trim());
    const pre=nodeOf('pre','',JSON.stringify(value,null,2));
    if(body){
     const source=nodeOf('details');source.append(nodeOf('summary','','원문 JSON'),pre);
     view.replaceChildren(nodeOf('p','',body),source);
    }else view.replaceChildren(pre);
   }catch{if(!signal.aborted)view.replaceChildren(nodeOf('p','meta error','파일을 읽지 못했습니다.'));}
  }
 }
 async function displayLocal(data){
  if(signal.aborted)return;
  renderList(data.items);
  if(conceptActions){listToolbar.replaceChildren(conceptActions.trigger('add',{groups:data.groups??[]}));listToolbar.hidden=false;}
  await renderDetail(data);
 }
 async function readLocal(){
  const data=await request(api(item?{item}:{}));
  await displayLocal(data);
  return data;
 }
 try{
  note('항목을 읽고 있습니다.');
  const session=await request('/__npcgen_session');
  // This is a local metadata read, not a project-root comparison.
  void request('/api/project-folders').then(data=>showHeader(data.projects?.find(row=>row.projectId===projectId))).catch(()=>{});
  const jsonPost=body=>({method:'POST',headers:{
   'Content-Type':'application/json','X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId,
  },body:JSON.stringify(body)});
  const post=(name,body)=>request('/api/folders/'+name,jsonPost(body));
  if(tab==='audio'){
   let visible=null;
   const submit=command=>fetch('/api/requests',{...jsonPost(command),signal,cache:'no-store'});
   const display=rows=>{visible=rows;showAudioResults(library,rows,signal,{
    submitDelete:submit,onDeleteAccepted:ids=>{void followDeletedAudioResults({ids,post,request,signal,display});}});};
   const library=mountAudioWorkspace({items,detail,loadConcepts:()=>readAudioSoundConcepts({post,request,signal}),signal,submit,
    onAccepted:id=>{void followAcceptedAudioResult({id,post,request,signal,display,visible:()=>visible});}});
   display(null);
   try{
    await refreshAudioResults({post,request,signal,display});
    note('');
   }catch{note('게시된 BGM을 갱신하지 못했습니다.',true);}
   return;
  }
  if(tab==='npcs'){
   const submitOneStop=command=>fetch('/api/requests',{...jsonPost(command),signal,cache:'no-store'});
   await loadNpcFolder({search,projectId,signal,request,post,submitOneStop,submitPlanning:submitOneStop,note,items,detail,workspace});
   return;
  }
  if(tab==='concept'&&projectId==='binari'){
   const submit=command=>fetch('/api/requests',{...jsonPost(command),signal,cache:'no-store'});
   conceptActions=createConceptCategoryActions({modalOwner:workspace,projectId,signal,submit});
   if(item){
    note('파일 비교 중');
    const result=await syncConceptDetail({projectId,item,post,readIndex:()=>request(api()),signal});
    if(!result)return;
    if(result.selected)await readLocal();else await displayLocal(result.index);
    note('');
    return;
   }
  }
  const data=await readLocal();
  if(signal.aborted)return;
  // A flat motion preset has no item subtree. Do not refresh all of its sibling presets.
  const scope=item?data.item?.scope:data.scope;
  if(typeof scope!=='string'||!scope){note('');return;}
  note('파일 비교 중');
  try{
   const comparison=await post('compare',{scope});
   if(signal.aborted)return;
   if(comparison.groups.length)note('동기화 중');
   const results=await Promise.allSettled(comparison.groups.map(group=>post('refresh',{scope,folder:group.folder})));
   if(signal.aborted)return;
   if(results.some(result=>result.status==='fulfilled'))await readLocal();
   if(comparison.unavailable?.length||results.some(result=>result.status==='rejected')){
    note('일부 파일을 갱신하지 못했습니다. 기존 사본을 표시합니다.',true);
   }else note('');
  }catch{note('파일을 갱신하지 못했습니다. 기존 사본을 표시합니다.',true);}
 }catch{
  if(signal.aborted)return;
  note('프로젝트 자료를 읽지 못했습니다.',true);
  const back=nodeOf('a','','프로젝트 목록으로 돌아가기');back.href='/';
  detail.replaceChildren(nodeOf('h3','',label),back);
 }
}

function route(){
 const search=new URLSearchParams(location.search);
 if(search.get('projectId'))void loadWorkspace(search);
 else void load();
}
document.querySelector('#reload').addEventListener('click',load);
window.addEventListener('pageshow',event=>{if(event.persisted)route();});
window.addEventListener('pagehide',()=>run?.abort());
route();
