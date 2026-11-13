import {contextRequest} from './context-request-contract';
export function portraitHandoff(input:unknown){
 const request=contextRequest.parse(input);
 if(request.operation!=='prepare'||request.featureId!=='portrait.generate')throw Error('PORTRAIT_GENERATE_REQUIRED');
 return `NPCGen의 npcgen-feature-prompt 스킬로 아래 portrait.generate 요청의 프롬프트를 준비해 주세요. 연결된 Site MCP의 npc_context_prepare와 owner 로컬 Laya로 workflow 자료를 선택하고 필요한 프로젝트 자료를 읽어 주세요. 권한/연결이나 대상 NPC revision·현재 포트레이트가 확인되지 않으면 필요한 정보를 알려 주세요. 임의 값을 만들지 마세요.\n\n${JSON.stringify(request,null,2)}\n\n프롬프트 전문, revision/hash, 자료 출처와 캐시 사용 여부를 보여 주세요. 아직 Site 등록이나 이미지 생성을 실행하지 마세요. 제가 정확한 버전을 명시해 등록을 요청하면 npc_prompt_request_register로 등록하고 registrationIntentId를 알려 주세요. 실제 생성은 이후 owner 로컬 Codex에서 별도로 요청하겠습니다. 고정 template/selection과 고유 intent를 유지하고 batch.count=3인 경우 독립 결과별 claim·PNG·File 자산을 추적하세요. 기존 saved PNG를 재생성하지 말고 사본 게시 확인까지 진행 상태를 구분하세요.`;
}
export function portraitProgress(r:any){
 if(r.simpleRequest){if(r.status==='blocked'&&r.error==='TEXT_STYLE_CONFIRMATION_REQUIRED')return {step:2,label:'공통 화풍 확인 필요',next:'애니메이션 화풍 유지와 실사풍 금지는 확정됐습니다. 남은 공통 텍스트 화풍 초안의 정확한 버전과 내용을 확인해 주세요. 이미지는 생성하지 않았으며 대표 이미지 참조로 대체하지 않습니다.'};if(r.status==='blocked'&&r.error==='TEXT_VARIATION_PLAN_REQUIRED')return {step:2,label:'요청별 변주 계획 준비 필요',next:'공통 화풍과 캐릭터 특징을 유지하며 세 결과의 개별 조건을 준비해야 합니다. 아직 이미지를 생성하지 않았습니다.'};if(r.status==='completed')return {step:4,label:'3개 결과 · 정식 자산 및 사본 반영 완료',next:'결과 목록에서 요청과 출처를 확인하세요. 대표 변경은 별도 요청입니다.'};const states:Record<string,[number,string]>={site_received:[0,'Site 접수 · 로컬 수집 대기'],local_received:[1,'로컬 정식 접수 완료'],preparing:[2,'필수 자료 조회·프롬프트 준비 중'],awaiting_execution:[2,'로컬 실행 승인 대기'],processing:[3,'3개 결과 생성·자산 등록 중'],awaiting_snapshot:[3,'3개 결과 · 사본 반영 대기'],results_published:[4,'사본 게시 완료 · 로컬 마감 대기'],retry_wait:[3,'재시도 대기 · 보관된 결과 유지'],blocked:[2,'처리 중단 · 실행 조건 확인 필요'],failed:[3,'처리 실패 · 복구 확인 필요']};const [step,label]=states[r.status]||[0,'접수 상태 확인 중'];return {step,label,next:'로컬 worker가 상태를 회신합니다. 저장된 이미지는 재생성하지 않습니다.'};}

 if(r.portraitResult?.schemaVersion==='npc-portrait-batch-result.v1')return r.portraitResult.publication?{step:4,label:'3개 결과 · 정식 자산 및 사본 반영 완료',next:'결과 목록에서 요청자·고유 요청·템플릿·원본 버전을 확인하세요. 대표 변경은 별도 요청입니다.'}:{step:3,label:'3개 결과 처리 중 · 사본 반영 전',next:'개별 결과의 보관·등록 상태를 확인하세요. saved PNG는 재생성하지 않으며 자산 등록과 사본 확인 후 완료됩니다.'};
 if(r.portraitResult)return {step:4,label:'자산 등록 결과 확인',next:'owner 로컬 Codex가 보고한 File 자산과 NPC revision을 확인하세요. Site는 실제 파일을 직접 검사하지 않습니다.'};
 if(r.localStatus==='accepted')return {step:3,label:'생성 대기 · 실행 상태 미보고',next:'로컬 접수 완료. owner 로컬 Codex에서 실행 preview를 확인하고 별도로 생성을 요청하세요. 생성 시작/진행 여부는 Site에 보고되지 않습니다.'};
 return {step:2,label:'Site 등록 · 로컬 접수 대기',next:'owner 로컬 Codex에 이 등록 사본의 정식 접수를 요청하세요. receipt가 반환된 뒤 실행 preview를 확인해야 합니다.'};
}
export function connectionMessage(error:string){
 if(error==='PROJECT_ACCESS_DENIED')return 'Site 접근을 확인하지 못했습니다. 초대받은 계정으로 다시 로그인하세요. 앱 접근자는 모두 마스터이며, 자료 공유 범위와 로컬 실행 승인은 별도로 유지됩니다.';
 return '조회 연결을 확인하지 못했습니다: '+error;
}
