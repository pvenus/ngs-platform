/** Single source of truth: a label cannot be added without a result+reader+action contract. */
export const sharedCandidateLayout='common-candidate-shell.v1';
const c=(label,reader)=>({label,result:'three',reader,layout:sharedCandidateLayout,actions:{confirm:'domain-capability',discard:'domain-capability'},unsupportedReason:null});
const s=(label,reason,reader='common-detail')=>({label,result:'single',reader,...(reader==='content-operation'?{layout:sharedCandidateLayout}:{}),actions:{confirm:'not-applicable',discard:'not-applicable'},unsupportedReason:reason});
export const requestAdapters=Object.freeze({
 'portrait.generate':c('포트레이트','portrait'), 'npc.pixel-sd.batch.generate':c('픽셀 포트레이트 3안','pixel'), 'concept.content.proposals':c('마스터 컨셉 3안','concept'),'story.design':c('스토리 수정','story'),'story.node.image':c('스토리 노드 이미지 3안','node-image'),'npc.category.request':c('NPC 카테고리 3안','npc-category'),
 'npc.pixel-sd.generate':s('픽셀 원본 생성','원본 이미지 1건입니다. 최종 보정 및 선택은 연결된 3안 요청에서 처리합니다.','pixel-original'),'npc.pixel-sd.normalize':s('픽셀 기계적 보정','기존 원본의 결정론적 보정 결과 1건입니다.','pixel-normalized'),'portrait.register':s('사용자 이미지 수입','사용자 제공 이미지 1건의 수입·등록 결과입니다.'),'npc.create':s('NPC 신규 등록','NPC 생성·등록 결과이며 이미지 3안 요청과 구분합니다.'),
 'npc.legacy.backup':s('NPC 보호 백업','백업·복원 검증 영수증 작업입니다.'),'npc.legacy.archive':s('NPC 보관','원본을 보존하는 생명주기 작업입니다.'),'npc.legacy.restore':s('NPC 복원','보관 데이터 복원 작업입니다.'),'content.operation':s('정식 콘텐츠 작업','이 요청의 콘텐츠 후보·결정·실행 영수증을 확인합니다.','content-operation'),'case.assets':s('정식 자산 작업','이 요청의 자산 묶음·등록 영수증입니다.'),'resource.plan.review':s('리소스 기획 검수','정식 기획 검수 및 등록 작업입니다.'),'episode.production':s('에피소드 실행 제작','고정된 실행 세트 1건입니다.'),'episode.production.model':s('에피소드 모델 제작','이 제작 요청의 실행 세트 산출물입니다.'),'episode.visual.asset':s('에피소드 시각 자산','시각 자산 작업 영수증입니다.'),'story.node.image.canary':s('노드 이미지 격리 검증','실제 플레이 후보와 구분되는 격리 검증 기록입니다.'),'project.icon':s('프로젝트 아이콘','프로젝트 아이콘 변경 작업입니다.'),
 ...Object.fromEntries(['concept.group.operation','concept.item.archive','concept.item.restore','concept.category.archive','concept.category.restore','concept.category.review'].map(t=>[t,s('컨셉 관리 작업','컨셉의 단일 수정·보관·복원 작업입니다.')]))
});
export const requestAdapterLabels=Object.freeze(Object.fromEntries(Object.entries(requestAdapters).map(([k,v])=>[k,v.label])));
export function requestAdapter(type){return requestAdapters[type]||{label:type,result:'unsupported',reader:'unregistered',actions:{confirm:'unsupported',discard:'unsupported'},unsupportedReason:'비교/결정 계약이 등록되지 않은 요청 유형입니다. 후보 없음으로 판정하지 않고 연결 오류로 표시합니다.'};}
export function assertAdapterCoverage(types){for(const t of types){const a=requestAdapters[t];if(!a||!a.result||!a.reader||!a.actions?.confirm||!a.actions?.discard)throw Error('REQUEST_COMPARISON_CONTRACT_MISSING:'+t);if((a.result==='three'||a.reader==='content-operation')&&a.layout!==sharedCandidateLayout)throw Error('REQUEST_COMPARISON_LAYOUT_MISSING:'+t);}return true;}

export const comparisonReaderBindings=Object.freeze({portrait:'ProjectPortraitComparison',pixel:'ProjectPixelComparison',concept:'ProposalSetReview',story:'StoryComparison','node-image':'NodeImageRequest','npc-category':'UnifiedNpcComparison','common-detail':'CommonResultDetail','content-operation':'ContentOperationReview','pixel-original':'SinglePixelResult','pixel-normalized':'SinglePixelResult'});
for(const [type,adapter]of Object.entries(requestAdapters))if(!comparisonReaderBindings[adapter.reader])throw Error('REQUEST_COMPARISON_READER_MISSING:'+type);

/** Renderers expose slots only. Generated worker output cannot choose its layout. */
export const comparisonExtensionContract=Object.freeze({schemaVersion:'ngs.comparison-extension.v1',layout:sharedCandidateLayout,component:'ComparisonCandidates',slots:Object.freeze(['title','preview','details']),serverOwned:Object.freeze(['candidateId','candidateHash','selection','permissions','sync']),workerLayoutOverride:false});
export function assertWorkerComparisonBinding(binding){if(!binding||binding.layout!==sharedCandidateLayout||binding.component!==comparisonExtensionContract.component||binding.workerLayoutOverride!==false)throw Error('WORKER_COMMON_COMPARISON_REQUIRED');return true;}

assertAdapterCoverage(Object.keys(requestAdapters));
