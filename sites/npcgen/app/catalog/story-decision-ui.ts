/** Server capability gates persistence; temporary choices remain UI-only. */
export type StoryChoiceDraft={comparison:string;alternativeId:string};
export function storyComparisonKey(view:any){return view.comparisonHash||JSON.stringify(view.comparison||null);}
export function storyDecisionUi(view:any){
 const completed=view.state==='completed',closed=completed||['discarded','conflict'].includes(view.state),hasSelection=!!view.selection;
 const canChoose=view.state==='awaiting_selection'&&!hasSelection&&!!view.comparison?.alternatives?.length;
 const cap=view.capability||{},legacyReady=cap.decisionReady===true&&cap.localOnly===true;
 const projectScope=cap.localOnly===false&&cap.scope==='binari/story.decide'&&cap.requestId===view.requestId&&view.request?.projectId==='binari'&&/^story\.request\.[a-f0-9]{40}$/.test(view.requestId||'');
 const retry=['selected','sync_pending'].includes(view.state)&&view.selection?.requestId===view.requestId&&view.selection?.comparisonHash===view.comparisonHash&&view.comparison?.alternatives?.some((a:any)=>a.id===view.selection?.alternativeId);
 const projectConfirm=projectScope&&cap.applyReady===true&&cap.publicationReady===true&&((view.state==='awaiting_selection'&&!hasSelection&&cap.decisionReady===true)||retry);
 const canConfirm=(legacyReady||projectConfirm)&&['awaiting_selection','selected','sync_pending'].includes(view.state),canDiscard=(legacyReady||projectScope&&cap.decisionReady===true&&cap.discardReady===true)&&view.state==='awaiting_selection'&&!hasSelection;
 return {canChoose,canConfirm,canDiscard,closed,completed,
 confirmReason:completed?'확정 완료된 요청은 다시 확정할 수 없습니다.':closed?'종료된 요청은 확정할 수 없습니다.':canConfirm?(view.receipt?(projectScope?'정본 저장 영수증은 보존됐습니다. 같은 결정으로 로컬·Space 사본 동기화를 재시도합니다.':'정본 저장 영수증은 보존됐습니다. 같은 결정으로 로컬 사본 동기화만 재시도합니다.'):(projectScope?'확정하면 선택·승인 이력을 저장한 뒤 이 에피소드만 PDS에 반영하고 로컬·Space 사본의 개정·해시를 확인합니다.':'확정하면 선택·승인 이력을 저장한 뒤 이 에피소드만 PDS에 반영하고 로컬 사본의 개정·해시를 확인합니다. Space에는 게시하지 않습니다.')):'확정 처리 권한 또는 연결이 활성화되지 않았습니다.',
 discardReason:closed?'종료된 요청은 폐기할 수 없습니다.':hasSelection?'선택·확정 접수 이후 전체 폐기는 잠깁니다. 같은 결정의 처리 결과를 확인하세요.':canDiscard?'폐기는 후보와 원문을 남기고 종료 상태만 기록합니다. PDS 원본은 변경하지 않습니다.':'폐기 처리 권한 또는 연결이 활성화되지 않았습니다.'};
}
export function storyDraftChoice(view:any,draft?:StoryChoiceDraft){return draft&&draft.comparison===storyComparisonKey(view)&&view.comparison?.alternatives?.some((v:any)=>v.id===draft.alternativeId)?draft.alternativeId:'';}
