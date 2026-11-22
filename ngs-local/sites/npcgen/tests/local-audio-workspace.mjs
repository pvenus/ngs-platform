import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openLocalRequestQueue} from '../build/local-request-queue.mjs';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import test from 'node:test';
import {createAudioIntake,followAcceptedAudioResult,followDeletedAudioResults,makeAudioPayload,mountAudioWorkspace,readAudioSoundConcepts,showAudioResults,soundConceptOptions,validLocalAudioPayload}
 from '../build/local-audio-workspace.mjs';
import {configuration,createLocalProjectPageServer} from '../build/local-project-page-server.mjs';

const concept={id:'category.sound-1',label:'마을 소리'},groups=[{id:'group.sound',title:'사운드'}];
const values={kind:'bgm',title:' 음악 ',conceptId:concept.id,brief:' 소리 설계 ',text:'ignored',duration:'10'};
const payload={schemaVersion:'ngs.audio-generate.v1',projectId:'binari',kind:'bgm',title:'음악',conceptId:concept.id,
 brief:'소리 설계',text:'',durationSeconds:10};
const speak={...payload,kind:'tts',text:'안녕하세요',durationSeconds:null};
const receipt={officialRequestId:'request.audio.fixture',status:'registered'};

test('only sorted-wire audio fields, active sound selections and bounded status reach form',()=>{
 assert.deepEqual(makeAudioPayload(values,[concept]),payload);
 assert.throws(()=>makeAudioPayload({...values,kind:'tts',text:' 안녕하세요 ',duration:'outside'},[concept]),/AUDIO_FORM_INVALID/);
 assert.throws(()=>makeAudioPayload({...values,kind:'effect',duration:'30'},[concept]),/AUDIO_FORM_INVALID/);
 assert.deepEqual(makeAudioPayload({...values,duration:'30'},[concept]),{...payload,durationSeconds:30});
 assert.deepEqual(makeAudioPayload({...values,duration:''},[concept]),{...payload,durationSeconds:null});
 assert.equal(validLocalAudioPayload({...payload,durationSeconds:null,text:'[Humming]\n음— 음—'}),true);
 assert.throws(()=>makeAudioPayload(values,[]),/AUDIO_FORM_INVALID/);
 for(const bad of [{...payload,title:'두\n줄'},{...payload,title:'\ud800'},
  {...payload,brief:'x'.repeat(4001)},{...payload,text:'speech'},{...payload,durationSeconds:31},
  {...payload,durationSeconds:Infinity},{...payload,durationSeconds:9.9},{...payload,durationSeconds:null,text:'x'.repeat(513)},
  speak,{...speak,durationSeconds:10},{...speak,model:'untrusted'}])assert.equal(validLocalAudioPayload(bad),false);
 const index={projectId:'binari',tab:'concept',groups,items:[
  {...concept,groupId:'group.sound'},{id:'other',label:'기획',groupId:'different'},
  {id:'archived',label:'보관',groupId:'group.sound',archived:true},
 ]};
 assert.deepEqual(soundConceptOptions(index),[concept]);
 assert.deepEqual(soundConceptOptions({...index,groups:[]}),[]);
});

test('full-length goal is opt-in, valid only with automatic length',()=>{
 const goal={...payload,durationSeconds:null,targetDurationSeconds:60};
 assert.deepEqual(makeAudioPayload({...values,duration:'',targetFullLength:true},[concept]),goal);
 assert.equal(validLocalAudioPayload(goal),true);
 assert.equal(validLocalAudioPayload({...goal,text:'음—'}),true);
 assert.equal(validLocalAudioPayload({...goal,targetDurationSeconds:59}),false);
 assert.equal(validLocalAudioPayload({...goal,targetDurationSeconds:'60'}),false);
 assert.throws(()=>makeAudioPayload({...values,targetFullLength:true},[concept]),/AUDIO_FORM_INVALID/);
});

