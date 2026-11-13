const resolved=new Set(['completed','applied','discarded','cancelled']);
export function unresolvedRequestCount(views){return views.filter(v=>!resolved.has(v.commonState||v.state)).length;}
export function groupRequestHistory(views){const pending=views.filter(v=>!resolved.has(v.commonState||v.state)),completed=views.filter(v=>resolved.has(v.commonState||v.state));return {pending,completed,ordered:[...pending,...completed]};}
export function requestStatusBadge(view){
 const state=view.commonState||view.state;
 const labels={queued:'대기',processing:'처리중',generating:'처리중',generated:'검증중',awaiting_selection:'선택대기',selected:'선택확정',applying:'적용중',source_applied:'동기화대기',sync_pending:'동기화중',synchronizing:'동기화중',completed:'완료',applied:'완료',failure:'실패',failed:'실패',blocked:'차단',conflict:'충돌',retry_wait:'재시도대기',discarded:'폐기',cancelled:'취소'};
 if(view.error&&!resolved.has(state)&&!['failed','failure','blocked','conflict'].includes(state))return {label:(labels[state]||'미확인')+' · 오류',tone:'attention'};
 return {label:labels[state]||'미확인',tone:['completed','applied'].includes(state)?'complete':['failure','failed','blocked','conflict'].includes(state)?'attention':['discarded','cancelled'].includes(state)?'muted':['queued','awaiting_selection'].includes(state)?'pending':'active'};
}
export function requestActionBadge(action){
 const kinds={
  'category.add':{label:'추가',tone:'add',description:'카테고리 추가'},
  'item.add':{label:'추가',tone:'add',description:'세부 항목 추가'},
  'item.modify':{label:'수정',tone:'modify',description:'세부 항목 수정'},
  'category.summary.modify':{label:'수정',tone:'modify',description:'카테고리 요약 수정'},
  'category.archive':{label:'제거',tone:'remove',description:'카테고리 제거 · 원문 보관'},
  'item.archive':{label:'제거',tone:'remove',description:'세부 항목 제거 · 원문 보관'},
  'category.restore':{label:'복원',tone:'restore',description:'카테고리 복원'},
  'item.restore':{label:'복원',tone:'restore',description:'세부 항목 복원'}
 };
 return Object.hasOwn(kinds,action)?kinds[action]:{label:'기타',tone:'other',description:'기타 요청'};
}
