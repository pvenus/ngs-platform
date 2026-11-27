import {mountMapWorkspace} from './map-workspace-ui.mjs';
import {fileDeleteType,propFolderDeletePayload,npcFolderDeletePayload,backgroundDeletePayloads,cinematicDeletePayloads,mapFolderDeletePayload,assemblyFolderDeletePayload} from './prop-folder-delete-contract.mjs';
import {mountCinematicWorkspace,mountBackgroundWorkspace} from './cinematic-workspace-ui.mjs';
import {cinematicType} from './cinematic-contract.mjs';
import {mountPropWorkspace} from './prop-workspace-ui.mjs';
import {validPropActions,propAnimationRemoveType,propAnimationRemoveSchema} from './prop-workspace-contract.mjs';
import {conceptDetailOperations,conceptMarkdown,createConceptCategoryActions,syncConceptDetail} from './local-concept-category-ui.mjs';
import {audioIndex,followAcceptedAudioResult,followDeletedAudioResults,mountAudioWorkspace,readAudioSoundConcepts,refreshAudioResults,showAudioResults} from './local-audio-workspace.mjs';
import {loadNpcFolder} from './local-npc-workspace-ui.mjs';
import {isQueuedRequest,submitQueuedRequest} from './local-request-queue-browser.mjs';
import {motionConversionForm,motionPresetConvertType} from './motion-preset-convert-2d.mjs';

/* Project-list lifecycle only: local cards first, one stale comparison, separate applies. */
const cards=new Map(),states=new Map(),progress=new Map(),cardNodes=new Map();
const grid=document.querySelector('#projects'),status=document.querySelector('#status');
const label={refreshing:'파일 비교 중',failed:'갱신하지 못했습니다.'};
const numbers=new Intl.NumberFormat('ko-KR');
let run;
const queuePanel=document.querySelector('#local-request-queue');
const queueLabel={
 [cinematicType]:'시네마틱 영상 생성',
 'cinematic.sequence.generate':'PNG 시네마틱 생성','cinematic.playback.update':'시네마틱 메타 수정',
 'cinematic.source.generate':'시네마틱 원본 이미지 생성','background.source.generate':'배경 원본 이미지 생성','cinematic.sequences.remove':'시네마틱 애니메이션 제거','prop.animation.remove':'프랍 애니메이션 제거',
 'npc.workflow':'NPC 종합 생성','npc.planning.add':'NPC 기획 추가','npc.planning.update':'NPC 기획 수정',
 'concept.category.workflow':'마스터 컨셉 요청','audio.generate':'BGM 생성','audio.delete':'BGM 삭제','audio.separate':'BGM 반주 만들기',
 [motionPresetConvertType]:'2D 마네킹 프리셋 변환','prop.generate':'프랍 종합 생성','prop.regenerate':'프랍 재생성','prop.animation.generate':'프랍 애니메이션 생성',
};
const queueTime=new Intl.DateTimeFormat('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit'});
let queueSession,queueRefresh=()=>{};
function enableQueue(signal){
 if(queueSession===signal)return;
 queueSession=signal;
 const list=queuePanel.querySelector('ul'),state=queuePanel.querySelector('p');
 let timer,busy=false,again=false;
 async function refresh(){
  if(busy){again=true;return;}
  if(!queuePanel.open||signal.aborted)return;
  clearTimeout(timer);busy=true;
  try{
   const response=await fetch('/api/requests',{cache:'no-store',credentials:'same-origin',redirect:'error',signal});
   if(!response.ok)throw Error('QUEUE_UNAVAILABLE');
   const {requests}=await response.json();
   if(signal.aborted)return;
   const label=requests.length?'RS 등록 대기 '+requests.length+'건':'대기 중인 요청이 없습니다.';
   if(state.textContent!==label)state.textContent=label;
   const rows=requests.map(item=>nodeOf('li','',item.projectId+' · '+(queueLabel[item.requestType]??item.requestType)+' · '+queueTime.format(item.queuedAt)));
   list.replaceChildren(...rows);
  }catch{if(!signal.aborted){state.textContent='요청 대기열을 읽지 못했습니다.';list.replaceChildren();}}
  finally{
   busy=false;
   if(queuePanel.open&&!signal.aborted){timer=setTimeout(refresh,again?0:2000);again=false;}
  }
 }
 queuePanel.hidden=false;queueRefresh=refresh;
 queuePanel.addEventListener('toggle',()=>{if(queuePanel.open)void refresh();else clearTimeout(timer);},{signal});
 signal.addEventListener('abort',()=>{
  clearTimeout(timer);queueRefresh=()=>{};queuePanel.hidden=true;queuePanel.open=false;
  state.textContent='';list.replaceChildren();
 },{once:true});
}


