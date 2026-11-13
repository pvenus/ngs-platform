import {rows,type RecordData} from './adapter';

/** Source adapter contract: native field identities are field:<key>, never UI group IDs. */
export const nativePlanningFields = [
 ['summary','핵심 요약'],['publicFace','처음 보이는 모습'],['actualTruth','실제 사실 · 숨겨진 정보'],
 ['desire','핵심 욕구'],['fear','두려움 · 회피'],['values','가치와 충돌 우선순위'],
 ['belief','세계를 해석하는 방식'],['behavior','행동 판단 규칙'],['voice','말투와 대화 규칙'],
 ['arc','변화 가능성과 유지할 원칙'],['relationships','인물 관계와 갈등'],
 ['stateKeys','선택에 따라 이어질 상태'],['openQuestions','미결정 · 정합성 검토'],['sourceRefs','근거 문서'],
 ['numericProfile','수치 · 관계 · 판단 기준'],['traits','기본 성향'],
] as const;

export function editablePlanningCategories(npc:RecordData):RecordData[]{
 const native=nativePlanningFields.filter(([key])=>Object.prototype.hasOwnProperty.call(npc,key)||Array.isArray(npc.planningFields)&&npc.planningFields.includes(key)).map(([key,name])=>({id:`field:${key}`,name,sourceField:key,content:npc[key]??null}));
 const ids=new Set(native.map(c=>c.id));
 const extensions=rows(npc.planningCategories).filter(c=>typeof c.id==='string'&&!!c.id&&!ids.has(c.id));
 return [...native,...extensions];
}
