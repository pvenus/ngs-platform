import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openLocalRequestQueue} from '../build/local-request-queue.mjs';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import test from 'node:test';
import {audioSeparationType,validAudioSeparationPayload,createAudioIntake,followAcceptedAudioResult,followDeletedAudioResults,makeAudioPayload,mountAudioWorkspace,readAudioSoundConcepts,showAudioResults,soundConceptOptions,validLocalAudioPayload}
 from '../build/local-audio-workspace.mjs';
import {configuration,createLocalProjectPageServer} from '../build/local-project-page-server.mjs';

const concept={id:'category.sound-1',label:'마을 소리'},groups=[{id:'group.sound',title:'사운드'}];
const values={kind:'bgm',title:' 음악 ',conceptId:concept.id,brief:' 소리 설계 ',text:'ignored',duration:'10'};
const payload={schemaVersion:'ngs.audio-generate.v1',projectId:'binari',kind:'bgm',title:'음악',conceptId:concept.id,
 brief:'소리 설계',text:'',durationSeconds:10};
const speak={...payload,kind:'tts',text:'안녕하세요',durationSeconds:null};
const receipt={officialRequestId:'request.audio.fixture',status:'registered'};

const page=(results,nextCursor=null)=>({projectId:'binari',results,nextCursor});
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
  {...payload,durationSeconds:Infinity},{...payload,durationSeconds:9.9},{...payload,durationSeconds:null,text:'x'.repeat(4001)},
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

test('direct sound and exact lyrics use strict mutually exclusive wire fields',()=>{
 const base={...payload,durationSeconds:null},lyrics='  첫째 줄\n\n  둘째 줄 \n';
 const direct={...base,conceptId:'direct',conceptText:'피아노 중심\n리듬은 자유'};
 assert.deepEqual(makeAudioPayload({...values,conceptId:'direct',conceptText:'  '+direct.conceptText+' ',duration:null},[]),direct);
 assert.deepEqual(makeAudioPayload({...values,duration:null,lyricsText:lyrics},[concept]),{...base,text:lyrics});
 assert.deepEqual(makeAudioPayload({...values,duration:null,lyricsRequest:'  첫 만남의 이야기  '},[concept]),
  {...base,lyricsRequest:'첫 만남의 이야기'});
 assert.equal(validLocalAudioPayload({...direct,text:lyrics,targetDurationSeconds:60}),true);
 assert.equal(validLocalAudioPayload({...direct,lyricsRequest:'우리말 가사',targetDurationSeconds:60}),true);
 assert.equal(validLocalAudioPayload({...direct,durationSeconds:15}),true);
 for(const bad of [{...base,conceptId:'direct'},{...base,conceptText:'not direct'},
  {...direct,conceptText:''},{...direct,conceptText:' padded '},{...direct,lyricsRequest:''},
  {...direct,text:lyrics,lyricsRequest:'conflict'},{...direct,text:'  \n '},{...direct,text:'x'.repeat(4001)},
  {...direct,text:lyrics,durationSeconds:15},{...direct,lyricsRequest:'내용',durationSeconds:15},
  {...direct,other:'no'}])assert.equal(validLocalAudioPayload(bad),false);
 assert.throws(()=>makeAudioPayload({...values,duration:null,lyricsText:'  \n '},[concept]),/AUDIO_FORM_INVALID/);
 assert.throws(()=>makeAudioPayload({...values,duration:null,brief:'한'.repeat(4000),conceptId:'direct',
  conceptText:'한'.repeat(4000),lyricsText:'한'.repeat(4000)},[]),/AUDIO_FORM_TOO_LARGE/);
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
 assert.equal(detail.all('form').length,1);assert.equal(detail.all('button')[0].disabled,false);assert.deepEqual(items.all('button').map(b=>b.disabled),[false,true,true]);
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
 showAudioResults(results,page([{title:'먼저 표시하는 곡',durationSeconds:30,url:'/api/audio-workspace?projectId=binari&id=track'}]));
 assert.equal(calls,0);
 const dialog=detail.all('dialog')[0],open=detail.all('button')[0],form=dialog.all('form')[0];
 await open.events.click();
 assert.equal(!!form.hidden,false);assert.match(dialog.all('p').find(p=>p.attrs.role==='alert').textContent,/확인하지 못했습니다/);
 assert.deepEqual(form.all('option').map(o=>o.textContent),['카테고리를 선택하세요','직접 입력']);
 assert.equal(results.all('li').length,1);
 dialog.close();
 await open.events.click();
 assert.equal(!!form.hidden,false);assert.equal(calls,2);
 assert.deepEqual(form.all('option').map(o=>o.textContent),['카테고리를 선택하세요',concept.label,'직접 입력']);
});