test('sound selector updates only concept root index before reading; unrelated group bytes stay untouched',async()=>{
 const calls=[],signal=new AbortController().signal;
 const result=await readAudioSoundConcepts({signal,post:async(kind,body)=>{
  calls.push([kind,body]);return {groups:[{folder:'sections'},{folder:''}],unavailable:['unrelated']};
 },request:async path=>{
  calls.push(path);return {projectId:'binari',tab:'concept',groups,items:[{...concept,groupId:'group.sound'}]};
 }});
 assert.deepEqual(result,[concept]);
 assert.deepEqual(calls,[['compare',{scope:'binari/concept'}],['refresh',{scope:'binari/concept',folder:''}],
  '/api/project-workspace?projectId=binari&tab=concept']);
 await assert.rejects(readAudioSoundConcepts({signal,post:async()=>({groups:[],unavailable:['']}),request:async()=>assert.fail()}),
  /AUDIO_SOUND_CONCEPTS_UNAVAILABLE/);
});

test('no fake success and no new idempotency key after an ambiguous audio acknowledgement',async()=>{
 const calls=[];
 const form=createAudioIntake(async cmd=>{
  calls.push(cmd);
  return Response.json(calls.length===1?{...receipt,status:'processing'}:receipt,{status:201});
 },{uuid:()=>String(calls.length)});
 await assert.rejects(form.send(()=>payload),/AUDIO_RECEIPT_UNCONFIRMED/);
 assert.equal(form.uncertain,true);
 assert.deepEqual(await form.send(()=>assert.fail()),receipt);
 assert.deepEqual(calls,[{requestType:'audio.generate',idempotencyKey:'0',payload},{requestType:'audio.generate',idempotencyKey:'0',payload}]);
 assert.equal(await form.send(()=>assert.fail()),null);
});

function installDOM(t){
 class Element{
  constructor(tag){
   this.tagName=tag;this.children=[];this.attrs={};this.events={};this.value='';this.open=false;this.paused=true;
   this.classes=new Set();this.classList={toggle:(key,yes)=>yes?this.classes.add(key):this.classes.delete(key)};
  }
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];delete this[k];}
  addEventListener(k,v){this.events[k]=v;}
  all(tag){return this.children.flatMap(ch=>[...(ch.tagName===tag?[ch]:[]),...ch.all(tag)]);}
  play(){this.paused=false;this.events.play();return Promise.resolve();}
  pause(){this.paused=true;this.events.pause();}
  load(){}
  showModal(){this.open=true;}
  close(){this.open=false;this.events.close();}
  focus(){globalThis.document.activeElement=this;}
 }
 const before=globalThis.document;globalThis.document={createElement:tag=>new Element(tag)};t.after(()=>{globalThis.document=before;});
 return Element;
}

test('standalone playlist keeps BGM, opens a modal only on +, and uses standard formal intake',async t=>{
 const Element=installDOM(t);
 const items=new Element('ul'),detail=new Element('main'),signal=new AbortController().signal,sent=[],accepted=[];
 const run=concepts=>mountAudioWorkspace({items,detail,concepts,signal,onAccepted:id=>accepted.push(id),submit:async cmd=>{
  sent.push(cmd);return Response.json(receipt,{status:201});
 }});
 run([]);
 assert.equal(detail.all('form').length,0);assert.equal(detail.all('button')[0].disabled,true);assert.deepEqual(items.all('button').map(b=>b.disabled),[false,true,true]);
 run([concept]);
 const buttons=items.all('button');assert.deepEqual(buttons.map(b=>b.textContent),['BGM','효과음','TTS']);
 const label=name=>detail.all('form')[0].all('label').find(x=>x.textContent===name);
 assert.equal(buttons[0].attrs['aria-pressed'],'true');assert.equal(buttons[0].disabled,false);
 assert.equal(buttons[1].disabled,true);assert.equal(buttons[2].disabled,true);
 const dialog=detail.all('dialog')[0],open=detail.all('button').find(button=>button.textContent==='+');
 assert.equal(dialog.open,false);assert.equal(open.attrs['aria-haspopup'],'dialog');
 open.events.click();assert.equal(dialog.open,true);
 assert.equal(document.activeElement,label('제목').children[0]);
 dialog.all('button').find(button=>button.textContent==='닫기').events.click();
 assert.equal(dialog.open,false);assert.equal(document.activeElement,open);
 open.events.click();
 assert.equal(label('읽을 문장'),undefined);assert.equal(label('길이 (초, 선택)').children[0].min,10);
 assert.equal(label('길이 (초, 선택)').children[0].value,'');
 for(const [name,value] of [['제목',payload.title],['사운드 컨셉',concept.id],['제작 설명',payload.brief],['길이 (초, 선택)','10']])
  label(name).children[0].value=value;
 const form=detail.all('form')[0];
 await form.events.submit({preventDefault(){}});await form.events.submit({preventDefault(){}});
 assert.deepEqual(sent.map(row=>row.payload),[payload]);
 assert.deepEqual(accepted,[receipt.officialRequestId]);
 assert.equal(detail.all('p').find(x=>x.attrs.role==='status').textContent,'요청을 접수했습니다. 요청 ID: '+receipt.officialRequestId);
 assert.equal(dialog.open,false);assert.equal(label('제목').children[0].value,'');
 open.events.click();assert.equal(dialog.open,true);
 const full=label('완곡 (60초 이상 목표)').children[0],duration=label('길이 (초, 선택)').children[0];
 assert.equal(full.type,'checkbox');
 duration.value='20';full.checked=true;full.events.change();
 assert.equal(duration.disabled,true);assert.equal(duration.value,'');
 for(const [name,value] of [['제목',payload.title],['사운드 컨셉',concept.id],['제작 설명',payload.brief]])
  label(name).children[0].value=value;
 await form.events.submit({preventDefault(){}});
 assert.deepEqual(sent[1].payload,{...payload,durationSeconds:null,targetDurationSeconds:60});
 assert.equal(full.checked,false);assert.equal(duration.disabled,false);
 assert.deepEqual(detail.all('audio'),[]);
});