const syncStates=new Set(['idle','syncing','completed','partial','failed']);
// Local and Space currently publish sync lifecycle for this configured scope.
// Endpoint authorization (not catalog visibility) determines who may see it.
const syncReplicaProject='binari';
const syncCatalogProjects=rows=>rows.filter(row=>row?.projectId===syncReplicaProject).slice(0,1);
const syncCatalogOrPending=rows=>syncCatalogProjects(rows).length?syncCatalogProjects(rows):[{projectId:syncReplicaProject}];
const syncProgressPollMs=2500;
const syncProgressDoneMs=20000;
function safeSyncProgress(row){
 if(!row||typeof row!=='object'||Array.isArray(row)||
    Object.keys(row).sort().join(',')!=='completed,failed,fileName,percent,state,total'||!syncStates.has(row.state)||
    ![row.completed,row.total,row.failed].every(n=>Number.isSafeInteger(n)&&n>=0)||
    row.completed>row.total||row.failed>row.total-row.completed||
    row.percent!==null&&(typeof row.percent!=='number'||!Number.isFinite(row.percent)||row.percent<0||row.percent>100)||
    row.fileName!==null&&(typeof row.fileName!=='string'||!row.fileName.isWellFormed()||!row.fileName.trim()||
     row.fileName==='.'||row.fileName==='..'||row.fileName.length>260||/[\/\\\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(row.fileName)))return null;
 if(row.state==='idle'&&(row.fileName!==null||row.percent!==null||row.completed||row.total||row.failed)||
    row.state==='completed'&&(row.failed||row.completed!==row.total))return null;
 return row;
}

function watchSyncProgress(slot,signal,{home=false}={}){
 if(!slot)return {projects(){}};
 const entries=new Map();
 let timer,busy=false;
 const active=()=>!signal.aborted&&!document.hidden;
 function render(){
  const nodes=[];
  for(const entry of entries.values()){
   const row=entry.row;
   if(!row||row.state==='idle'||row.state==='completed'&&Date.now()-entry.terminalAt>=syncProgressDoneMs)continue;
   const stateLabels={syncing:'동기화 중',completed:'동기화 완료',partial:'일부 파일 미완료',failed:'동기화 실패'};
   const wrap=nodeOf('div','ngs-sync-progress-row ngs-sync-'+row.state);
   const header=nodeOf('div','ngs-sync-progress-line');
   const prefix=(home&&entry.label?entry.label+' · ':'')+stateLabels[row.state];
   header.append(nodeOf('strong','ngs-sync-project',prefix));
   if(row.fileName)header.append(nodeOf('span','ngs-sync-file',row.fileName));
   if(row.fileName&&row.percent!==null)header.append(nodeOf('span','ngs-sync-file-percent',numbers.format(Math.floor(row.percent))+'%'));
   header.append(nodeOf('span','ngs-sync-count','완료 '+numbers.format(row.completed)+'/'+numbers.format(row.total)));
   if(row.failed)header.append(nodeOf('span','ngs-sync-failures','실패 '+numbers.format(row.failed)));
   wrap.append(header);
   if(row.state==='syncing'){
    const bar=nodeOf('progress','ngs-sync-meter');
    bar.max=100;
    if(row.fileName&&row.percent!==null)bar.value=row.percent;
    bar.setAttribute('aria-label',row.fileName?'현재 파일 진행률':'파일 동기화 진행 중');
    wrap.append(bar);
   }
   nodes.push(wrap);
  }
  slot.replaceChildren(...nodes);slot.hidden=nodes.length===0;
 }
 function schedule(){
  clearTimeout(timer);
  if(active()&&[...entries.values()].some(entry=>!entry.unsupported))timer=setTimeout(poll,syncProgressPollMs);
 }
 async function poll(){
  clearTimeout(timer);
  if(!active()||busy)return;
  busy=true;
  try{
   await Promise.all([...entries].map(async ([projectId,entry])=>{
    if(entry.unsupported)return;
    try{
     const url='/api/ngs-sync-progress?'+new URLSearchParams({projectId});
     const response=await fetch(url,{cache:'no-store',credentials:'same-origin',redirect:'error',
      signal:AbortSignal.any([signal,AbortSignal.timeout(8000)])});
     if(signal.aborted)return;
     if([401,403,404].includes(response.status)){
      entry.row=null;entry.unsupported=true;return;
     }
     const row=response.ok?safeSyncProgress(await response.json()):null;
     if(!row)throw Error('NGS_SYNC_PROGRESS_UNAVAILABLE');
     if(row.state==='completed'&&entry.row?.state!=='completed')entry.terminalAt=Date.now();
     entry.row=row;entry.missed=0;
    }catch{
     // Unavailable or stale data must never look like a finished download.
     if(!signal.aborted&&++entry.missed>=2)entry.row=null;
    }
   }));
   if(active())render();
  }finally{busy=false;schedule();}
 }
 document.addEventListener('visibilitychange',()=>{
  if(active())void poll();else clearTimeout(timer);
 },{signal});
 signal.addEventListener('abort',()=>{
  clearTimeout(timer);slot.replaceChildren();slot.hidden=true;
 },{once:true});
 return {projects(rows){
  const wasEmpty=!entries.size;
  const known=new Set();
  for(const row of Array.isArray(rows)?syncCatalogProjects(rows):[]){
   const projectId=row?.projectId;
   if(projectId!==syncReplicaProject)continue;
   known.add(projectId);
   const entry=entries.get(projectId)??{row:null,missed:0};
   entry.label=typeof row.name==='string'?row.name:'';
   entries.set(projectId,entry);
  }
  for(const key of entries.keys())if(!known.has(key))entries.delete(key);
  if(wasEmpty&&entries.size)void poll();
  else if(!busy&&active()){render();schedule();}
 }};
}

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
   node.link.setAttribute('href',navigation({projectId:project.projectId,...(project.legacySpaceReplica?{catalogArea:'audio'}:{})}));
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


const spaceCatalogPath='/api/space/project-catalog';
const spaceTicket=/^space\.catalog\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const exact=(row,keys)=>row&&typeof row==='object'&&!Array.isArray(row)&&Object.keys(row).sort().join(',')===keys;
const queueSpaceSession='backend,contextId,csrfToken,queueEnabled,readOnly,requestWritable,state';
const spaceSession=value=>{
 const {npcBasicPortraitEnabled,poseSelectionV2Enabled,propActions,cinematicEnabled,cinematicSequenceEnabled,cinematicPlaybackEnabled,cinematicSourceEnabled,backgroundSourceEnabled,cinematicRemoveEnabled,propAnimationRemoveEnabled,mapReadEnabled,assemblyReadEnabled,fileUpdateEnabled,mapEnabled,assemblyEnabled,mapDeleteEnabled,assemblyDeleteEnabled,...session}=value??{};
 if([mapReadEnabled,assemblyReadEnabled].some(v=>v!==undefined&&(v!==true||session.workspaceReady!==true)))return false;
 if([fileUpdateEnabled,mapEnabled,assemblyEnabled,mapDeleteEnabled,assemblyDeleteEnabled,npcBasicPortraitEnabled,cinematicEnabled,cinematicSequenceEnabled,cinematicPlaybackEnabled,cinematicSourceEnabled,backgroundSourceEnabled,cinematicRemoveEnabled,propAnimationRemoveEnabled].some(v=>v!==undefined&&(v!==true||session.requestWritable!==true||session.workspaceReady!==true)))return false;
 if(propActions!==undefined&&(!validPropActions(propActions)||session.requestWritable!==true||session.workspaceReady!==true))return false;
 if(poseSelectionV2Enabled!==undefined&&poseSelectionV2Enabled!==true)return false;
 return session?.state==='authenticated'&&session.backend==='space'&&
 (exact(session,'backend,readOnly,state')&&session.readOnly===true||
  (exact(session,queueSpaceSession)||
   (exact(session,queueSpaceSession+',workspaceReady')||exact(session,'audioSeparationEnabled,'+queueSpaceSession+',workspaceReady')&&
    session.audioSeparationEnabled===true&&session.requestWritable===true)&&session.workspaceReady===true&&session.readOnly===false)&&
  session.queueEnabled===true&&typeof session.readOnly==='boolean'&&typeof session.requestWritable==='boolean'&&
  /^space\.[a-f0-9]{64}$/.test(session.contextId)&&/^[a-f0-9]{64}$/.test(session.csrfToken));
};
const spaceWorkspaceReady=session=>spaceSession(session)&&session.workspaceReady===true;

function workspaceTransport(session,request,signal){
 if(session.state!=='authenticated'||session.backend==='space'&&!spaceSession(session))throw Error('PROJECT_WORKSPACE_UNAVAILABLE');
 const hosted=spaceSession(session);
 const jsonPost=body=>({method:'POST',headers:{
  'Content-Type':'application/json','X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId,
 },body:JSON.stringify(body)});
 const post=hosted
  ?async name=>{if(name!=='compare')throw Error('SPACE_BROWSER_DOWNLOAD_FORBIDDEN');return {groups:[],unavailable:[]};}
  :(name,body)=>request('/api/folders/'+name,jsonPost(body));
 const submit=hosted&&!session.requestWritable?undefined:async command=>{
  const response=await submitQueuedRequest(command,{jsonPost,signal});
  if(response.status===202&&isQueuedRequest(response,await response.clone().json().catch(()=>null)))void queueRefresh();
  return response;
 };
 return {hosted,post,submit};
}
async function submitFolderDelete(submit,payload){
 const data=new TextEncoder().encode(JSON.stringify(payload));
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
 const response=await submit({requestType:fileDeleteType,idempotencyKey:'delete-catalog-folder:'+hash,payload});
 const value=await response.json().catch(()=>null);
 if(!isQueuedRequest(response,value))throw Error(value?.error??'CATALOG_FOLDER_DELETE_NOT_ACCEPTED');
}
function waitForSpaceCatalog(signal,delay=1250){
 return new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);reject(signal.reason);};
  if(signal.aborted){reject(signal.reason);return;}
  const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},delay);
  signal.addEventListener('abort',stop,{once:true});
 });
}
async function readSpaceCatalog(signal,show){
 const deadline=AbortSignal.timeout(52000),requestSignal=AbortSignal.any([signal,deadline]);
 const options={cache:'no-store',credentials:'same-origin',redirect:'error',signal:requestSignal};
 let requestId;
 for(let attempt=0;attempt<40;attempt++){
  const path=requestId?spaceCatalogPath+'?'+new URLSearchParams({requestId}):spaceCatalogPath;
  const init=requestId?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'};
  const response=await fetch(path,{...options,...init});
  if(response.status===401||response.status===403)throw Error('SPACE_CATALOG_AUTH');
  if(response.status===404&&requestId)throw Error('SPACE_CATALOG_EXPIRED');
  if(response.status!==200&&response.status!==202)throw Error('SPACE_CATALOG_UNAVAILABLE');
  const body=await response.json(),pending=response.status===202;
  if(!exact(body,pending?'requestId,status':'projects,requestId,status')||typeof body.requestId!=='string'||
     body.requestId.length!==50||!spaceTicket.test(body.requestId)||requestId&&body.requestId!==requestId||
     body.status!==(pending?'pending':'ready'))throw Error('SPACE_CATALOG_UNAVAILABLE');
  if(!pending){
   if(!Array.isArray(body.projects)||body.projects.length>1||body.projects.some(row=>
    !exact(row,'iconUrl,name,needsRefresh,projectId')||row.projectId!=='binari'||typeof row.name!=='string'||
    !row.name.trim()||row.name.length>120||row.iconUrl!==null||row.needsRefresh!==false))throw Error('SPACE_CATALOG_UNAVAILABLE');
   return body.projects;
  }
  requestId=body.requestId;
  show('Space에서 프로젝트 원본 목록을 기다리고 있습니다.');
  await waitForSpaceCatalog(requestSignal);
 }
 throw Error('SPACE_CATALOG_EXPIRED');
}