test('direct sound works without master categories and vocal toggles never leak hidden inputs',async t=>{
 const Element=installDOM(t),items=new Element('ul'),detail=new Element('main'),sent=[];
 mountAudioWorkspace({items,detail,signal:new AbortController().signal,loadConcepts:async()=>[],
  submit:async command=>{sent.push(command.payload);return Response.json(receipt,{status:201});}});
 const open=detail.all('button').find(b=>b.textContent==='+'),form=detail.all('form')[0];
 const label=name=>form.all('label').find(x=>x.textContent===name);
 const input=name=>label(name).children[0];
 const change=(name,key,val)=>{const control=input(name);control[key]=val;control.events.change();};
 const save=()=>form.events.submit({preventDefault(){}});
 const fill=async()=>{
  await open.events.click();assert.equal(!!form.hidden,false);
  assert.deepEqual(form.all('option').map(o=>o.textContent),['카테고리를 선택하세요','직접 입력']);
  assert.equal(label('가사 원문').hidden,true);assert.equal(label('가사 제작 요청').hidden,true);
  input('제목').value='새 곡';input('제작 설명').value='가벼운 리듬';
  change('사운드 컨셉','value','direct');assert.equal(label('사운드 컨셉 직접 입력').hidden,false);
  input('사운드 컨셉 직접 입력').value='  어두운 소편성  ';
 };
 const base={...payload,title:'새 곡',brief:'가벼운 리듬',conceptId:'direct',conceptText:'어두운 소편성',durationSeconds:null};
 await fill();input('길이 (초, 선택)').value='22';change('가사 입력','checked',true);
 assert.equal(input('길이 (초, 선택)').disabled,true);assert.equal(label('가사 제작 요청').hidden,false);
 input('가사 제작 요청').value='  남겨진 편지 이야기  ';
 await save();assert.deepEqual(sent,[{...base,lyricsRequest:'남겨진 편지 이야기'}]);
 await fill();change('가사 입력','checked',true);input('가사 제작 요청').value='discard this';
 change('가사 직접 입력','checked',true);assert.equal(label('가사 제작 요청').hidden,true);
 assert.equal(label('가사 원문').hidden,false);
 const lyrics='  첫 줄\n\n둘째 줄 \n';input('가사 원문').value=lyrics;
 await save();assert.deepEqual(sent[1],{...base,text:lyrics});
 await fill();change('가사 입력','checked',true);change('가사 직접 입력','checked',true);
 input('가사 원문').value='discard this too';change('가사 입력','checked',false);
 assert.equal(input('길이 (초, 선택)').disabled,false);input('길이 (초, 선택)').value='20';
 await save();assert.deepEqual(sent[2],{...base,durationSeconds:20});
});

