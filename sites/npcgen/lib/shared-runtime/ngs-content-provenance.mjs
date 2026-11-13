const labels={
 'model-output':['모델 산출물','모델이 작성한 결과입니다. 후보 검수·등록·게시 상태는 별도로 확인합니다.'],
 'user-input':['직접 입력','사용자 또는 작업자가 입력한 내용입니다. 모델 생성으로 표시하지 않습니다.'],
 reuse:['기존 자료 재사용','기존 버전·자산을 참조합니다. 새로 생성한 원본이 아닙니다.'],
 'manual-review':['직접 작성 검토본','수동 작성·편집한 검토 자료입니다. 정식 모델 산출물로 소급하지 않습니다.'],
 fixture:['테스트 자료','격리 검증용 자료입니다. 정식 콘텐츠로 사용하지 않습니다.'],
 deterministic:['결정적 합성·변환','기존 원본을 정해진 규칙으로 합성하거나 변환한 결과입니다.'],
 code:['코드 기반 기능','코드로 계산하거나 그린 실행 피드백입니다. 생성 음원·그림과 구분합니다.'],
 unknown:['출처 미기록','현재 기록만으로 작성·생성 경로를 확정할 수 없습니다.']
};
const aliases={'worker-model':'model-output','model-draft':'model-output','user-brief':'user-input','human-edit':'user-input','human-node-details-edit':'user-input','automatic-template':'deterministic','template-draft':'fixture','reuse-existing-authored-revision':'reuse','declarative-template-assembly':'deterministic','CH1-review-revision':'manual-review'};
export function provenanceInfo(value={}){const v=value&&typeof value==='object'?value:{},raw=String(v.kind||''),kind=labels[raw]?raw:aliases[raw]||'unknown';return {kind,label:labels[kind][0],description:labels[kind][1],recordedKind:raw,modelGenerated:v.modelGenerated===true,testOnly:v.testOnly===true,requestId:typeof v.requestId==='string'?v.requestId:'',jobId:typeof v.jobId==='string'?v.jobId:''};}
const states={queued:'요청 접수',processing:'워커 처리 중',generated:'후보 생성됨',awaiting_selection:'후보 검수 대기',selected:'후보 선택됨',source_applied:'등록 반영됨',sync_pending:'게시 대기',synchronizing:'게시 중',completed:'요청 마감 완료',discarded:'요청 취소됨',retry_wait:'재개 대기',blocked:'처리 차단',conflict:'버전 충돌',failed:'처리 실패'};
export function lifecycleInfo(value={}){const state=String(value.state||''),publication=value.publication||value.publicationReceipt||{},registration=value.registration||{};return {state,label:states[state]||'상태 미기록',selected:state==='selected',completed:state==='completed',registered:registration.verified===true||state==='source_applied',publicationVerified:publication.verified===true,description:state==='selected'?'후보가 선택됐습니다. 요청 마감·게시 완료와 구분합니다.':state==='completed'?'요청의 처리 단계가 마감됐습니다. 게시 범위와 검증 영수증을 함께 확인합니다.':''};}
