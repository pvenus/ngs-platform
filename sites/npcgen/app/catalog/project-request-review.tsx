'use client';
import {SavedSourceCorrection} from './saved-source-correction';
import {UnifiedNpcComparison} from './unified-npc-comparison';
import {SinglePixelResult} from './single-pixel-result';
import {requestAdapter} from '../../lib/request-comparison-contract.mjs';
import {isGameDevelopment,gameDevelopmentView} from '../../lib/game-development-contract.mjs';
import {ComparisonFrame,ComparisonGrid,ComparisonCandidates,CandidateActions} from './candidate-actions';
import {useLoopbackSingle}from '../frontend-session';
import {conceptProposalReference}from '../../lib/concept-request-reference.mjs';
import {ProjectPixelComparison} from './project-pixel-comparison';
import {ProjectPortraitComparison} from './project-portrait-comparison';
import {NodeImageRequest} from './story-node-images';
import type {StoryChoiceDraft} from './story-decision-ui';
import {useCallback,useEffect,useRef,useState,useSyncExternalStore,type ComponentProps} from 'react';
import {createReadPoller,mergeReadResults} from '../../lib/request-read-controller.mjs';
import {createPortal} from 'react-dom';
import {ProposalReviewDialog} from './proposal-review-dialog';
import {StoryComparison} from './story-workspace';
import {FullValue} from './fields';
import {frontendFetch} from '@/lib/frontend-transport.mjs';
import {contentOperationsRpc} from './content-operations-api';
import {createConceptProcessClient} from '../../lib/concept-process-client.mjs';
import {proposalSet,proposalState} from '../../lib/proposal-set-contract';
import {categoryProposals} from '../../lib/npc-category-contract';
import {ProposalSetReview} from './proposal-set-review';
import {ProposalRequestKind} from './proposal-request-kind';
import {readCategoryRequests,readCategoryDetail,invalidateCatalogReads,type Snapshot,type Json,type RecordData} from './adapter';
import {requestTypes,requestKind,terminal,stateNames,requestGroups,requestGroup,filterProjectRequests} from './request-ui-model';
type RequestData=RecordData&{requestId:string;projectId:string;requestType:string;state:string};
function json(value:unknown):Json{if(value===null||typeof value==='string'||typeof value==='boolean')return value;if(typeof value==='number'&&Number.isFinite(value))return value;if(Array.isArray(value))return value.map((entry:unknown)=>json(entry));if(typeof value==='object'&&value!==null){const result:RecordData={};for(const [key,entry]of Object.entries(value))result[key]=json(entry);return result;}throw Error('JSON 데이터 형식이 올바르지 않습니다.');}
function record(value:unknown):RecordData{const result=json(value);if(result===null||typeof result!=='object'||Array.isArray(result))throw Error('객체 데이터 형식이 올바르지 않습니다.');return result;}
function child(value:Json|undefined):RecordData|undefined{if(value===undefined||value===null)return undefined;return record(value);}
function text(value:Json|undefined):string|undefined{if(value===undefined||value===null)return undefined;if(typeof value!=='string')throw Error('문자열 데이터 형식이 올바르지 않습니다.');return value;}
function requiredText(value:Json|undefined):string{const result=text(value);if(!result)throw Error('필수 문자열 데이터가 없습니다.');return result;}
function boolean(value:Json|undefined):boolean|undefined{if(value===undefined)return undefined;if(typeof value!=='boolean')throw Error('권한 데이터 형식이 올바르지 않습니다.');return value;}
function array(value:Json|undefined):Json[]{if(!Array.isArray(value))throw Error('목록 데이터 형식이 올바르지 않습니다.');return value;}
function request(value:unknown):RequestData{const result=record(value);return {...result,requestId:requiredText(result.requestId),projectId:requiredText(result.projectId),requestType:requiredText(result.requestType),state:requiredText(result.state)};}
function portraitSummary(value:RequestData):ComponentProps<typeof ProjectPortraitComparison>['summary']{const character=child(value.character),aliases=value.aliases===undefined?undefined:array(value.aliases).map(v=>({originalId:requiredText(record(v).originalId)}));return {...value,requestId:value.requestId,projectId:value.projectId,localRequestId:text(value.localRequestId),character:character?{npcId:text(character.npcId)}:undefined,aliases};}
function npcCopy(value:unknown):ComponentProps<typeof UnifiedNpcComparison>['copy']{const v=record(value),inputs=record(v.inputs),selection=v.selection===null?null:record(v.selection);if(typeof inputs.baseRevision!=='number'||!Number.isFinite(inputs.baseRevision)||selection&&typeof selection.proposalIndex!=='number')throw Error('NPC 후보 사본 데이터가 올바르지 않습니다.');const parsed=categoryProposals.safeParse(v.proposals);if(v.proposals!==null&&!parsed.success)throw Error('NPC 후보 집합 검증에 실패했습니다.');for(const key of ['applied','publication','error'])if(!Object.hasOwn(v,key))throw Error('NPC 후보 사본 필수 데이터가 없습니다.');return {localRequestId:requiredText(v.localRequestId),transferKey:requiredText(v.transferKey),requestHash:requiredText(v.requestHash),proposalHash:requiredText(v.proposalHash),inputs:{npcId:requiredText(inputs.npcId),mode:requiredText(inputs.mode),baseRevision:inputs.baseRevision},state:requiredText(v.state),proposals:parsed.success?parsed.data:null,selection:selection?{proposalIndex:requiredNumber(selection.proposalIndex)}:null,applied:v.applied,publication:v.publication,error:v.error};}
function requiredNumber(value:Json|undefined):number{if(typeof value!=='number'||!Number.isFinite(value))throw Error('숫자 데이터 형식이 올바르지 않습니다.');return value;}
function conceptDetail(value:RecordData):Pick<ComponentProps<typeof ProposalSetReview>,'comparison'|'proposalHash'|'state'|'canSelect'|'canDiscard'|'selectionCommitted'>&{requestId:string}{const comparison=proposalSet.safeParse(value.comparison),state=proposalState.safeParse(value.state);if(!comparison.success||!state.success)throw Error('후보 집합 또는 상태 검증에 실패했습니다.');const permissions=child(value.permissions);return {comparison:comparison.data,proposalHash:requiredText(value.proposalHash),state:state.data,canSelect:boolean(permissions?.canSelect)??false,canDiscard:boolean(permissions?.canDiscard)??false,selectionCommitted:boolean(value.selectionCommitted),requestId:requiredText(value.requestId)};}
async function get(url:string,signal?:AbortSignal){const r=await frontendFetch(url,{cache:'no-store',signal});const v=record(await r.json());if(!r.ok){const code=text(v.error),messages:Record<string,string>={REQUEST_READERS_UNAVAILABLE:'모든 도메인 조회에 실패했습니다. 기존 결과를 유지합니다.',LOCAL_PROCESSOR_DELIVERY_PENDING:'로컬 결과 수신 대기입니다. 잠시 후 다시 조회해 주세요.'};throw Object.assign(Error(code&&messages[code]||code||'요청 조회 실패'),{code});}return v;}
type ContentCandidate={id:string;hash:string;value:RecordData;summary:RecordData};
type ContentDetail={raw:RecordData;common:RecordData;original:RecordData;view:RecordData;candidates:ContentCandidate[];batch:boolean;decisionHash:string;state:string;modelStatus:string|undefined;activeLease:boolean};
function contentHash(value:Json|undefined):string{const hash=requiredText(value);if(!/^[a-fA-F0-9]{64}$/.test(hash))throw Error('후보 해시 형식이 올바르지 않습니다.');return hash;}
function contentCandidate(value:unknown,id:string):ContentCandidate{
 const candidate=record(value),body=record(candidate.value);
 if(requiredText(candidate.id)!==id)throw Error('후보 ID가 요청과 일치하지 않습니다.');
 const summary=child(body.definition)||child(body.composition)||body;
 text(summary.name);text(summary.title);text(summary.brief);text(summary.prompt);
 return {id,hash:contentHash(candidate.hash),value:body,summary};
}
function contentDetail(value:unknown,requestId:string):ContentDetail{
 const raw=record(value),common=record(raw.common),original=record(raw.request),view=record(raw.executionView);
 if(raw.error!==null&&raw.error!==undefined&&typeof raw.error!=='string')record(raw.error);
 if(raw.requestId!==requestId||common.requestId!==requestId||common.projectId!=='binari'||common.requestType!=='content.operation'||common.source!=='content.operations')throw Error('콘텐츠 요청의 프로젝트·출처·ID가 일치하지 않습니다.');
 const role=requiredText(original.role),origin=requiredText(original.origin),input=record(original.input);
 gameDevelopmentView(raw);
 if(!array(original.sourceRefs).length)throw Error('원본 출처 참조가 없습니다.');
 if(view.schemaVersion!=='ngs.content-execution-view.v1')throw Error('서버 실행 상태 투영이 없습니다.');
 const state=requiredText(common.state);
 if(view.commonState!==state)throw Error('서버 실행 상태가 일치하지 않습니다.');
 requiredText(view.phase);boolean(view.resultUncertain);boolean(view.sourceApplied);boolean(view.publicationVerified);
 const modelStatus=text(raw.modelStatus);
 if(origin==='model-output'&&modelStatus!==text(view.modelStatus))throw Error('모델 상태가 일치하지 않습니다.');
 const batch=(['resource-plan','resource-revise'].includes(role)||role==='audio-generate')&&input.resultCount===3;
 let candidates:ContentCandidate[]=[];
 const projected=child(raw.candidate);
 if(batch){
  if(raw.resultCount!==3)throw Error('요청된 후보 수 투영이 올바르지 않습니다.');
  const members=array(raw.candidates),root=child(raw.candidateSet);
  if(members.length!==0&&members.length!==3)throw Error('실제 후보는 0개 또는 3개여야 합니다.');
  if(members.length===0){if(root||projected)throw Error('후보 집합과 실제 후보 수가 일치하지 않습니다.');}
  else{
   if(!root||!projected)throw Error('불변 후보 집합이 없습니다.');
   const seed=contentCandidate(root,requestId+'.candidate.1');
   candidates=members.map((member,index)=>contentCandidate(member,requestId+'.candidate.'+(index+1)));
   if(new Set(candidates.map(candidate=>candidate.hash)).size!==3||candidates.some(candidate=>candidate.hash===seed.hash))throw Error('후보 멤버 해시가 올바르지 않습니다.');
  }
 }else{
  if(raw.candidateSet!==undefined||raw.candidates!==undefined||raw.resultCount!==undefined)throw Error('단일 요청에 후보 집합이 포함되어 있습니다.');
  if(projected)candidates=[contentCandidate(projected,requestId+'.candidate.1')];
 }
 const decision=child(raw.decision),decisionHash=decision?contentHash(decision.candidateHash):'';
 if(decisionHash){
  const selected=candidates.find(candidate=>candidate.hash===decisionHash);
  if(!selected||!projected||projected.hash!==decisionHash||projected.id!==selected.id)throw Error('기록된 결정과 실제 후보가 일치하지 않습니다.');
 }
 const job=child(raw.modelJob),lease=child(job?.lease),now=Date.now()/1000;
 const deadlines=modelStatus==='attached'?[common.leaseUntil]:[common.leaseUntil,lease?.leaseUntil];
 const activeLease=deadlines.some(deadline=>{if(deadline===null||deadline===undefined)return false;return requiredNumber(deadline)>now;});
 return {raw,common,original,view,candidates,batch,decisionHash,state,modelStatus,activeLease};
}
function contentPermissions(detail:ContentDetail|null){
 if(!detail)return {modelStart:false,work:false,review:false,apply:false};
 const {state,modelStatus,activeLease,candidates,decisionHash,original,view,common,raw}=detail;
 const modelBlocked=modelStatus!==undefined&&!['attached'].includes(modelStatus);
 const coherent=view.resultUncertain===false;
 const eligible=!modelBlocked&&view.phase!=='inconsistent_receipts';
 const audioLease=original.role==='audio-generate'&&['starting','running','ready'].includes(text(child(raw.audioGeneration)?.state)||'');
 const job=child(child(raw.developmentWorkflow)?.worker);
 const resumeValidated=isGameDevelopment(original.role)&&child(raw.developmentWorkflow)?.automatic===true&&job?.state==='failed'&&job.launcherAlive===false&&eligible&&coherent&&!activeLease&&candidates.length===1&&['awaiting_selection','selected'].includes(state);
 const reusableParentLease=original.origin==='model-output'&&modelStatus==='attached'&&raw.attempted===false&&view.phase==='validation_pending'&&coherent&&!!child(raw.workLease);
 return {
  modelStart:(coherent||child(raw.prelaunchRecovery)?.allowed===true)&&(!activeLease||state==='processing'&&!!child(raw.workLease))&&['queued','processing'].includes(state)&&original.origin==='model-output'&&!child(raw.modelJob)&&raw.attempted===false&&!candidates.length&&!decisionHash,
  work:resumeValidated||(eligible&&coherent||child(raw.attachmentRecovery)?.allowed===true)&&(!activeLease||reusableParentLease||audioLease||child(raw.attachmentRecovery)?.allowed===true)&&!candidates.length&&!decisionHash&&['queued','retry_wait','blocked','processing'].includes(state)&&(original.origin!=='model-output'||modelStatus==='attached'||child(raw.attachmentRecovery)?.allowed===true),
  review:eligible&&!activeLease&&coherent&&state==='awaiting_selection'&&candidates.length>0&&!decisionHash,
  apply:eligible&&!activeLease&&coherent&&!!decisionHash&&(['selected','source_applied','sync_pending'].includes(state)||state==='blocked'&&common.stage==='apply')
 };
}
function ContentJson({title,value}:{title:string;value:Json|undefined}){
 const [open,setOpen]=useState(false);
 return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>{title}</summary>{open&&<FullValue value={value}/>}</details>;
}
function ContentAudioPreview({requestId,candidate}:{requestId:string;candidate:ContentCandidate}){
 const [url,setUrl]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);const live=useRef(true),pending=useRef(false);
 useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 async function load(){
  if(pending.current||url)return;pending.current=true;setBusy(true);setError('');
  try{
   const result=record(await contentOperationsRpc({operation:'content-audio-read',requestId,candidateHash:candidate.hash}));const expected=child(candidate.summary.audio);
   if(result.requestId!==requestId||result.candidateHash!==candidate.hash||result.mime!=='audio/wav'||result.sha256!==expected?.sha256)throw Error('음원 후보의 출처·해시가 일치하지 않습니다.');
   const base64=requiredText(result.base64);if(base64.length>27000000)throw Error('음원 미리듣기 한도를 넘었습니다.');
   const binary=atob(base64),buffer=new ArrayBuffer(binary.length),bytes=new Uint8Array(buffer);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',buffer)),x=>x.toString(16).padStart(2,'0')).join('');
   if(hash!==result.sha256)throw Error('음원 파일의 실제 해시가 다릅니다.');
   if(live.current)setUrl('data:audio/wav;base64,'+base64);
  }catch(e:unknown){if(live.current)setError(e instanceof Error?e.message:'음원 조회 실패');}finally{pending.current=false;if(live.current)setBusy(false);}
 }
 return <div><button type="button" disabled={busy||!!url} onClick={()=>void load()}>{busy?'음원 읽는 중…':url?'음원 로드 완료':'이 후보 미리듣기'}</button>{error&&<p role="alert">{error}</p>}{url&&<audio data-ngs-generated-audio aria-label={text(candidate.summary.title)||'생성 음원 후보'} controls preload="none" src={url} style={{display:'block',maxWidth:'100%',width:320,marginTop:8}}/>}</div>;
}
function ContentOperationReview(props:{snapshot:Snapshot;requestId:string;refresh:()=>void;onBusyChange:(value:boolean)=>void;onPublished?:()=>void}){
 const local=useLoopbackSingle();
 return <ContentOperationReviewScope key={JSON.stringify([props.snapshot.projectId,props.snapshot.authorizationScope,props.requestId,local])} {...props} local={local}/>;
}
function ContentOperationReviewScope({snapshot,requestId,refresh,onBusyChange,onPublished,local}:{snapshot:Snapshot;requestId:string;refresh:()=>void;onBusyChange:(value:boolean)=>void;onPublished?:()=>void;local:boolean}){
 const projectId=snapshot.projectId,authorizationScope=snapshot.authorizationScope;
 const [detail,setDetail]=useState<ContentDetail|null>(null),[readError,setReadError]=useState(''),[fresh,setFresh]=useState(false),[busy,setBusy]=useState(true),[choice,setChoice]=useState(''),[notes,setNotes]=useState(''),[explicit,setExplicit]=useState(false);
 const busyRef=useRef(true),epoch=useRef(0),callbacks=useRef({refresh,onBusyChange,onPublished});
 const mutationRelease=useRef<(()=>void)|null>(null);
 const [correctionBusy,setCorrectionBusy]=useState(false);
 useEffect(()=>{callbacks.current={refresh,onBusyChange,onPublished};},[refresh,onBusyChange,onPublished]);
 const read=useCallback(async(token:number)=>{
  if(epoch.current!==token)return null;
  if(!local||projectId!=='binari')throw Error('로컬 binari 프로젝트에서만 콘텐츠 요청을 확인할 수 있습니다.');
  const next=contentDetail(await contentOperationsRpc({operation:'content-detail',requestId}),requestId);
  if(epoch.current!==token)return null;
  setDetail(next);setFresh(true);setReadError('');setExplicit(false);
  setChoice(old=>next.decisionHash||(isGameDevelopment(next.original.role)&&next.candidates.length===1?next.candidates[0].hash:next.candidates.some(candidate=>candidate.hash===old)?old:''));
  return next;
 },[local,projectId,requestId]);
 useEffect(()=>{
  const epochRef=epoch,lockRef=busyRef,releaseRef=mutationRelease;
  const token=++epochRef.current;
  lockRef.current=true;
  void Promise.resolve().then(()=>read(token)).catch((error:unknown)=>{if(epochRef.current===token){setFresh(false);setReadError((error instanceof Error?error.message:'상세 조회 실패')+' · 상세 다시 조회가 필요합니다.');}}).finally(()=>{if(epochRef.current===token){lockRef.current=false;setBusy(false);}});
  return()=>{if(epochRef.current===token){epochRef.current++;lockRef.current=false;const release=releaseRef.current;releaseRef.current=null;release?.();}};
 },[read,authorizationScope]);
 async function perform(operation:'content-detail'|'content-model-start'|'content-work'|'content-review'|'content-apply'){
  if(busyRef.current||correctionBusy||!local||projectId!=='binari')return;
  const permissions=contentPermissions(detail),member=isGameDevelopment(detail?.original.role)&&detail?.candidates.length===1?detail.candidates[0]:detail?.candidates.find(candidate=>candidate.hash===choice);
  if(operation!=='content-detail'&&(!fresh||readError||!detail))return;
  if(operation==='content-model-start'&&!permissions.modelStart)return;
  if(operation==='content-work'&&!permissions.work)return;
  if(operation==='content-review'&&(!permissions.review||!member||notes.trim().length<10||!explicit))return;
  if(operation==='content-apply'&&!permissions.apply)return;
  const token=epoch.current,isMutation=operation!=='content-detail';
  busyRef.current=true;setBusy(true);setFresh(false);setReadError('');setExplicit(false);
  let mutated=false;
  try{
   if(isMutation){
    const notifyBusy=callbacks.current.onBusyChange;
    mutationRelease.current=()=>notifyBusy(false);notifyBusy(true);
    const payload=operation==='content-review'?{operation,requestId,candidateHash:member?.hash||choice,notes,explicit:true}:{operation,requestId};
    const result=record(await contentOperationsRpc(payload));
    if(epoch.current!==token)return;
    if(result.error)throw Error(typeof result.error==='string'?result.error:'서버가 요청 오류를 반환했습니다.');
    contentDetail(result,requestId);mutated=true;
   }
   const next=await read(token);
   if(epoch.current!==token||!next)return;
   if(mutated&&next.common.state==='completed'&&next.common.syncStatus==='confirmed'&&next.view.sourceApplied===true&&next.view.publicationVerified===true){
    invalidateCatalogReads(projectId);if(next.original.role==='audio-generate')window.dispatchEvent(new CustomEvent('ngs-audio-published',{detail:{projectId,requestId}}));callbacks.current.onPublished?.();
   }
  }catch(error:unknown){
   if(epoch.current===token){setFresh(false);setReadError((error instanceof Error?error.message:'처리 결과를 확인하지 못했습니다.')+' · 결과가 불확실합니다. 재실행 전에 상세 다시 조회가 필요합니다.');}
  }finally{
   if(epoch.current===token){busyRef.current=false;setBusy(false);if(isMutation){const release=mutationRelease.current;mutationRelease.current=null;release?.();}if(mutated)callbacks.current.refresh();}
  }
 }
 const permissions=contentPermissions(detail),enabled=local&&projectId==='binari'&&fresh&&!busy&&!correctionBusy&&!readError;
 const selected=detail?.candidates.find(candidate=>candidate.hash===choice),view=detail?.view;
 const singleDevelopment=isGameDevelopment(detail?.original.role);
 const developmentResult=singleDevelopment&&detail?.candidates.length===1?detail.candidates[0]:null;
 const automaticDevelopment=detail?.original.origin!=='source-correction'&&singleDevelopment&&child(detail?.raw.developmentWorkflow)?.automatic===true;
 const developmentJob=automaticDevelopment?child(child(detail?.raw.developmentWorkflow)?.worker):null;
 const completed=detail?.state==='completed'&&detail.common.syncStatus==='confirmed'&&view?.sourceApplied===true&&view.publicationVerified===true;
 const actionStyle={padding:'10px 16px',border:'1px solid currentColor',borderRadius:6,minHeight:44};
 const modelLabels:Record<string,string>={invalid:'모델 결과 검증 실패',stale:'모델 결과 만료 · 재조회 필요',unknown:'모델 상태 불명 · 재조회 필요',attached:'저장된 모델 결과 있음 · 명시적 검증 대기',queued:'모델 작업 대기',running:'서버에 기록된 모델 실행 상태 · 실제 생존 여부 불명'};
 return (
  <ComparisonFrame kind={singleDevelopment?'game-development-single':'content-operation'}>
   <h3>{singleDevelopment?'게임 기능 개발':'정식 콘텐츠 작업'} · {completed?'동기화 확인 완료':automaticDevelopment&&developmentJob?.state==='failed'?'개발 중단 · 미적용':automaticDevelopment&&developmentJob?.state==='outcome_unknown'?'결과 불명 · 자동 재실행 중지':detail?.state==='awaiting_selection'?(singleDevelopment?'개발 결과 검수 대기':'선택 대기'):detail?stateNames[detail.state]||detail.state:'상세 확인 대기'}</h3>
   <p className="meta" style={{overflowWrap:'anywhere'}}>{requestId}</p>
   <button type="button" style={actionStyle} disabled={busy||!local||projectId!=='binari'} onClick={()=>void perform('content-detail')}>상세 다시 조회</button>
   {!local||projectId!=='binari'?<p role="alert">로컬 binari 프로젝트에서만 이 요청을 처리할 수 있습니다.</p>:null}
   {readError&&<p role="alert">{readError}</p>}
   {busy&&<p role="status">상태 확인·처리 중 · 검증·반영은 최대 6분까지 기다릴 수 있습니다.</p>}
   {!fresh&&detail&&<p role="status">이전 상세를 표시합니다. 최신 상세 확인 전에는 변경할 수 없습니다.</p>}
   {detail&&<>
    <SavedSourceCorrection key={requestId} requestId={requestId} enabled={enabled} onBusyChange={value=>{setCorrectionBusy(value);onBusyChange(value);}}/>
    <p>역할: {requiredText(detail.original.role)} · 출처: {requiredText(detail.original.origin)}</p>
    {detail.modelStatus&&!completed&&<p role="status">{modelLabels[detail.modelStatus]||'모델 상태 확인 필요: '+detail.modelStatus}</p>}
    {automaticDevelopment?<p role="status">자동 개발 상태: {text(developmentJob?.state)} · 단계: {text(developmentJob?.stage)} · 작업자 프로세스: {developmentJob?.launcherAlive===true?'관측됨':developmentJob?.launcherAlive===false?'종료됨':'확인 불가'}</p>:<p>서버 실행 단계: {text(view?.phase)} · 실제 프로세스 생존 여부는 확인되지 않았습니다.</p>}
    {automaticDevelopment&&text(developmentJob?.error)&&<p role="alert">자동 개발 중단: {text(developmentJob?.error)} · 미적용 결과와 이력은 보존됩니다.</p>}
    {view?.errorCode&&<p role="alert">기록된 오류: {text(view.errorCode)} · 상세를 재조회하고 검증·반영·동기화 단계를 확인하세요.</p>}
    {view?.resultUncertain===true&&!automaticDevelopment&&<p role="alert">서버에 불확실한 결과가 기록되어 있습니다. 상세 재조회 후 허용된 명시적 작업만 수행할 수 있습니다.</p>}
    {detail.activeLease&&<p role="status">{automaticDevelopment?'정식 작업 임대가 유지됩니다. 전용 워커가 처리하며 중복 실행하지 않습니다.':'기록된 작업 임대가 유효합니다. 소유한 부모 임대의 미시도 검증 재사용을 제외한 변경 작업을 차단합니다.'}</p>}
    {detail.original.role==='audio-generate'&&child(detail.raw.audioGeneration)&&<p role="status">음원 워커: {text(child(detail.raw.audioGeneration)?.state)} · 완료 {text(String(child(detail.raw.audioGeneration)?.completed??0))}/3 · {text(child(detail.raw.audioGeneration)?.step)} · 자동 재시도 없음</p>}
    <p>{singleDevelopment?'전용 단일 개발 워커 · 결과물 '+detail.candidates.length+'개 · 대안 생성 없음':detail.batch?'요청 계획 3개 · 실제 후보 '+detail.candidates.length+'개':'실제 단일 후보 '+detail.candidates.length+'개'}</p>
    {!detail.candidates.length&&<p>{singleDevelopment?'개발·검증을 마친 결과물이 아직 없습니다.':'아직 검수할 실제 후보가 없습니다. 요청 원문이나 집합의 루트는 선택 후보로 표시하지 않습니다.'}</p>}
    {singleDevelopment?<section aria-label="단일 게임 기능 개발 결과" data-development-mode="single-development">
     {developmentResult&&<article className="surface"><h4>개발 결과 · {text(developmentResult.summary.title)||developmentResult.id}</h4><p>비교·선택 없이 이 결과물 하나를 검증하고 등록합니다.</p><ContentJson title="개발 소스·메타데이터" value={developmentResult.value}/><ContentJson title="검증·빌드 영수증" value={child(detail.raw.candidate)?.assemblyProof??child(detail.raw.candidate)?.build}/><details><summary>결과물 출처·해시</summary><p style={{overflowWrap:'anywhere'}}>{developmentResult.hash}</p></details></article>}
     {automaticDevelopment?<p role="status">검증 성공 시 자동 승인·등록·동기화합니다. 실패·결과 불명은 적용하지 않습니다. 현재 단계: {text(child(child(detail.raw.developmentWorkflow)?.worker)?.stage)||text(view?.phase)}</p>:completed?<p>검수 근거: {text(child(detail.raw.decision)?.notes)}</p>:<><label>검수 근거<textarea disabled={!enabled||!permissions.review} style={{width:'100%',boxSizing:'border-box'}} value={notes} onChange={event=>{setNotes(event.target.value);setExplicit(false);}} rows={3}/></label><label><input type="checkbox" disabled={!enabled||!permissions.review} checked={explicit} onChange={event=>setExplicit(event.target.checked)}/> 개발 결과·검증·출처를 확인하고 등록을 승인합니다.</label></>}
    </section>:<>
    <fieldset className="content-comparison-fields"><legend>{completed?'실제 후보 검수 이력':'실제 후보 검수'}</legend>
     <ComparisonCandidates requestId={requestId} selectedId={detail.decisionHash||choice} disabled={!enabled||!permissions.review} confirmed={completed} onSelect={hash=>{setChoice(hash);setExplicit(false);}} candidates={detail.candidates.map(candidate=>({id:candidate.hash,title:text(candidate.summary.name)||text(candidate.summary.title)||candidate.id,mode:detail.original.role==='audio-generate'?'audio':'text',preview:detail.original.role==='audio-generate'?<><p>{String(child(candidate.summary.audio)?.durationSeconds??'')}초 · {String(child(candidate.summary.audio)?.sampleRate??'')}Hz</p><ContentAudioPreview requestId={requestId} candidate={candidate}/></>:<p style={{whiteSpace:'pre-wrap'}}>{text(candidate.summary.brief)||text(candidate.summary.prompt)||'세부 내용을 펼쳐 비교하세요.'}</p>,details:<>{!!text(candidate.summary.prompt)&&<details><summary>생성 요청·설명</summary><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text(candidate.summary.prompt)}</p></details>}<ContentJson title="후보 상세 JSON" value={candidate.value}/><details><summary>후보 식별·해시</summary><p style={{overflowWrap:'anywhere'}}>{candidate.id} · {candidate.hash}</p></details></>}))}/>
     {completed?<p>검수 근거: {text(child(detail.raw.decision)?.notes)}</p>:<>
      <label>검수 근거<textarea disabled={!enabled||!permissions.review} style={{width:'100%',boxSizing:'border-box'}} value={notes} onChange={event=>{setNotes(event.target.value);setExplicit(false);}} rows={3}/></label>
      <label><input type="checkbox" disabled={!enabled||!permissions.review} checked={explicit} onChange={event=>setExplicit(event.target.checked)}/> 후보·입력·출처를 검수하고 명시적으로 선택합니다.</label>
     </>}
    </fieldset>
    </>}
    {detail.decisionHash&&<p style={{overflowWrap:'anywhere'}}>{singleDevelopment?'개발 결과 검수 기록: ':'선택 기록: '}{detail.decisionHash} · {singleDevelopment?'검수한 결과물만 등록합니다.':'선택 기록과 동일한 실제 후보만 반영합니다.'}</p>}
    {detail.decisionHash&&!completed&&<p>{view?.sourceApplied===true?'원본 등록 확인 · 로컬 동기화 확인 대기':(singleDevelopment?'개발 결과 검수 완료 · 등록 대기':'선택 기록 완료 · 원본 등록·반영 대기')}</p>}
    {completed&&<p role="status">서버가 원본 반영과 로컬 발행을 검증하고 동기화를 확인했습니다.</p>}
    {!completed&&!automaticDevelopment&&detail.original.origin==='model-output'&&!child(detail.raw.modelJob)&&<button type="button" style={actionStyle} disabled={!enabled||!permissions.modelStart} onClick={()=>void perform('content-model-start')}>{detail.state==='processing'?'미실행 모델 작업 연결·복구':singleDevelopment?'단일 개발 워커 시작':'모델 제작 워커 시작 · 최대 1회'}</button>}
    {!completed&&!automaticDevelopment&&<button type="button" style={actionStyle} disabled={!enabled||!permissions.work} onClick={()=>void perform('content-work')}>{detail.original.role==='audio-generate'?'음원 워커 시작·완료 결과 가져오기':child(detail.raw.attachmentRecovery)?.allowed===true?'저장된 산출물 연결 복구·검증':detail.original.origin==='source-correction'?'교정 소스 컴파일·검증 · 모델 호출 없음':detail.original.origin==='model-output'?(singleDevelopment?'개발 결과 컴파일·검증':'저장된 모델 결과 검증·후보화'):'정식 검증·변환 실행'}</button>}
    {singleDevelopment?(automaticDevelopment?<p role="status">{completed?'개발 결과 자동 등록·동기화 완료':'전용 워커가 검증·등록·동기화를 처리합니다. 상세 다시 조회로 진행을 확인할 수 있습니다.'}{!completed&&permissions.work&&(developmentResult||detail.modelStatus==='attached')&&developmentJob?.state==='failed'&&developmentJob.launcherAlive===false&&<button type="button" style={actionStyle} disabled={!enabled} onClick={()=>void perform('content-work')}>{developmentResult?'기존 검증 결과 등록 재개 · 재생성 없음':'저장된 개발 소스 검증 재개 · 재생성 없음'}</button>}</p>:<footer className="candidate-actions"><p role="status">{completed?'개발 결과 등록·동기화 완료':detail.decisionHash?'검수 완료 · 같은 결과물의 등록·동기화 대기':'개발 결과와 검사 영수증을 확인하세요.'}</p><button type="button" style={actionStyle} disabled={busy||completed||!enabled||(detail.decisionHash?!permissions.apply:!permissions.review||!developmentResult||notes.trim().length<10||!explicit)} onClick={()=>void perform(detail.decisionHash?'content-apply':'content-review')}>{busy?'처리 중…':completed?'동기화 확인 완료':detail.decisionHash?'개발 결과 등록·동기화':'개발 결과 검수 승인'}</button></footer>):<>
     <CandidateActions status={completed?'원본 등록·로컬 동기화 확인 완료':detail.decisionHash?'선택 기록 완료 · 같은 후보의 등록·동기화 대기':choice?'선택됨 · 검수 근거와 명시 확인 후 확정하세요.':'후보를 선택하세요. 선택만으로 원본은 변경되지 않습니다.'} busy={busy} completed={completed} completedLabel="동기화 확인 완료" confirmLabel={detail.decisionHash?'선택 결과 등록·반영·동기화 확인':'검수 선택 기록'} disabled={!enabled||(detail.decisionHash?!permissions.apply:!permissions.review||!selected||notes.trim().length<10||!explicit)} onConfirm={()=>void perform(detail.decisionHash?'content-apply':'content-review')}/></>}

    <p>{singleDevelopment?'결과물 해시·검증·등록 권한은 서버가 확인합니다. 코드 재생성 없이 검증·등록 상태를 이어갑니다.':'후보 해시는 서버가 반환한 값을 그대로 전달합니다. 후보 내용·출처·버전·결정 권한의 최종 검증은 서버가 수행합니다.'}</p>
    <ContentJson title="접수 원문·출처·결정·영수증·서버 상태" value={detail.raw}/>
   </>}
  </ComparisonFrame>
 );
}
const subscribePortal=()=>()=>{};
const portalReady=()=>true;
const portalServer=()=>false;
type ReviewProps={npcCatalogMembership?:{currentIds:string[];allIds:string[];revision:number};snapshot:Snapshot;onPublished?:()=>void};
export function ProjectRequestReview(props:ReviewProps){return <ProjectRequestReviewScope key={JSON.stringify([props.snapshot.projectId,props.snapshot.authorizationScope])} {...props}/>;}
function ProjectRequestReviewScope({snapshot,onPublished,npcCatalogMembership}:ReviewProps){
 const [coverageNotice,setCoverageNotice]=useState('');
 const [drafts,setDrafts]=useState<Record<string,StoryChoiceDraft>>({});
 const [groups,setGroups]=useState(()=>requestGroups.map(g=>g.id));
 const [detailMounted,setDetailMounted]=useState(false),[lastConfirmedAt,setLastConfirmedAt]=useState<string|null>(null);
 const portal=useSyncExternalStore(subscribePortal,portalReady,portalServer);
 const [mutationBusy,setMutationBusy]=useState(false);const [items,setItems]=useState<RequestData[]>([]),[selected,setSelected]=useState(''),[filter,setFilter]=useState('all'),[error,setError]=useState(''),[loading,setLoading]=useState(false),[loaded,setLoaded]=useState(false),[partial,setPartial]=useState(false),[signal,setSignal]=useState(false);const mutating=useRef(false),itemsRef=useRef<RequestData[]>([]),poller=useRef<ReturnType<typeof createReadPoller>|null>(null);
 const [exactMode,setExactMode]=useState(false),[exactNotice,setExactNotice]=useState('');
 const openIntent=useRef({epoch:0,target:'',verified:false,failed:false});
 const projectId=snapshot.projectId;
 async function load(){return poller.current?.refresh();}
 function cancelIntent(){const intent=openIntent.current;intent.epoch++;intent.target='';intent.verified=false;intent.failed=false;setExactMode(false);setExactNotice('');}
 useEffect(()=>{
  const intent=openIntent.current;
  let readEpoch=intent.epoch;
  const reader=createReadPoller({interval:0,read:sig=>{readEpoch=intent.epoch;return get('/api/common-requests?projectId='+encodeURIComponent(projectId),sig);},canRun:()=>!mutating.current,onState:active=>{setLoading(active);if(active)setError('');},onError:(e:unknown)=>{setError(e instanceof Error?e.message:'조회 실패');if(intent.target&&readEpoch===intent.epoch){intent.failed=true;intent.verified=false;setSelected('');setExactNotice('지정한 요청의 목록 조회에 실패했습니다. 목록·상태를 다시 조회해 주세요.');}},onValue:(value:unknown)=>{
   const v=record(value),unavailable=v.unavailable===undefined?[]:array(v.unavailable).map(requiredText),statuses=child(v.readerStatus)||{},entries=Object.entries(statuses).map(([key,status])=>[key,record(status)] satisfies [string,RecordData]),copies=entries.some(([,r])=>boolean(child(r.copy)?.refreshPending)===true);const labels:Record<string,string>={'concept':'마스터 컨셉','story.design':'스토리','npc.category':'NPC 요청','portrait':'포트레이트'};const issues=entries.filter(([,r])=>text(r.state)!=='ready').map(([k,r])=>(labels[k]||k)+': '+(text(r.code)==='READER_TIMEOUT'?'조회 시간 초과':text(r.state)==='pending'?'결과 수신 대기':'조회 실패'));const notice=(text(v.notice)||'')+(unavailable.length?' · 일부 조회 대기/실패: '+issues.join(', '):'')+(copies?' · 최근 수신 사본 표시 / 새 상태 갱신 대기':'');
   const requests=v.requests===undefined?[]:array(v.requests).map(request);const merged:unknown=mergeReadResults(itemsRef.current,{...v,unavailable,requests});const list=array(json(merged)).map(request).filter(r=>r.projectId===projectId);for(const row of list){text(row.message);text(child(row.character)?.npcId);text(row.npcId);text(child(row.intake)?.npcId);requestKind(row);}
   setPartial(unavailable.length>0||copies);setLoaded(true);setCoverageNotice(notice);itemsRef.current=list;setItems(list);
   if(!unavailable.length&&!copies&&entries.every(([,status])=>text(status.state)==='ready'))setLastConfirmedAt(new Date().toISOString());
   if(intent.target){
    if(readEpoch!==intent.epoch)return;
    const match=requests.find(row=>row.projectId===projectId&&row.requestId===intent.target);
    intent.failed=false;intent.verified=!!match;setSelected(match?.requestId||'');
    setExactNotice(match?'':unavailable.length>0||copies?'지정한 요청의 현재 목록 확인 대기입니다. 목록·상태를 다시 조회해 주세요.':'지정한 요청을 현재 프로젝트의 서버 목록에서 찾지 못했습니다.');
   }else setSelected(old=>list.some(x=>x.requestId===old)?old:list.find(x=>x.state==='awaiting_selection')?.requestId||list.find(x=>!terminal(x))?.requestId||list[0]?.requestId||'');
  }});
  poller.current=reader;void reader.refresh();
  async function resolveExact(token:number){
   await reader.refresh();
   if(intent.epoch!==token||!intent.target||intent.verified||intent.failed)return;
   await reader.refresh();
   if(intent.epoch!==token||!intent.target||intent.verified||intent.failed)return;
   if(readEpoch!==token)setExactNotice('지정한 요청의 현재 목록 확인 대기입니다. 목록·상태를 다시 조회해 주세요.');
  }
  function open(e:Event){
   if(!(e instanceof CustomEvent))return;
   try{
    const detail=record(e.detail),eventProject=requiredText(detail.projectId),id=detail.requestId;
    if(id!==undefined&&(typeof id!=='string'||!/^content\.[a-f0-9]{40}$/.test(id)))throw Error('요청 ID 형식이 올바르지 않습니다.');
    if(eventProject!==projectId)return;
    const token=++intent.epoch;intent.target=typeof id==='string'?id:'';intent.verified=false;intent.failed=false;
    setExactMode(id!==undefined);setExactNotice(id===undefined?'':'지정한 요청의 현재 서버 목록을 확인하고 있습니다.');setSignal(true);
    if(id!==undefined){setGroups(requestGroups.map(g=>g.id));setFilter('all');setSelected('');void resolveExact(token);}
   }catch{setError('요청 열기 이벤트 형식이 올바르지 않습니다.');}
  }
  window.addEventListener('project-request-review-open',open);
  return()=>{intent.epoch++;intent.target='';intent.verified=false;intent.failed=false;reader.dispose();poller.current=null;window.removeEventListener('project-request-review-open',open);};
 },[projectId]);
 const pending=items.filter(v=>!terminal(v)).length,list=filterProjectRequests(items,snapshot.projectId,groups,filter);
 const active=list.some(v=>v.requestId===selected)?selected:exactMode?'':list[0]?.requestId||'';
 if(selected!==active)setSelected(active);
 const groupCounts=Object.fromEntries(requestGroups.map(g=>[g.id,items.filter(v=>requestGroup(v)===g.id).length]));
 const groupFilter=<fieldset className="request-group-filter" disabled={mutationBusy}><legend>요청 그룹 · 복수 선택</legend><div className="request-group-actions"><button type="button" onClick={()=>setGroups(requestGroups.map(g=>g.id))}>그룹 전체 선택</button><button type="button" onClick={()=>setGroups([])}>그룹 전체 해제</button></div><div className="request-group-chips">{requestGroups.filter(g=>g.id!=='other'||groupCounts[g.id]>0).map(g=><button type="button" key={g.id} aria-pressed={groups.includes(g.id)} aria-label={`${g.label} 그룹 · ${groupCounts[g.id]}건`} onClick={()=>setGroups(old=>old.includes(g.id)?old.filter(id=>id!==g.id):[...old,g.id])}><span aria-hidden="true">{groups.includes(g.id)?'✓':'＋'}</span>{g.label}<span className="request-group-count">{groupCounts[g.id]}</span></button>)}</div><p>그룹별 건수는 프로젝트 전체 기준입니다. 선택한 그룹을 합쳐 표시합니다.</p></fieldset>;
 const empty=groups.length?'선택한 그룹과 상태에 해당하는 요청이 없습니다. 필터를 변경해 보세요.':'선택한 그룹이 없습니다. 그룹을 선택하거나 전체 선택하세요.';
 function npcLabel(v:RequestData){const id=text(child(v.character)?.npcId)||text(v.npcId)||text(child(v.intake)?.npcId);if(!id||!npcCatalogMembership)return '';return npcCatalogMembership.currentIds.includes(id)?'현재 NPC · '+id:npcCatalogMembership.allIds.includes(id)?'레거시·보존 NPC의 요청 이력 · '+id:'NPC 소속 확인 대기 · '+id;}
 const sidebar=<><h3>{loaded?`전체 요청 ${items.length}건 · 대기 ${pending}건`:'프로젝트 요청 조회 중'}</h3><p className="meta">목록 마지막 확인: {lastConfirmedAt?<time dateTime={lastConfirmedAt}>{new Date(lastConfirmedAt).toLocaleString('ko-KR')}</time>:'아직 확인되지 않음'}</p><label>처리 상태<select disabled={mutationBusy} value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">전체 요청</option><option value="pending">대기·진행</option><option value="done">종료 요청</option></select></label>{groupFilter}<p className="request-filter-result" role="status">표시 {list.length}건 / 전체 {items.length}건</p><button type="button" disabled={loading||mutationBusy} onClick={()=>void load()}>목록·상태 새로고침</button>{error&&<p role="alert">{error}</p>}{exactNotice&&<p role="status">{exactNotice}</p>}<ul>{list.map(v=><li key={v.requestId}><button type="button" disabled={mutationBusy} aria-current={active===v.requestId?'true':undefined} onClick={()=>{cancelIntent();setSelected(v.requestId);}}><strong>{requestTypes[v.requestType]||v.requestType}</strong><div className="proposal-request-meta"><ProposalRequestKind action={requestKind(v)==='remove'?'item.archive':requestKind(v)==='add'?'item.add':requestKind(v)==='restore'?'item.restore':'item.modify'}/><span className="proposal-request-state" data-tone={terminal(v)?'complete':/failed|blocked/.test(v.state)?'attention':'pending'}>{v.state==='awaiting_selection'?'선택 대기':stateNames[v.state]||v.state}</span></div><small>{v.requestId}</small>{npcLabel(v)&&<p>{npcLabel(v)}</p>}</button></li>)}</ul>{!loading&&loaded&&!list.length&&<p>{partial?'일부 요청 상태를 확인하지 못했습니다. 빈 목록으로 확정하지 않고 다시 조회합니다.':empty}</p>}{loading&&<p role="status">{loaded?'새 상태 조회 중 · 이전 결과를 유지합니다.':'요청 상태를 처음 불러오는 중입니다. 최대 120초 뒤 재시도할 수 있습니다.'}</p>}</>;
 const content=<section className="story-review-dock project-request-dock" aria-label="프로젝트 통합 요청"><ProposalReviewDialog globalLaunch title="프로젝트 전체 요청 · 상태 및 3안 비교" launchLabel="프로젝트 전체 요청 목록 열기" launchTitle="프로젝트 전체 요청 · 상태 및 3안 비교" sidebarLabel="프로젝트 전체 요청 목록" busy={mutationBusy} status={error?'조회 실패 · 기존 결과 유지':!loaded?'요청 불러오는 중':loading?'새 상태 조회 중':`${items.length}건 · 대기 ${pending}건`} count={!loaded||error?undefined:pending} sidebar={sidebar} openRequested={signal} onOpened={()=>{setDetailMounted(true);if(!openIntent.current.target)void load();}} onClosed={()=>{cancelIntent();setSignal(false);for(const audio of document.querySelectorAll('audio[data-ngs-generated-audio]'))if(audio instanceof HTMLAudioElement)audio.pause();}} notice={coverageNotice||'기존 요청과 후보를 조회합니다. 새 생성이나 권한 변경 없이 요청별 기존 권한을 따릅니다.'}>{detailMounted&&active?<UnifiedRequestDetail key={snapshot.projectId+'|'+snapshot.authorizationScope+'|'+active} snapshot={snapshot} onPublished={onPublished} requestId={active} summary={items.find(v=>v.requestId===active)} draftChoice={drafts[active]} onDraftChoice={v=>setDrafts(old=>({...old,[active]:v}))} refresh={()=>void load()} onBusyChange={v=>{const was=mutating.current;mutating.current=v;setMutationBusy(v);if(was&&!v)void load();}}/>:<p role={error?'alert':'status'}>{error||exactNotice||(exactMode?'지정한 요청이 현재 필터에 표시되지 않습니다. 목록과 필터를 확인해 주세요.':!loaded?'요청 상태를 불러오는 중입니다.':partial?'일부 조회 대기/실패입니다. 다시 조회해 주세요.':empty)}</p>}</ProposalReviewDialog></section>;
 return portal?createPortal(content,document.body):null;
}
function UnifiedRequestDetail({snapshot,requestId,summary,refresh,onBusyChange,draftChoice,onDraftChoice,onPublished}:{snapshot:Snapshot;requestId:string;summary:RequestData|undefined;refresh:()=>void;onBusyChange:(v:boolean)=>void;draftChoice?:StoryChoiceDraft;onDraftChoice:(v:StoryChoiceDraft)=>void;onPublished?:()=>void}){
 const local=useLoopbackSingle();
 const [value,setValue]=useState<RequestData|null>(()=>summary||null),[domain,setDomain]=useState<RecordData|null>(null),[domainError,setDomainError]=useState(''),[busy,setBusy]=useState(false);
 const [detailLoading,setDetailLoading]=useState(false);const detailReader=useRef<ReturnType<typeof createReadPoller>|null>(null),summaryRef=useRef(summary),snapshotRef=useRef(snapshot),domainRef=useRef<RecordData|null>(null);
 useEffect(()=>{summaryRef.current=summary;snapshotRef.current=snapshot;},[summary,snapshot]);
 const projectId=snapshot.projectId,authorizationScope=snapshot.authorizationScope;
 useEffect(()=>{
  const reader=createReadPoller({interval:0,read:async sig=>{
   const snapshot=snapshotRef.current,v=summaryRef.current;if(!v||v.projectId!==projectId)throw Error('요청 프로젝트 범위 불일치');let d:RecordData|null=null;
   if(requestAdapter(v.requestType).reader==='content-operation')return {v,d};
   if(requestAdapter(v.requestType).reader==='story')d=await get('/api/story-design?projectId='+snapshot.projectId+'&view=view&requestId='+encodeURIComponent(requestId),sig);
   else if(v.requestType==='concept.content.proposals'){const source=Array.isArray(v.payloadRefs)?v:local&&snapshot.projectId==='binari'?await get('/api/common-requests?view=detail&projectId='+encodeURIComponent(snapshot.projectId)+'&requestId='+encodeURIComponent(requestId),sig):child(v.metadata)?.common;const ref=conceptProposalReference(v,source);d=await get('/api/concept-proposals?projectId='+snapshot.projectId+'&view=view&requestId='+encodeURIComponent(ref.referenceId),sig);if(d.comparison)conceptDetail(d);}
   else if(requestAdapter(v.requestType).reader==='npc-category'){const exact=local&&snapshot.projectId==='binari'?await get('/api/common-requests?view=detail&projectId='+encodeURIComponent(snapshot.projectId)+'&requestId='+encodeURIComponent(requestId),sig):v;const character=child(exact.character),npcId=text(character?.npcId);if(!character||!npcId)throw Error('NPC_CATEGORY_TARGET_REFERENCE_MISSING');v.character=character;const copies=await readCategoryRequests(snapshot,npcId,true,sig);const aliases=v.aliases===undefined?[]:array(v.aliases).map(a=>requiredText(record(a).originalId));const copy=array(json(copies.value)).map(record).find(x=>text(x.localRequestId)===requestId||aliases.includes(requiredText(x.localRequestId)));if(!copy)throw Error('NPC_CATEGORY_PUBLISHED_COPY_REFERENCE_MISSING: 정식 후보 사본 연결을 찾지 못했습니다. 요청 이력은 보존되며 후보 없음으로 판정하지 않습니다.');const copyReference={transferKey:requiredText(copy.transferKey),requestHash:requiredText(copy.requestHash),proposalHash:requiredText(copy.proposalHash),state:requiredText(copy.state)};d=record(await readCategoryDetail(snapshot,npcId,copyReference,sig));npcCopy(d);}
   else if(requestAdapter(v.requestType).result==='single'&&local&&snapshot.projectId==='binari')d=await get('/api/common-requests?view=detail&projectId='+encodeURIComponent(snapshot.projectId)+'&requestId='+encodeURIComponent(requestId),sig);
   const detailProject=text(child(d?.request)?.projectId);if(detailProject&&detailProject!==snapshot.projectId)throw Error('후보 프로젝트 범위 불일치');if(requestAdapter(v.requestType).reader==='portrait')portraitSummary(v);text(v.message);if(d){text(d.commonState);text(d.state);}return {v,d};
  },onState:setDetailLoading,onError:(e:unknown)=>setDomainError(e instanceof Error?e.message:'후보 조회 실패'),onValue:(result:unknown)=>{const resultRecord=record(result),v=request(resultRecord.v),d=child(resultRecord.d)||null;setValue(v);setDomain(d);domainRef.current=d;setDomainError('');}});detailReader.current=reader;void reader.refresh();return()=>{reader.dispose();detailReader.current=null;};
 },[projectId,authorizationScope,requestId,local]);
 const summaryState=summary?.state;
 useEffect(()=>{const current=domainRef.current;if(current&&summaryState&&summaryState!==(current.commonState||current.state))void detailReader.current?.refresh();},[summaryState]);
 const call=createConceptProcessClient(frontendFetch);
 let checkedPortrait:ComponentProps<typeof ProjectPortraitComparison>['summary']|undefined,checkedNpc:ComponentProps<typeof UnifiedNpcComparison>['copy']|undefined,checkedConcept:ReturnType<typeof conceptDetail>|undefined;
 let alternatives:RecordData[]=[],message:string|undefined,commonState:string|undefined,domainState:string|undefined,storyView:RecordData|null=domain;
 try{
  if(value){message=text(value.message);if(requestAdapter(value.requestType).reader==='portrait')checkedPortrait=portraitSummary(value);}
  if(domain){commonState=text(domain.commonState);domainState=text(domain.state);const comparison=child(domain.comparison),proposals=child(domain.proposals);if(value?.requestType==='npc.category.request'&&proposals?.proposals)checkedNpc=npcCopy(domain);if(value?.requestType==='concept.content.proposals'&&domain.comparison)checkedConcept=conceptDetail(domain);const raw=comparison?.alternatives||domain.alternatives||proposals?.proposals;alternatives=raw?array(raw).map(record):[];for(const a of alternatives){text(a.id);text(a.title);text(a.categoryName);text(a.rationale);}if(value?.requestType==='story.design'&&domain.comparison&&domainError)storyView={...domain,capability:{...child(domain.capability),selectionReady:false,decisionReady:false,discardReady:false,applyReady:false}};}
 }catch(e){return <p role="alert">{e instanceof Error?e.message:'후보 데이터 형식이 올바르지 않습니다.'}</p>;}
 const descriptor=requestAdapter(value?.requestType||'');
 if(value&&value.projectId===snapshot.projectId&&descriptor.reader==='content-operation')return <ContentOperationReview key={projectId+'|'+authorizationScope+'|'+requestId} snapshot={snapshot} requestId={requestId} refresh={refresh} onBusyChange={onBusyChange} onPublished={onPublished}/>;
 if(value&&local&&snapshot.projectId==='binari'&&descriptor.reader==='pixel')return <ProjectPixelComparison summary={value} projectId={snapshot.projectId} refresh={refresh} onBusyChange={onBusyChange}/>;
 if(value&&checkedPortrait&&descriptor.reader==='portrait')return <ComparisonFrame kind="portrait"><ProjectPortraitComparison snapshot={snapshot} summary={checkedPortrait} onPublished={onPublished} refresh={refresh} onBusyChange={onBusyChange}/></ComparisonFrame>;
 if(descriptor.reader==='node-image')return <NodeImageRequest requestId={requestId} snapshot={snapshot} onChanged={refresh} onPublished={onPublished}/>;
 if(local&&value&&['pixel-original','pixel-normalized'].includes(descriptor.reader))return <ComparisonFrame kind={descriptor.reader}><SinglePixelResult id={requestId} normalized={descriptor.reader==='pixel-normalized'}/></ComparisonFrame>;
 if(value?.requestType==='npc.category.request'&&checkedNpc)return <ComparisonFrame kind="npc-category"><UnifiedNpcComparison copy={checkedNpc} projectId={snapshot.projectId} local={local} onChanged={()=>{void detailReader.current?.refresh();refresh();}} onBusyChange={onBusyChange}/></ComparisonFrame>;
 if(!value)return <p role={domainError?'alert':'status'}>{domainError||'요청 상태·상세를 읽고 있습니다.'}</p>;
 const adapter=requestAdapter(value.requestType),state=commonState||domainState||value.state;
 const concept=checkedConcept;
 return <section className="request-comparison-frame" data-request-adapter={adapter.reader}><p role="status">{detailLoading?'선택한 요청의 상태·후보를 조회 중입니다. 기존 결과는 유지합니다.':domainError?'최신 상세 조회 실패 · 이전 결과 표시':''}</p><button type="button" disabled={detailLoading||busy} onClick={()=>void detailReader.current?.refresh()}>상세 다시 조회</button><h3>{requestTypes[value.requestType]||value.requestType} · {state==='awaiting_selection'?'선택 대기':stateNames[state]||domainState||value.state}</h3><p className="meta">{requestId}</p><ProposalRequestKind action={requestKind(value)==='remove'?'item.archive':requestKind(value)==='add'?'item.add':requestKind(value)==='restore'?'item.restore':'item.modify'}/>{message&&<p style={{whiteSpace:'pre-wrap'}}>{message}</p>}{domainError&&<p role="alert">후보 조회: {domainError} · 공통 상태·이력은 아래에서 확인할 수 있습니다.</p>}{domain?.comparison&&value.requestType==='story.design'?<StoryComparison view={storyView} snapshot={snapshot} draftChoice={draftChoice} onDraftChoice={onDraftChoice} onBusyChange={onBusyChange} onCommand={async (command:unknown)=>{const r=await frontendFetch('/api/story-design',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});const v=record(await r.json());if(!r.ok)throw Error(text(v.error)||'스토리 결정 처리 실패');setDomain(v);domainRef.current=v;if(v.state==='completed'){invalidateCatalogReads(snapshot.projectId);onPublished?.();}refresh();}}/>:domain?.comparison&&value.requestType==='concept.content.proposals'&&concept?<ProposalSetReview embedded comparison={concept.comparison} proposalHash={concept.proposalHash} state={concept.state} canSelect={!domainError&&concept.canSelect} canDiscard={!domainError&&concept.canDiscard} selectionCommitted={concept.selectionCommitted} onBusyChange={v=>{setBusy(v);onBusyChange(v);}} onSelect={async decision=>{await call('select',{requestId:concept.requestId,decision});refresh();}} onDiscard={async decision=>{await call('discard',{requestId:concept.requestId,decision});refresh();}} onRefresh={async()=>{refresh();}}/>:alternatives.length?<ComparisonGrid>{alternatives.map((a,i)=><article key={text(a.id)||i}><h4>{i+1}안 · {text(a.title)||text(a.categoryName)||'후보'}</h4><p>{text(a.rationale)}</p><FullValue value={a.payload||a}/></article>)}</ComparisonGrid>:<p>{detailLoading?'후보 상태를 불러오는 중입니다.':domainError?'도메인 후보를 읽지 못했습니다.':adapter.result==='single'?adapter.unsupportedReason:adapter.result==='unsupported'?adapter.unsupportedReason:/failed|blocked|retry_wait/.test(value.state)?'기술 실패·보류 기록입니다. 원본과 진단을 보존하며 없는 후보를 채우지 않습니다.':'해당 3안 도메인의 후보 준비/연결을 확인해야 합니다. 단일 작업이나 조회 오류와 구분합니다.'}</p>}{adapter.result==='single'&&!!domain?.domainData&&<FullValue value={domain.domainData}/>}<details><summary>요청 내용·처리 상태·이력·영수증</summary><FullValue value={{...value,...(domain?.state===undefined?{}:{domainState:domain.state}),...(domain?.events===undefined?{}:{events:domain.events}),...(domain?.receipt===undefined?{}:{receipt:domain.receipt}),...(domain?.publication===undefined?{}:{publication:domain.publication})}}/></details>{busy&&<p role="status">기존 도메인 권한으로 요청 처리 확인 중…</p>}</section>;
}