test('the hosted audio dialog does not offer or submit the local 60-second target',async t=>{
 const Element=installDOM(t),items=new Element('ul'),detail=new Element('main'),sent=[];
 mountAudioWorkspace({items,detail,concepts:[concept],signal:new AbortController().signal,allowFullLength:false,
  submit:async command=>{sent.push(command);return Response.json(receipt,{status:201});}});
 const open=detail.all('button').find(b=>b.textContent==='+');
 await open.events.click();
 const [form]=detail.all('form');
 const label=name=>form.all('label').find(x=>x.textContent===name);
 assert.equal(label('완곡 (60초 이상 목표)'),undefined);
 assert.ok(!label('길이 (초, 선택)').children[0].disabled);
 for(const [name,value] of [['제목',payload.title],['사운드 컨셉',concept.id],['제작 설명',payload.brief]])
  label(name).children[0].value=value;
 await form.events.submit({preventDefault(){}});
 assert.deepEqual(sent.map(x=>x.payload),[{...payload,durationSeconds:null}]);
});

test('the song list is independent of lazy sound-concept loading and a failed lookup can be retried',async t=>{
 const Element=installDOM(t),items=new Element('ul'),detail=new Element('main');
 let calls=0;
 const results=mountAudioWorkspace({items,detail,signal:new AbortController().signal,
  loadConcepts:async()=>{if(++calls===1)throw Error('unavailable');return [concept];},
  submit:async()=>assert.fail('no submission')});
 showAudioResults(results,[{title:'먼저 표시하는 곡',durationSeconds:30,url:'/api/audio-workspace?projectId=binari&id=track'}]);
 assert.equal(calls,0);
 const dialog=detail.all('dialog')[0],open=detail.all('button')[0],form=dialog.all('form')[0];
 await open.events.click();
 assert.equal(form.hidden,true);assert.match(dialog.all('p').find(p=>p.attrs.role==='alert').textContent,/확인하지 못했습니다/);
 assert.equal(results.all('li').length,1);
 dialog.close();
 await open.events.click();
 assert.equal(form.hidden,false);assert.equal(calls,2);
 assert.deepEqual(form.all('option').map(o=>o.textContent),['카테고리를 선택하세요',concept.label]);
});