async function load(){
 run?.abort();
 run=new AbortController();
 const {signal}=run;
 const sync=watchSyncProgress(document.querySelector('#home-sync-progress'),signal,{home:true});
 states.clear();progress.clear();render();
 status.textContent=cards.size?'':'프로젝트를 불러오고 있습니다.';
 const sameOrigin=async(url,options={})=>{
  const response=await fetch(url,{cache:'no-store',signal,...options});
  if(!response.ok){
   if(url==='/__npcgen_session'&&response.status===503&&
      (await response.json().catch(()=>null))?.error==='LIVE_NGS_BACKEND_NOT_CONNECTED')throw Error('SPACE_CATALOG_UNAVAILABLE');
   throw Object.assign(Error('PROJECT_PAGE_READ_FAILED'),{accessDenied:[401,403].includes(response.status)});
  }
  return response.json();
 };
 try{
  const session=await sameOrigin('/__npcgen_session');
  if(session.backend==='space'&&!spaceSession(session))throw Error('SPACE_CATALOG_UNAVAILABLE');
  if(spaceSession(session)){
   if(session.queueEnabled===true)enableQueue(signal);
   cards.clear();render();
   const replica=!session.readOnly;
   let rows=replica?(await sameOrigin('/api/project-folders')).projects:
    await readSpaceCatalog(signal,text=>{if(!signal.aborted)status.textContent=text;});
   if(signal.aborted)return;
   if(!Array.isArray(rows))throw Error('SPACE_CATALOG_UNAVAILABLE');
   // Binari is the single configured hosted replica today. The same progress
   // endpoint independently enforces its project grant before a panel can show.
   if(replica)sync.projects(spaceWorkspaceReady(session)?syncCatalogOrPending(rows):syncCatalogProjects(rows));
   if(replica&&!rows.length){
    status.textContent='Space에서 프로젝트 파일을 기다리는 중입니다.';
    // The initial publication may finish after this page was opened. Only
    // check the authenticated existing view; never request a sync from here.
    for(let check=0;check<12&&!rows.length;check++){
     await waitForSpaceCatalog(signal,5000);
     if(signal.aborted)return;
     try{
      const result=await sameOrigin('/api/project-folders');
      if(!Array.isArray(result.projects))throw Error('SPACE_CATALOG_UNAVAILABLE');
      rows=result.projects;
     }catch(error){
      if(signal.aborted)return;
      if(error?.accessDenied)throw error;
      // A transient read failure during replica startup is not a project.
     }
    }
   }
   if(signal.aborted)return;
   if(replica)sync.projects(spaceWorkspaceReady(session)?syncCatalogOrPending(rows):syncCatalogProjects(rows));
   for(const row of rows)cards.set(row.projectId,replica&&!spaceWorkspaceReady(session)?{...row,legacySpaceReplica:true}:row);
   render();
   status.textContent=rows.length?'':replica?'프로젝트 파일이 아직 도착하지 않았습니다. 다시 조회할 수 있어요.':'원본에서 확인된 프로젝트가 없습니다.';
   return; // No hosted comparison or file transport from the browser.
  }
  if(session.state==='authenticated')enableQueue(signal);
  const post=(path,body)=>sameOrigin('/api/project-folders/'+path,{method:'POST',headers:{
   'Content-Type':'application/json','X-NPCGen-Csrf':session.csrfToken,'X-NPCGen-Frontend-Context':session.contextId,
  },body:JSON.stringify(body)});
  const local=await sameOrigin('/api/project-folders');
  if(signal.aborted)return;
  cards.clear();
  if(session.state==='authenticated')sync.projects(syncCatalogOrPending(local.projects));
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
  if(session.state==='authenticated')sync.projects(syncCatalogOrPending([...cards.values()]));

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
  if(!signal.aborted){
   const hint={
    SPACE_CATALOG_AUTH:'Space에서 프로젝트 조회 권한을 확인하지 못했습니다.',
    SPACE_CATALOG_UNAVAILABLE:'Space에서 프로젝트 원본에 연결하지 못했습니다. 다시 조회해 주세요.',
    SPACE_CATALOG_EXPIRED:'프로젝트 목록 응답이 아직 없습니다. 다시 조회해 주세요.',
   }[error.message]??(error.name==='TimeoutError'?'프로젝트 목록 응답이 아직 없습니다. 다시 조회해 주세요.':null);
   status.textContent=hint??(cards.size?'기존 목록을 유지합니다.':'프로젝트를 불러오지 못했습니다.');
  }
 }
}