test('direct sound can submit while optional master discovery is unresolved',async t=>{
 const Element=installDOM(t),items=new Element('ul'),detail=new Element('main'),sent=[];
 let finish;const lookup=new Promise(resolve=>{finish=resolve;});
 mountAudioWorkspace({items,detail,signal:new AbortController().signal,loadConcepts:()=>lookup,
  submit:async command=>{sent.push(command.payload);return Response.json(receipt,{status:201});}});
 const pending=detail.all('button').find(b=>b.textContent==='+').events.click();
 const form=detail.all('form')[0];
 assert.equal(!!form.hidden,false);
 const get=name=>form.all('label').find(x=>x.textContent===name).children[0];
 get('제목').value='즉시 입력';get('제작 설명').value='기악';
 get('사운드 컨셉').value='direct';get('사운드 컨셉').events.change();
 get('사운드 컨셉 직접 입력').value='관현악';
 await form.events.submit({preventDefault(){}});
 assert.equal(sent[0].conceptId,'direct');assert.equal(sent[0].conceptText,'관현악');
 finish([concept]);await pending;
});

test('playlist displays one row per song and uses a single player without interruption on refresh',t=>{
 const Element=installDOM(t),host=new Element('section'),navigation=new AbortController();
 const row=(title,bpm)=>({title,bpm,bpmBasis:'model',durationSeconds:30,
  url:'/api/audio-workspace?projectId=binari&id='+bpm+'&sha256='+'a'.repeat(64)});
 const first=row('첫 곡',80),second=row('두 번째 곡',90);
 showAudioResults(host,null,navigation.signal);
 assert.equal(host.all('audio').length,1);
 assert.equal(host.all('audio')[0].src,undefined);
 showAudioResults(host,page([first,second]));
 assert.deepEqual(host.all('li').map(x=>x.children.slice(2).map(c=>c.textContent)),
  [['첫 곡','80','30초'],['두 번째 곡','90','30초']]);
 const trackButton=(i,j)=>host.all('ol')[0].all('li')[i].all('button')[j];
 trackButton(0,0).events.click();
 const player=host.all('audio')[0];
 assert.equal(player.src,first.url);assert.equal(player.paused,false);
 assert.equal(host.all('li')[0].classes.has('audio-result-current'),true);
 trackButton(1,1).events.click();
 assert.equal(player.src,second.url);assert.equal(player.paused,false);
 assert.equal(host.all('li')[0].classes.has('audio-result-current'),false);
 assert.equal(host.all('li')[1].classes.has('audio-result-current'),true);
 showAudioResults(host,page([first,second,first]));
 assert.equal(host.all('li').length,2);
 assert.equal(host.all('audio')[0],player);assert.equal(player.paused,false);
 trackButton(1,0).events.click();assert.equal(player.paused,true);
 for(const check of host.all('input')){check.checked=true;check.events.change();}
 const playSelection=host.all('button')[0];
 assert.equal(playSelection.disabled,false);
 playSelection.events.click();assert.equal(player.src,first.url);
 player.ended=true;player.events.ended();assert.equal(player.src,second.url);
 showAudioResults(host,page([first]));
 assert.equal(player.src,undefined);assert.equal(player.paused,true);
});


const audioId=hex=>'request.official.'+hex.repeat(64);
const audioRow=(title,id)=>({title,durationSeconds:30,url:'/api/audio-workspace?projectId=binari&id='+id+'&sha256='+'e'.repeat(64)});