test('playlist displays one row per song and uses a single player without interruption on refresh',t=>{
 const Element=installDOM(t),host=new Element('section'),navigation=new AbortController();
 const row=(title,bpm)=>({title,bpm,bpmBasis:'model',durationSeconds:30,
  url:'/api/audio-workspace?projectId=binari&id='+bpm+'&sha256='+'a'.repeat(64)});
 const first=row('첫 곡',80),second=row('두 번째 곡',90);
 showAudioResults(host,null,navigation.signal);
 assert.equal(host.all('audio').length,1);
 assert.equal(host.all('audio')[0].src,undefined);
 showAudioResults(host,[first,second]);
 assert.deepEqual(host.all('li').map(x=>x.children.slice(2).map(c=>c.textContent)),
  [['첫 곡','80','30초'],['두 번째 곡','90','30초']]);
 host.all('button')[1].events.click();
 const player=host.all('audio')[0];
 assert.equal(player.src,first.url);assert.equal(player.paused,false);
 assert.equal(host.all('li')[0].classes.has('audio-result-current'),true);
 host.all('button')[4].events.click();
 assert.equal(player.src,second.url);assert.equal(player.paused,false);
 assert.equal(host.all('li')[0].classes.has('audio-result-current'),false);
 assert.equal(host.all('li')[1].classes.has('audio-result-current'),true);
 showAudioResults(host,[first,second,first]);
 assert.equal(host.all('li').length,2);
 assert.equal(host.all('audio')[0],player);assert.equal(player.paused,false);
 host.all('button')[3].events.click();assert.equal(player.paused,true);
 for(const check of host.all('input')){check.checked=true;check.events.change();}
 const playSelection=host.all('button')[0];
 assert.equal(playSelection.disabled,false);
 playSelection.events.click();assert.equal(player.src,first.url);
 player.ended=true;player.events.ended();assert.equal(player.src,second.url);
 showAudioResults(host,[first]);
 assert.equal(player.src,undefined);assert.equal(player.paused,true);
});


const audioId=hex=>'request.official.'+hex.repeat(64);
const audioRow=(title,id)=>({title,durationSeconds:30,url:'/api/audio-workspace?projectId=binari&id='+id+'&sha256='+'e'.repeat(64)});

test('selected deletes confirm the precise count, submit separately, and do not remove kept rows before sync',async t=>{
 const Element=installDOM(t),root=new Element('section'),signal=new AbortController().signal;
 const rows=['a','b','c'].map((hex,i)=>audioRow('곡 '+(i+1),audioId(hex))),calls=[],accepted=[];
 showAudioResults(root,rows,signal,{submitDelete:async command=>{
  calls.push(command);
  if(calls.length===2)return Response.json({}, {status:503});
  if(calls.length===3)return Response.json({error:'PROJECT_OR_RESOURCE_DENIED'},{status:403});
  return Response.json(receipt,{status:201});
 },onDeleteAccepted:ids=>accepted.push(ids)});
 for(const checkbox of root.all('input')){checkbox.checked=true;checkbox.events.change();}
 const dialog=root.all('dialog')[0],button=title=>root.all('button').find(b=>b.textContent===title);
 const statuses=()=>root.all('span').filter(x=>x.className==='audio-delete-status').map(x=>x.textContent);
 button('선택 삭제 요청').events.click();
 assert.equal(dialog.open,true);
 assert.match(dialog.all('p')[0].textContent,/3곡/);
 assert.deepEqual(dialog.all('li').map(x=>x.textContent),['곡 1','곡 2','곡 3']);
 assert.equal(calls.length,0);
 button('취소').events.click();assert.equal(calls.length,0);
 button('선택 삭제 요청').events.click();
 await button('삭제 요청').events.click();
 assert.deepEqual(calls.map(x=>x.payload.officialRequestId),['a','b','c'].map(audioId));
 assert.ok(calls.every(x=>x.requestType==='audio.delete'&&x.payload.schemaVersion==='ngs.audio-delete.v1'&&x.payload.projectId==='binari'));
 assert.equal(new Set(calls.map(x=>x.idempotencyKey)).size,3);
 assert.deepEqual(statuses(),['삭제 요청 저장됨','접수 확인 필요','삭제 접수 실패']);
 assert.deepEqual(accepted,[[audioId('a')]]);
 assert.equal(root.all('ol')[0].all('li').length,3);
 button('선택 삭제 요청').events.click();await button('삭제 요청').events.click();
 assert.deepEqual(calls.map(x=>x.payload.officialRequestId),['a','b','c','b','c'].map(audioId));
 assert.equal(calls[3].idempotencyKey,calls[1].idempotencyKey);
 assert.notEqual(calls[4].idempotencyKey,calls[2].idempotencyKey);
 showAudioResults(root,rows.slice(1));
 assert.equal(root.all('ol')[0].all('li').length,2);
});

