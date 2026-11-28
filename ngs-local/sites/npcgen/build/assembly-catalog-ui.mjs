import {browserRequestId} from './browser-request-id.mjs';
import {mountCatalogRosterEdit} from './catalog-roster-edit.mjs';
import {assemblyPath,assemblyPuzzleType,spiritPuzzleType,validAssemblyRequest} from './assembly-contract.mjs';
import {isQueuedRequest} from './local-request-queue-browser.mjs';
import {decorationArt} from './assembly-sprite-layout.mjs';
import {mountWellAssembly} from './well-assembly-ui.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const field=(label,node)=>{const n=el('label',label,'prop-form-field');n.append(node);return n;};
const keyOf=text=>text.normalize('NFC').trim().toLocaleLowerCase();

export async function mountAssemblyCatalog({items,detail,tools,request,projectId,item,panel,navigate,signal,submit,deleteItem,updateEnabled,puzzleCoreVersion}){
 const q=new URLSearchParams({projectId}),api=assemblyPath+'?'+q;
 const [catalog,{maps}]=await Promise.all([request(api),request('/api/map-workspace?'+q)]);
 let {assemblies}=catalog;
 if(signal.aborted)return;
 if(!Array.isArray(assemblies)||!Array.isArray(maps))throw Error('ASSEMBLY_CATALOG');
 const search=el('input',null,'npc-search');search.id='assembly-search';search.type='search';search.maxLength=120;search.placeholder='조립 이름 검색';
 const label=el('label','조립 검색','npc-search-label');label.htmlFor=search.id;
 items.parentElement.classList.add('npc-roster-list');
 const storageKey='ngs:assembly-search:'+projectId;
 try{search.value=sessionStorage.getItem(storageKey)??'';}catch{}
 items.before(label,search);
 let edit;
 function draw(){
  const text=keyOf(search.value);
  const rows=assemblies.filter(row=>keyOf(row.title).includes(text)).map(row=>{
   const li=el('li'),a=el('a',null,'request-item npc-roster-entry');a.href=navigate({item:row.assemblyId});
   if(row.assemblyId===item)a.setAttribute('aria-current','page');
   a.append(el('strong',row.title),el('span','리비전 '+row.revision,'meta'));li.append(a);
   edit?.decorate(li,row.assemblyId,row.title,{revision:row.revision,officialRequestId:row.officialRequestId});return li;
  });
  const top=items.scrollTop;items.replaceChildren(...(rows.length?rows:[el('li',text?'검색 결과가 없습니다.':'아직 게시된 조립본이 없어요.','meta')]));
  edit?.refresh();items.scrollTop=top;
 }
 search.addEventListener('input',()=>{try{sessionStorage.setItem(storageKey,search.value);}catch{}draw();},{signal});
 signal.addEventListener('abort',()=>{label.remove();search.remove();},{once:true});draw();
 const info=el('p',null,'meta');info.setAttribute('role','status');
 if(submit){
  const create=el('button','+','npc-one-stop-trigger');create.type='button';create.title='정식 조립 생성';create.setAttribute('aria-label',create.title);
  create.disabled=!maps.length;
  tools.replaceChildren(create);tools.hidden=false;
  create.addEventListener('click',()=>{
   const dialog=el('dialog',null,'prop-workspace-dialog'),form=el('form'),title=el('input'),map=el('select'),intent=el('textarea'),error=el('p',null,'meta');
   title.required=true;title.maxLength=100;title.placeholder='예: 굿터 · 물 올리기';
   intent.maxLength=2000;intent.rows=3;intent.placeholder='배치 의도가 있으면 남겨 주세요.';
   for(const row of maps){const o=el('option',row.title);o.value=row.mapId;map.append(o);}
   const puzzleFields=el('div',null,'assembly-request-puzzles'),newPuzzle=el('button','퍼즐 추가','prop-control');newPuzzle.type='button';
   const proof=el('input');proof.type='checkbox';
   const proofChoice=puzzleCoreVersion&&document.documentElement.dataset.puzzleCore===puzzleCoreVersion?field('공용 C# 코어 검증 · 물 올리기 하나',proof):null;
   const entries=[];let props=null,catalogJob=null;
   const loadProps=()=>catalogJob??=request('/api/prop-workspace?'+q).then(v=>{
    if(!Array.isArray(v.props))throw Error('ASSEMBLY_PROP_CATALOG_MISSING');
    return props=v.props;
   }).catch(e=>{catalogJob=null;throw e;});
   const pin=row=>({propId:row.propId,revision:row.revision,sha256:row.sha256});
   function addPuzzle(){
    if(entries.length>=8)return;
    const group=el('fieldset'),legend=el('legend'),type=el('select'),note=el('textarea'),drop=el('button','이 퍼즐 빼기','prop-control');
    for(const [label,value] of [['굿상에 물 올리기',assemblyPuzzleType],['영물 현현',spiritPuzzleType]]){
     const o=el('option',label);o.value=value;type.append(o);
    }
    const art=el('select'),artWrap=field('영물로 쓸 프랍 (필수)',art),tip=el('p','능력 ON으로 발견하고 F로 활성화하면 OFF에서도 보이는 고정 퍼즐이에요. 위치와 크기는 요청을 보고 배치해요.','meta');
    const choose=caption=>{const first=el('option',caption);first.value='';art.replaceChildren(first);};
    choose('프랍 선택');artWrap.hidden=tip.hidden=true;
    const refreshSpirit=async()=>{
     const spirit=type.value===spiritPuzzleType;
     artWrap.hidden=tip.hidden=!spirit;art.required=spirit;
     if(!spirit||art.options.length>1)return;
     choose('프랍 목록 불러오는 중…');
     try{
      const list=await loadProps();if(signal.aborted||!group.isConnected)return;
      choose('프랍 선택');
      for(const p of [...list].sort((a,b)=>Number(/부적|방울|종/.test(b.title))-Number(/부적|방울|종/.test(a.title)))){
       const o=el('option',p.title);o.value=p.propId;art.append(o);
      }
     }catch{choose('프랍 목록을 읽지 못했어요');error.textContent='퍼즐 종류를 다시 선택하면 프랍 목록을 다시 불러와요.';}
    };
    type.addEventListener('change',()=>{error.textContent='';void refreshSpirit();},{signal});
    note.rows=2;note.maxLength=1000;note.placeholder='이 퍼즐의 구역·배치·연결 요청';
    drop.type='button';group.append(legend,field('퍼즐 종류',type),artWrap,field('퍼즐별 요청 사항',note),tip,drop);
    const row={id:'puzzle-'+browserRequestId(),type,note,art,drop,group,legend};entries.push(row);puzzleFields.append(group);
    function counts(){
     entries.forEach((entry,i)=>{entry.legend.textContent='퍼즐 '+(i+1);entry.drop.disabled=entries.length===1;});
     newPuzzle.disabled=entries.length>=8;
    }
    drop.addEventListener('click',()=>{if(entries.length<=1)return;entries.splice(entries.indexOf(row),1);group.remove();counts();},{signal});
    counts();
   }
   newPuzzle.addEventListener('click',addPuzzle,{signal});addPuzzle();
   const send=el('button','정식 생성 요청','prop-control'),close=el('button','취소','prop-control'),actions=el('div',null,'prop-actions');
   close.type='button';send.type='submit';actions.append(send,close);
   const heading=el('h3','조립 생성');heading.id='assembly-create-title';dialog.setAttribute('aria-labelledby',heading.id);
   form.append(field('조립 이름',title),field('맵',map),field('통합 요청 사항',intent),...(proofChoice?[proofChoice]:[]),puzzleFields,newPuzzle,actions,error);
   dialog.append(heading,form);detail.append(dialog);dialog.showModal();title.focus();
   dialog.addEventListener('close',()=>{dialog.remove();if(!signal.aborted)create.focus();},{once:true});
   close.addEventListener('click',()=>dialog.close(),{signal});
   signal.addEventListener('abort',()=>{if(dialog.open)dialog.close();},{once:true});
   let last;
   form.addEventListener('submit',async e=>{
    e.preventDefault();if(send.disabled)return;
    const generateSpirit=entries.some(x=>x.type.value===spiritPuzzleType);
    const selected=entries.map(({id,type,note,art})=>{
     const row=type.value===spiritPuzzleType&&props?.find(p=>p.propId===art.value);
     return {id,type:type.value,intent:note.value.trim(),...(row?{prop:pin(row)}:{})};
    });
    const payload={schemaVersion:proof.checked?'ngs.assembly-generate.v4':generateSpirit?'ngs.assembly-generate.v3':'ngs.assembly-generate.v2',projectId,title:title.value.trim(),mapId:map.value,
     intent:intent.value.trim()||'선택한 맵에서 퍼즐별 필수 프랍을 연결해 플레이 가능한 배치를 구성해 주세요.',puzzles:selected};
    if(!validAssemblyRequest(payload,'assembly.generate')){error.textContent=proof.checked?'C# 검증 요청에는 물 올리기 퍼즐 하나와 조립 이름, 맵이 필요해요.':'조립 이름과 맵, 영물 퍼즐마다 사용할 프랍을 선택하세요.';return;}
    const body=JSON.stringify(payload);if(last?.body!==body)last={body,key:browserRequestId()};
    send.disabled=close.disabled=true;
    try{
     const candidates=[...new Map(selected.filter(p=>p.prop).map(p=>[p.prop.propId,p.prop])).values()];
     const paired=await Promise.all(candidates.map(async p=>{
      const {prop}=await request('/api/prop-workspace?'+new URLSearchParams({projectId,propId:p.propId}));
      const a=decorationArt(prop,p);return Boolean(a?.pixel&&a.cinematic);
     }));
     if(!paired.every(Boolean)){error.textContent='영물에는 픽셀과 시네마틱 배치 이미지가 모두 있는 최신 프랍이 필요해요.';return;}
     if(signal.aborted)return;
     const r=await submit({requestType:'assembly.generate',idempotencyKey:last.key,payload}),v=await r.json();
     if(!isQueuedRequest(r,v))throw Error('ASSEMBLY_QUEUE_FAILED');
     error.textContent='정식 생성 요청이 접수됐어요. 게시되는 대로 조립 목록을 새로 열어 확인하세요.';
     info.textContent=error.textContent;
     dialog.close();
    }catch{error.textContent='요청 접수를 확인하지 못했어요. 다시 시도해 주세요.';}
    finally{send.disabled=close.disabled=false;}
   },{signal});
  },{signal});
 }
 if(deleteItem){
  const pending=new Set();let polling=false;
  edit=mountCatalogRosterEdit({items,tools,signal,deleteItem:async row=>{await deleteItem(row);pending.add(row.id);},
   deleteMessage:'선택한 조립본만 삭제해요. 연결한 맵과 프랍은 남습니다. 조립본마다 정식 삭제 요청 1건을 보내요.'});
  draw();
  const timer=setInterval(async()=>{
   if(!pending.size||polling||signal.aborted||document.hidden)return;
   polling=true;
   try{
    const next=(await request(api)).assemblies;if(signal.aborted||!Array.isArray(next))return;
    const live=new Set(next.map(row=>row.assemblyId));
    let changed=false;for(const id of pending)if(!live.has(id)){pending.delete(id);changed=true;}
    if(changed){assemblies=next;draw();if(item&&!live.has(item))location.assign(navigate({item:'',assemblyTab:''}));}
   }catch{}finally{polling=false;}
  },3000);
  signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
 }
 if(!item){
  detail.replaceChildren(el('h3','조립·플레이'),el('p',submit?'왼쪽 목록에서 게시된 조립본을 열거나 +로 새 조립을 요청하세요.':'정식 조립 요청 기능의 연결을 확인하는 중이에요.','meta'),info);
  return;
 }
 const {assembly}=await request(api+'&item='+encodeURIComponent(item));if(signal.aborted)return;
 const active=panel==='story'?'story':'puzzles';
 const tabs=el('nav',null,'npc-detail-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','조립 편집 영역');
 for(const [id,title] of [['puzzles','퍼즐 배치'],['story','스토리·연출 연결']]){
  const tab=el('a',title);tab.href=navigate({item,assemblyTab:id==='story'?'story':''});tab.setAttribute('role','tab');
  tab.id='assembly-tab-'+id;tab.setAttribute('aria-selected',String(active===id));tab.setAttribute('aria-controls','assembly-tab-panel');tabs.append(tab);
 }
 const body=el('section',null,'npc-tab-panel');body.id='assembly-tab-panel';body.setAttribute('role','tabpanel');body.setAttribute('aria-labelledby','assembly-tab-'+active);
 detail.replaceChildren(tabs,info,body);
 if(active==='puzzles')await mountWellAssembly({items,detail:body,request,projectId,signal,published:assembly,submit,updateEnabled});
 else body.append(el('h3','스토리·연출 연결'),el('p','이 탭은 별도 스토리 연결 메타가 들어갈 자리예요. 현재는 퍼즐 배치만 저장할 수 있어요. 앞으로 스토리 페이즈, NPC·대사·연출은 퍼즐과 구역을 ID로 참조해요.','meta'));

}