test('selected deletes confirm the precise count, submit separately, and do not remove kept rows before sync',async t=>{
 const Element=installDOM(t),root=new Element('section'),signal=new AbortController().signal;
 const rows=['a','b','c'].map((hex,i)=>audioRow('곡 '+(i+1),audioId(hex))),calls=[],accepted=[];
 showAudioResults(root,page(rows),signal,{submitDelete:async command=>{
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
 showAudioResults(root,page(rows.slice(1)));
 assert.equal(root.all('ol')[0].all('li').length,2);
});

test('fetches cursor pages on demand, caches history and deletes only chosen tracks',async t=>{
 const Element=installDOM(t),root=new Element('section'),signal=new AbortController().signal;
 const rows=Array.from({length:65},(_,i)=>audioRow('곡 '+(i+1),'request.official.'+i.toString(16).padStart(64,'0')));
 const calls=[],reads=[];
 showAudioResults(root,page(rows.slice(0,30),'a1.next'),signal,{
  request:async route=>{
   reads.push(route);
   return route.endsWith('a1.next')?page(rows.slice(30,60),'a1.last'):page(rows.slice(60));
  },
  submitDelete:async cmd=>{calls.push(cmd);return Response.json(receipt,{status:201});}
 });
 const button=title=>root.all('button').find(b=>b.textContent===title);
 const items=()=>root.all('ol')[0].all('li');
 const marks=()=>root.all('ol')[0].all('input');
 const next=button('다음'),previous=button('이전');
 assert.deepEqual(reads,[]);
 assert.equal(items().length,30);
 const mark=check=>{check.checked=true;check.events.change();};
 mark(marks()[29]);await next.events.click();
 assert.equal(reads.length,1);
 button('현재 페이지 전체 선택').events.click();
 assert.ok(marks().every(x=>x.checked));
 previous.events.click();assert.equal(marks().filter(x=>x.checked).length,1);
 await next.events.click();assert.equal(reads.length,1);
 button('현재 페이지 선택 해제').events.click();
 await next.events.click();assert.equal(items().length,5);assert.equal(reads.length,2);
 mark(marks()[0]);
 button('선택 재생').events.click();
 const player=root.all('audio')[0];assert.equal(player.src,rows[29].url);
 player.ended=true;player.events.ended();assert.equal(player.src,rows[60].url);
 button('선택 삭제 요청').events.click();
 assert.deepEqual(root.all('dialog')[0].all('li').map(x=>x.textContent),['곡 30','곡 61']);
 await button('삭제 요청').events.click();
 assert.deepEqual(calls.map(x=>x.payload.officialRequestId),[rows[29],rows[60]].map(r=>new URL(r.url,'https://example.test').searchParams.get('id')));
 showAudioResults(root,page(rows.slice(0,29)),signal,undefined,{force:true,removed:[audioId('f'),new URL(rows[60].url,'https://example.test').searchParams.get('id')]});
 assert.equal(items().length,29);assert.equal(player.src,undefined);
});

test('late next result cannot replace refreshed first page',async t=>{
 const Element=installDOM(t),root=new Element('section'),signal=new AbortController().signal;
 const first=audioRow('First',audioId('a')),newer=audioRow('Newest',audioId('b')),obsolete=audioRow('Obsolete',audioId('c'));
 let resolve;
 showAudioResults(root,page([first],'a1.next'),signal,{request:()=>new Promise(r=>{resolve=r;})});
 const next=root.all('button').find(b=>b.textContent==='다음');
 const pending=next.events.click();
 showAudioResults(root,page([newer]),signal,undefined,{force:true});
 resolve(page([obsolete]));await pending;
 const titles=root.all('ol')[0].all('button').map(b=>b.textContent);
 assert.ok(titles.includes('Newest'));assert.ok(!titles.includes('Obsolete'));
});

test('accepted deletes compare the parent but refresh only their exact folders and render only data returned by the replica',async()=>{
 const id=audioId('a'),foreign=audioId('b'),target=audioRow('대상',id),other=audioRow('다른 곡',foreign);
 const calls=[],views=[],waits=[];
 const result=await followDeletedAudioResults({ids:[id,'invalid',id],signal:new AbortController().signal,
  wait:async(_signal,ms)=>{waits.push(ms);return true;},onChanged:ids=>views.push(ids),
  post:async(action,payload)=>{
   calls.push([action,payload]);
   return {groups:waits.length===2?[{folder:foreign},{folder:id}]:[]};
  },
  request:async route=>{assert.match(route,/&resultId=/);return {projectId:'binari',result:waits.length===1?target:null};}});
 assert.equal(result,true);
 assert.deepEqual(calls,[['compare',{scope:'binari/audio'}],['compare',{scope:'binari/audio'}],
  ['refresh',{scope:'binari/audio',folder:id}]]);
 assert.deepEqual(views,[[id]]);
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
  return {origin,headers,post:(payload,auth=headers,requestType='audio.generate',idempotencyKey='audio-fixture-'+requestType)=>fetch(origin+'/api/requests',{method:'POST',headers:auth,
   body:JSON.stringify({requestType,idempotencyKey,payload})}),
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

 const direct={...payload,conceptId:'direct',conceptText:'편성은 자유',durationSeconds:null,text:'  첫째 줄\n\n둘째 줄 \n'};
 assert.equal((await on.post({...direct,lyricsRequest:'차단할 충돌'})).status,400);
 const directResponse=await on.post({...direct,title:'직접 입력 검증'},on.headers,'audio.generate','audio-direct');
 assert.equal(directResponse.status,202);
 const directPending=queue.list().requests[0];
 assert.deepEqual(directPending.payload,{...direct,title:'직접 입력 검증'});
 const directFinal='request.official.'+createHash('sha256').update(JSON.stringify(['request.official.v1','local','binari',directPending.queueId])).digest('hex');
 queue.ack(directPending.queueId,{officialRequestId:directFinal,status:'registered'});

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
 const succeeded=await followAcceptedAudioResult({id,signal,onChanged:()=>published.push(id),
  wait:async(s,ms)=>{assert.equal(s,signal);delays.push(ms);return true;},
  request:async route=>{
   assert.equal(route,'/api/audio-workspace?projectId=binari&resultId='+id);
   return {projectId:'binari',result:found?expected:null};
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
 assert.deepEqual(published,[id]);
});

test('accepted BGM checks are bounded, canceled on navigation, and never sync an invalid receipt ID',async()=>{
 const id='request.official.'+'a'.repeat(64),signal=new AbortController().signal;
 let checks=0;
 assert.equal(await followAcceptedAudioResult({id,signal,wait:async()=>true,display:()=>assert.fail(),
  request:async()=>({projectId:'binari',result:null}),post:async()=>{checks++;throw Error('not yet visible');}}),false);
 assert.equal(checks,10);
 const route=new AbortController();
 assert.equal(await followAcceptedAudioResult({id,signal:route.signal,display:()=>assert.fail(),request:()=>assert.fail(),
  post:()=>assert.fail(),wait:async()=>{route.abort();return true;}}),false);
 assert.equal(await followAcceptedAudioResult({id:'../outside',signal,wait:()=>assert.fail()}),false);
});


test('one per-track action reuses an uncertain queue ticket and excludes derived or invalid rows',async t=>{
 const Element=installDOM(t),host=new Element('section'),signal=new AbortController().signal,calls=[],received=[];
 const sourceId='request.official.'+'a'.repeat(64),wavHash='b'.repeat(64);
 const row={title:'원곡',durationSeconds:30,url:'/api/audio-workspace?projectId=binari&id='+sourceId+'&sha256='+wavHash};
 const rows=[row,{...row,title:'반주',separated:true,url:row.url.replace(sourceId,'request.official.'+'c'.repeat(64))},
  {...row,title:'변조',url:row.url+'&extra=1'}];
 showAudioResults(host,page(rows),signal,{submitSeparation:async command=>{
  calls.push(command);
  if(calls.length===1)throw Error('lost ACK');
  return Response.json({queueId:'ngs.local.00000000-0000-4000-8000-000000000000',status:'queued'},{status:202});
 },onSeparationAccepted:receipt=>received.push(receipt)});
 const buttons=host.all('button').filter(b=>b.textContent==='분리 요청');
 assert.equal(buttons.length,1);
 await buttons[0].events.click();
 assert.equal(buttons[0].textContent,'같은 접수 다시 확인');
 await buttons[0].events.click();
 await buttons[0].events.click();
 assert.deepEqual(calls[1],calls[0]);assert.equal(calls.length,2);
 assert.equal(calls[0].requestType,audioSeparationType);
 assert.deepEqual(calls[0].payload,{schemaVersion:'ngs.audio-separate.v1',projectId:'binari',
  sourceOfficialRequestId:sourceId,sourceSha256:wavHash});
 assert.equal(validAudioSeparationPayload({...calls[0].payload,prompt:'cannot override'}),false);
 assert.equal(received.length,1);assert.equal(buttons[0].disabled,true);
 assert.deepEqual(host.all('li').map(x=>x.all('button')[1].textContent),rows.map(x=>x.title));
});

test('Local separation gates authenticated exact original receipt and projects derived result without shifting existing storage',async t=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'ngs-audio-separate-fixture-')));
 const queue=openLocalRequestQueue(join(root,'queue.sqlite'));
 t.after(()=>{queue.close();rmSync(root,{recursive:true,force:true});});
 const id='request.official.'+'9'.repeat(64),derived='request.official.'+'f'.repeat(64);
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const data=Buffer.alloc(46);data.write('RIFF');data.write('WAVE',8);
 const digest=hash(data);
 const source={sourceOfficialRequestId:id,sourceSha256:digest};
 for(const [current,isDerived] of [[id,false],[derived,true]]){
  const loc=join(root,'binari','audio',current);mkdirSync(loc,{recursive:true,mode:0o700});
  writeFileSync(join(loc,'audio.wav'),data,{mode:0o600});
  const row={schemaVersion:'workflow.audio-result.v1',officialRequestId:current,projectId:'binari',kind:'bgm',
   taskId:'workflow.task.'+hash(JSON.stringify([current,isDerived?'audio_separate':'audio_generate'])),
   payloadSha256:'0'.repeat(64),conceptId:'sound',source:{conceptId:'sound',sectionSha256:'1'.repeat(64)},
   title:isDerived?'원곡 (반주)':'원곡',generatedAt:isDerived?2:1,
   audio:{path:'audio.wav',mimeType:'audio/wav',sha256:digest,bytes:data.length,channels:1,bitsPerSample:16,
    sampleRate:8000,frames:1,durationSeconds:1/8000},...(isDerived?{separation:source}:{})};
  writeFileSync(join(loc,'metadata.json'),JSON.stringify(row),{mode:0o600});
 }
 const argv={root,requestQueue:queue,audioWorkspaceEnabled:true};
 const session=async enabled=>{
  const origin=await listen(t,createLocalProjectPageServer({...argv,audioSeparationEnabled:enabled}));
  const response=await fetch(origin+'/__npcgen_session'),value=await response.json();
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const headers={cookie,origin,'content-type':'application/json','x-npcgen-csrf':value.csrfToken,'x-npcgen-frontend-context':value.contextId};
  return {origin,cookie,value,
   send:(change={},override={})=>fetch(origin+'/api/requests',{method:'POST',headers:{...headers,...override},
    body:JSON.stringify({requestType:audioSeparationType,idempotencyKey:'separate-once',payload:{
     schemaVersion:'ngs.audio-separate.v1',projectId:'binari',...source,...change}})})};
 };
 const off=await session(false);assert.equal(off.value.audioSeparationEnabled,undefined);assert.equal((await off.send()).status,404);
 const on=await session(true);assert.equal(on.value.audioSeparationEnabled,true);
 assert.equal((await on.send({},{cookie:''})).status,401);
 assert.equal((await on.send({sourceSha256:'0'.repeat(64)})).status,404);
 assert.equal((await on.send({sourceOfficialRequestId:derived})).status,404);
 assert.equal((await on.send({prompt:'must be rejected'})).status,400);
 assert.equal(queue.list().requests.length,0);
 const first=await on.send();assert.equal(first.status,202);assert.deepEqual(await (await on.send()).json(),await first.json());
 assert.equal(queue.list().requests.length,1);
 const results=await (await fetch(on.origin+'/api/audio-workspace?projectId=binari',{headers:{cookie:on.cookie}})).json();
 assert.deepEqual(results.results.map(({title,separated})=>[title,separated]),[['원곡',undefined],['원곡 (반주)',true]]);
 assert.deepEqual(Buffer.from(await (await fetch(on.origin+results.results[1].url,{headers:{cookie:on.cookie}})).arrayBuffer()),data);
});