test('accepted deletes compare the parent but refresh only their exact folders and render only data returned by the replica',async()=>{
 const id=audioId('a'),foreign=audioId('b'),target=audioRow('대상',id),other=audioRow('다른 곡',foreign);
 const calls=[],views=[],waits=[];
 const result=await followDeletedAudioResults({ids:[id,'invalid',id],signal:new AbortController().signal,
  wait:async(_signal,ms)=>{waits.push(ms);return true;},display:rows=>views.push(rows),
  post:async(action,payload)=>{
   calls.push([action,payload]);
   return {groups:waits.length===2?[{folder:foreign},{folder:id}]:[]};
  },
  request:async()=>({results:waits.length===1?[target,other]:[other]})});
 assert.equal(result,true);
 assert.deepEqual(calls,[['compare',{scope:'binari/audio'}],['compare',{scope:'binari/audio'}],
  ['refresh',{scope:'binari/audio',folder:id}]]);
 assert.deepEqual(views,[[target,other],[other]]);
 assert.deepEqual(waits,[5000,60_000]);
});

async function listen(t,server){
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 t.after(()=>new Promise(ok=>server.close(ok)));
 return 'http://127.0.0.1:'+server.address().port;
}

test('audio forms queue behind authenticated BFF; pending list clears only after matching acknowledgment',async t=>{
 const temp=mkdtempSync(join(realpathSync(tmpdir()),'ngs-audio-fixture-')),root=join(temp,'catalog');
 const queue=openLocalRequestQueue(join(temp,'queue.sqlite'));
 t.after(()=>{queue.close();rmSync(temp,{recursive:true,force:true});});
 const write=(path,data)=>{
  const file=join(root,'binari/concept',path);
  mkdirSync(dirname(file),{recursive:true,mode:0o700});writeFileSync(file,JSON.stringify(data),{mode:0o600});
 };
 write('metadata.json',{sectionIds:[concept.id,'other','archived'],document:{hierarchy:{schemaVersion:'npc-concept-groups.v1',
  groups:[{...groups[0],categoryIds:[concept.id]},{id:'group.planning',title:'기획',categoryIds:['other']}],archivedCategoryIds:['archived']}}});
 for(const [id,title] of [[concept.id,concept.label],['other','기획'],['archived','보관']])write('sections/'+id+'/metadata.json',{id,title});
 async function fixtures(audioWorkspaceEnabled){
  const origin=await listen(t,createLocalProjectPageServer({root,requestQueue:queue,audioWorkspaceEnabled}));
  const session=await fetch(origin+'/__npcgen_session'),context=await session.json(),cookie=session.headers.get('set-cookie').split(';')[0];
  const headers={cookie,origin,'content-type':'application/json','x-npcgen-csrf':context.csrfToken,'x-npcgen-frontend-context':context.contextId};
  return {origin,headers,post:(payload,auth=headers,requestType='audio.generate')=>fetch(origin+'/api/requests',{method:'POST',headers:auth,
   body:JSON.stringify({requestType,idempotencyKey:'audio-fixture-'+requestType,payload})}),
   read:(auth=headers)=>fetch(origin+'/api/requests',{headers:auth})};
 }
 assert.equal(configuration({}).audioWorkspaceEnabled,false);
 assert.equal(configuration({NGS_AUDIO_WORKSPACE_ENABLED:'1'}).audioWorkspaceEnabled,true);
 const off=await fixtures(undefined);
 assert.doesNotMatch(await (await fetch(off.origin)).text(),/data-audio-workspace/);
 assert.equal((await off.post(payload)).status,404);
 assert.equal(queue.list().requests.length,0);
 const on=await fixtures(true);
 assert.match(await (await fetch(on.origin)).text(),/data-audio-workspace="enabled"/);
 const conceptIndex=await fetch(on.origin+'/api/project-workspace?projectId=binari&tab=concept',{headers:{cookie:on.headers.cookie}});
 assert.deepEqual(soundConceptOptions(await conceptIndex.json()),[concept]);
 assert.equal((await on.post(payload,{...on.headers,cookie:''})).status,401);
 assert.equal((await on.post({...payload,durationSeconds:0})).status,400);
 assert.equal((await on.post({...payload,projectId:'other'})).status,403);
 assert.equal(queue.list().requests.length,0);
 const accepted=await on.post(payload);
 assert.equal(accepted.status,202);
 const first=await accepted.json(),q=queue.list().requests[0];
 assert.equal(first.status,'queued');
 assert.deepEqual(q,{queueId:first.queueId,requestType:'audio.generate',idempotencyKey:first.queueId,payload});
 assert.equal((await on.read({...on.headers,cookie:''})).status,401);
 assert.equal((await (await on.read()).json()).requests.length,1);
 const finalId='request.official.'+createHash('sha256').update(JSON.stringify(['request.official.v1','local','binari',q.queueId])).digest('hex');
 queue.ack(q.queueId,{officialRequestId:finalId,status:'registered'});
 const confirmed=await on.read();
 assert.equal(confirmed.status,200);
 assert.deepEqual(await confirmed.json(),{requests:[]});
 assert.equal(queue.list().requests.length,0);

 const deletion={schemaVersion:'ngs.audio-delete.v1',projectId:'binari',officialRequestId:'request.official.'+'c'.repeat(64)};
 assert.equal((await off.post(deletion,off.headers,'audio.delete')).status,404);
 assert.equal((await on.post({...deletion,targets:['x','y']},on.headers,'audio.delete')).status,400);
 assert.equal((await on.post({...deletion,officialRequestId:'../unsafe'},on.headers,'audio.delete')).status,400);
 assert.equal(queue.list().requests.length,0);
 assert.equal((await on.post(deletion,on.headers,'audio.delete')).status,202);
 assert.deepEqual(queue.list().requests.map(x=>x.payload),[deletion]);

});