const areas=[
 ['concept','마스터 컨셉',true],['story','스토리 설계',false],['assembly','조립·플레이',true],
 ['npcs','NPC 설계',true],['motion-presets','모션 프리셋',true],['production','퍼즐 설계',['puzzleWorkspace','wellPuzzleDemo'].some(key=>document.documentElement?.dataset[key]==='enabled')],
 ['cinematic','시네마틱 영상',true],['resources','배경 설계',true],['maps','맵 제작',true],['props','프랍 설계',true],['audio','음원 설계',document.documentElement?.dataset.audioWorkspace==='enabled'],['docs','작성 참고',false],
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
 let conceptActions=null,motionSubmit;
 const supported=(area,enabled)=>enabled&&(!['audio','production','assembly','props','cinematic'].includes(area)||projectId==='binari');
 const [_,label,enabled]=areas.find(([id])=>id===tab)??['','프로젝트',false];
 document.querySelector('#items-title').textContent=tab==='audio'&&supported(tab,enabled)?'음원 종류':tab==='props'?'프랍':tab==='cinematic'?'장면':tab==='resources'?'배경':tab==='maps'?'맵':'항목';
 document.querySelector('#app').classList.remove('project-home');
 workspace.classList.toggle('npc-folder-workspace',['npcs','props','cinematic','resources','maps'].includes(tab));
 document.querySelector('#project-home').hidden=true;
 for(const id of ['#project-workspace','#workspace-identity','#workspace-tools'])document.querySelector(id).hidden=false;
 document.querySelector('#workspace-title').textContent=projectId;
 document.querySelector('#workspace-icon').textContent=projectId.slice(0,2);
 document.querySelector('#area-title').textContent=label;
 const renderNav=filter=>nav.replaceChildren(...areas.map(([id,name,active])=>{
  const available=supported(id,active)&&filter(id);
  const link=nodeOf(available?'a':'span',available?'':'unavailable-area');
  if(available){link.href=navigation({projectId,catalogArea:id});if(id===tab)link.setAttribute('aria-current','page');}
  else link.setAttribute('aria-disabled','true');
  link.append(navIcon(id),nodeOf('span','',name));
  if(!available)link.append(nodeOf('small','','미연결'));
  return link;
 }));
 renderNav(()=>true);
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
 function renderMotionPreset(selected,preset,itemRows){
  const directions=preset?.directions;
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
  const variant=preset?.variant?.kind==='2d'?preset.variant:null;
  const form=variant?null:motionConversionForm({projectId,preset:preset?.presetId===selected.id?preset:null,
   publishedIds:new Set((Array.isArray(itemRows)?itemRows:[]).map(row=>String(row.id).toLowerCase())),submit:motionSubmit,signal});
  const marker=variant?nodeOf('p','meta','2D 마네킹 변환 결과 · 원본 프리셋: '+variant.sourcePresetId):null;
  detail.replaceChildren(nodeOf('h3','',selected.label),nodeOf('p','meta','Filex 사본 · 읽기 전용'),
   ...(marker?[marker]:[]),...(form?[form]:[]),compass);
 }
 async function renderDetail(data){
  const selected=data.item;
  if(!selected){
   detail.replaceChildren(nodeOf('h3','',label),nodeOf('p','meta',item?'선택한 항목이 현재 사본에 없습니다.':'왼쪽 목록에서 항목을 선택하세요.'));
   return;
  }
  if(tab==='motion-presets'){renderMotionPreset(selected,data.motionPreset,data.items);return;}
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
 async function displayWorkspace(data){
  if(signal.aborted)return;
  renderList(data.items);
  if(conceptActions){listToolbar.replaceChildren(conceptActions.trigger('add',{groups:data.groups??[]}));listToolbar.hidden=false;}
  await renderDetail(data);
 }
 async function readWorkspace(){
  const data=await request(api(item?{item}:{}));
  await displayWorkspace(data);
  return data;
 }
 try{
  note('항목을 읽고 있습니다.');
  const session=await request('/__npcgen_session');
  const {hosted,post,submit}=workspaceTransport(session,request,signal);
  const legacySpace=hosted&&!spaceWorkspaceReady(session);
  if(!legacySpace)motionSubmit=submit;
  if(hosted){
   if(session.queueEnabled===true)enableQueue(signal);
   const filter=id=>projectId==='binari'&&!session.readOnly&&(!legacySpace||id==='audio')&&
    (id!=='maps'||session.mapReadEnabled===true)&&(id!=='assembly'||session.assemblyReadEnabled===true);
   renderNav(filter);
   if(!filter(tab)){
    note(session.readOnly?'Space에서는 현재 프로젝트 목록만 연결되어 있습니다. 상세 작업은 로컬 NGS에서 계속할 수 있습니다.':
     '이 메뉴는 아직 Space에 연결되지 않았습니다. 상세 작업은 로컬 NGS에서 계속할 수 있습니다.');
    const home=nodeOf('a','','프로젝트 목록으로 돌아가기');home.href='/';
    detail.replaceChildren(nodeOf('h3','',label),home);
    return;
   }
  }else enableQueue(signal);
  watchSyncProgress(document.querySelector('#workspace-sync-progress'),signal).projects([{projectId}]);
  // Same metadata and workspace routes in both environments; only the replica
  // transfer differs. Hosted receives already-published versions from Mac.
  void request('/api/project-folders').then(data=>showHeader(data.projects?.find(row=>row.projectId===projectId))).catch(()=>{});
  if(tab==='maps'){
   const deleteItem=session.mapDeleteEnabled===true&&submit?row=>submitFolderDelete(submit,mapFolderDeletePayload(row)):undefined;
   await mountMapWorkspace({items,detail,tools:listToolbar,request,submit,projectId,item,navigate:next,signal,deleteItem,enabled:session.mapEnabled===true,updateEnabled:session.fileUpdateEnabled===true});
   if(!signal.aborted)note('');
   return;
  }
  if(tab==='resources'){
   const deleteItem=!hosted&&session.backgroundDeleteEnabled===true&&submit?async row=>{
    // Each accepted request owns one physical object. Stable idempotency keys
    // let the user retry a lost second intake without duplicating the first.
    for(const payload of backgroundDeletePayloads(row))await submitFolderDelete(submit,payload);
   }:undefined;
   await mountBackgroundWorkspace({items,detail,tools:listToolbar,request,submit,projectId,item,navigate:next,signal,deleteItem,
    enabled:hosted&&session.backgroundSourceEnabled===true,pixelEnabled:!hosted&&session.backgroundPixelEnabled===true,
    panel:search.get('cineTab'),animationEnabled:!hosted&&session.backgroundAnimationEnabled===true});
   if(!signal.aborted)note('');
   return;
  }
  if(tab==='cinematic'){
   const deleteItem=!hosted&&session.cinematicDeleteEnabled===true&&submit?async row=>{
    const query=new URLSearchParams({projectId,sourceSha256:row.id});
    const inventory=await request('/api/cinematic-delete-inventory?'+query);
    for(const payload of cinematicDeletePayloads(row.id,inventory))await submitFolderDelete(submit,payload);
   }:undefined;
   await mountCinematicWorkspace({items,detail,tools:listToolbar,request,submit,projectId,item,source:search.get('cineSource'),panel:search.get('cineTab'),navigate:next,signal,deleteItem,enabled:session.cinematicSequenceEnabled===true,playbackEnabled:session.cinematicPlaybackEnabled===true,sourceEnabled:session.cinematicSourceEnabled===true,removeEnabled:session.cinematicRemoveEnabled===true});
   if(!signal.aborted)note('');
   return;
  }
  if(tab==='props'){
   const removeAnimations=session.propAnimationRemoveEnabled===true&&submit?async({propId,source,animationIds})=>{
    const motionIds=[...animationIds].sort();
    const data=new TextEncoder().encode(JSON.stringify([propId,source.revision,source.sha256,motionIds]));
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),n=>n.toString(16).padStart(2,'0')).join('');
    const response=await submit({requestType:propAnimationRemoveType,idempotencyKey:'prop-remove:'+hash,payload:{schemaVersion:propAnimationRemoveSchema,projectId,propId,source,motionIds}});
    const value=await response.json().catch(()=>null);
    if(!isQueuedRequest(response,value))throw Error(value?.error??'PROP_ANIMATION_REMOVE_NOT_ACCEPTED');
    return {accepted:true};
   }:undefined;
   const deleteItem=!hosted&&session.propFolderDeleteEnabled===true&&submit?
    row=>submitFolderDelete(submit,propFolderDeletePayload(row)):undefined;
   await mountPropWorkspace({items,detail,tools:listToolbar,item,propTab:search.get('propTab'),propAnimation:search.get('propAnimation'),navigate:next,request,submit,removeAnimations,deleteItem,actions:session.propActions??[],signal});
   if(!signal.aborted)note('');
   return;
  }
  if(tab==='assembly'){
   const {mountAssemblyCatalog}=await import('./assembly-catalog-ui.mjs');
   const deleteItem=session.assemblyDeleteEnabled===true&&submit?row=>submitFolderDelete(submit,assemblyFolderDeletePayload(row)):undefined;
   if(!signal.aborted)await mountAssemblyCatalog({items,detail,tools:listToolbar,request,projectId,item,panel:search.get('assemblyTab'),navigate:next,signal,deleteItem,submit:session.assemblyEnabled?submit:undefined});
   if(!signal.aborted)note('');
   return;
  }
  if(tab==='production'){
   // An independent Local puzzle, never an episode link or a legacy API.
   if(hosted)return;
   const id='binari.empty-veranda',title='빈 마루에 바람이 앉으면';
   const demo=document.documentElement.dataset.wellPuzzleDemo==='enabled'?await import('./well-puzzle-demo.mjs'):null;
   if(signal.aborted)return;
   const wellDemoId=demo?.wellDemoId,wellDemoTitle=demo?.wellDemoTitle;
   const choices=[];
   if(document.documentElement.dataset.puzzleWorkspace==='enabled')choices.push([id,title]);
   if(demo)choices.push([wellDemoId,wellDemoTitle+' · 테스트']);
   const entries=choices.map(([key,label])=>{
    const entry=nodeOf('a','workspace-nav-item',label);entry.href=next({item:key});
    if(item===key)entry.setAttribute('aria-current','page');return entry;
   });
   items.replaceChildren(...entries);
   const heading=nodeOf('h3','',item===wellDemoId?wellDemoTitle:item===id?title:'퍼즐 설계');
   const description=nodeOf('p','meta',item===wellDemoId?'독립 플레이테스트 · 테스트 배경과 프랍으로 상태 및 상호작용을 검증합니다.':item===id?'별도의 이야기 연결 없이 이 퍼즐을 플레이할 수 있습니다.':'퍼즐을 선택하세요.');
   detail.replaceChildren(heading,description);
   if(item===wellDemoId)demo.mountWellPuzzleDemo(detail,{signal});
   if(item===id){
    const frame=nodeOf('iframe','local-puzzle-frame');
    frame.title=title+' 플레이테스트';
    frame.src='/local-puzzle/binari-empty-veranda/';
    detail.append(frame);
   }
   note('');
   return;
  }
  if(tab==='audio'){
   let busy=false,refreshEpoch=0;
   const removedResults=new Set();
   const options={request,refresh:()=>readAudio(true),...(submit?{submitDelete:submit,onDeleteAccepted:ids=>{
    void followDeletedAudioResults({ids,post,request,signal,onChanged:refreshPublished});
   },...(session.audioSeparationEnabled===true?{submitSeparation:submit,onSeparationAccepted:receipt=>{
    if(receipt.officialRequestId)void followAcceptedAudioResult({id:receipt.officialRequestId,post,request,signal,onChanged:refreshPublished});
   }}:{})}:{})};
   const display=(data,refreshOptions={})=>{
    if(data!==null&&removedResults.size){
     refreshOptions={...refreshOptions,force:true,removed:[...removedResults]};
     showAudioResults(library,data,signal,options,refreshOptions);
     removedResults.clear();
    }else showAudioResults(library,data,signal,options,refreshOptions);
   };
   async function refreshPublished(removed=[]){
    for(const id of removed)removedResults.add(id);
    const current=++refreshEpoch;
    try{
     const data=await request(audioIndex);
     if(!signal.aborted&&current===refreshEpoch)display(data,{force:true});
    }catch(error){if(!signal.aborted)note('게시된 BGM을 갱신하지 못했습니다.',true);throw error;}
   }
   const library=mountAudioWorkspace({items,detail,signal,allowFullLength:!hosted,...(submit?{submit,
    loadConcepts:legacySpace?async()=>(await request('/api/space/audio-concepts')).concepts:
     ()=>readAudioSoundConcepts({post,request,signal}),
    onAccepted:id=>{void followAcceptedAudioResult({id,post,request,signal,onChanged:refreshPublished});}}:{})});
   display(null);
   async function readAudio(force=false){
    if(busy||signal.aborted)return;
    busy=true;
    const current=++refreshEpoch;
    try{await refreshAudioResults({post,request,signal,display:data=>{if(current===refreshEpoch){display(data,{force});force=false;}}});if(current===refreshEpoch)note('');}
    catch{note('게시된 BGM을 갱신하지 못했습니다.',true);}
    finally{busy=false;}
   }
   await readAudio();
   if((hosted||session.audioSeparationEnabled===true)&&!signal.aborted){
    const timer=setInterval(readAudio,60_000);
    signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
   }
   return;
  }
  if(tab==='npcs'){
   const deleteItem=!hosted&&session.npcFolderDeleteEnabled===true&&submit?
    row=>submitFolderDelete(submit,npcFolderDeletePayload(row)):undefined;
   await loadNpcFolder({search,projectId,signal,request,post,submitOneStop:submit,submitPlanning:submit,note,items,detail,workspace,deleteItem,listTools:listToolbar,poseSelectionV2Enabled:session.poseSelectionV2Enabled===true,basicPortraitRequests:session.npcBasicPortraitEnabled===true,scopedPortraitRequests:!hosted&&session.npcScopedPortraitEnabled===true});
   return;
  }
  if(tab==='concept'&&projectId==='binari'){
   if(submit)conceptActions=createConceptCategoryActions({modalOwner:workspace,projectId,signal,submit});
   if(item&&!hosted){
    note('파일 비교 중');
    const result=await syncConceptDetail({projectId,item,post,readIndex:()=>request(api()),signal});
    if(!result)return;
    if(result.selected)await readWorkspace();else await displayWorkspace(result.index);
    note('');
    return;
   }
  }
  const data=await readWorkspace();
  if(signal.aborted)return;
  if(hosted){note('');return;}
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
   if(results.some(result=>result.status==='fulfilled'))await readWorkspace();
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