test('accepted BGM refresh is minute-gated, only syncs the exact result and stops on known publication',async()=>{
 const id='request.official.'+'a'.repeat(64),other='request.official.'+'b'.repeat(64);
 const url=key=>'/api/audio-workspace?projectId=binari&id='+key+'&sha256='+'c'.repeat(64);
 const hits=[],delays=[],published=[],scope='binari/audio/'+id;
 const signal=new AbortController().signal;
 let found=false,attempts=0;
 const otherResult={url:url(other)},expected={url:url(id)};
 const succeeded=await followAcceptedAudioResult({id,signal,display:rows=>published.push(rows),
  wait:async(s,ms)=>{assert.equal(s,signal);delays.push(ms);return true;},
  request:async route=>{
   assert.equal(route,'/api/audio-workspace?projectId=binari');
   return {results:[otherResult,...(found?[expected]:[])]};
  },
  post:async(kind,body)=>{
   hits.push([kind,body]);
   if(kind==='compare')return {groups:++attempts===2?[{folder:''},{folder:'unrelated'}]:[]};
   found=true;
  },
 });
 assert.equal(succeeded,true);
 assert.deepEqual(delays,[60_000,60_000]);
 assert.deepEqual(hits,[['compare',{scope}],['compare',{scope}],['refresh',{scope,folder:''}]]);
 assert.deepEqual(published,[[otherResult,expected]]);
 assert.equal(await followAcceptedAudioResult({id,signal,visible:()=>[expected],wait:()=>assert.fail()}),true);
});

test('accepted BGM checks are bounded, canceled on navigation, and never sync an invalid receipt ID',async()=>{
 const id='request.official.'+'a'.repeat(64),signal=new AbortController().signal;
 let checks=0;
 assert.equal(await followAcceptedAudioResult({id,signal,wait:async()=>true,display:()=>assert.fail(),
  request:async()=>({results:[]}),post:async()=>{checks++;throw Error('not yet visible');}}),false);
 assert.equal(checks,10);
 const route=new AbortController();
 assert.equal(await followAcceptedAudioResult({id,signal:route.signal,display:()=>assert.fail(),request:()=>assert.fail(),
  post:()=>assert.fail(),wait:async()=>{route.abort();return true;}}),false);
 assert.equal(await followAcceptedAudioResult({id:'../outside',signal,wait:()=>assert.fail()}),false);
});
