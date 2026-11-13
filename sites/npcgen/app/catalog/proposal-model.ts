import {documentOf,object,type Json,type RecordData,type Snapshot,type Proposal} from './adapter';
export type EditTarget={targetId:string;resourceId:string;key:string;before:Json|undefined;suggested?:Json};
export function editOperation(target:EditTarget){return target.key==='__knowledge_create__'?'knowledge.create':target.key==='__knowledge_edit__'?'knowledge.update':target.key==='proposal'?'entity.replace':'field.update';}
export function buildProposal(base:Snapshot,target:EditTarget,value:Json,note:string,idempotencyKey:string):Proposal{
 if(note.trim().length<3||note.trim().length>210)throw Error('변경 사유는 3~210자로 입력하세요.');
 if(value===undefined)throw Error('제안 값이 필요합니다.');
 const operation=editOperation(target),data=object(value);
 validateEditableStatuses(editorSchema(base,target),value,target.key);
 if(operation==='knowledge.create'&&!/^[A-Za-z0-9._-]{2,128}$/.test(String(data.id||'')))throw Error('새 항목 ID는 영문·숫자·점·밑줄·하이픈 2~128자로 입력하세요.');
 if(operation==='entity.replace'&&data.id!==target.targetId&&data.storyId!==target.targetId)throw Error('인물·스토리의 ID는 변경할 수 없습니다.');
 const payload:RecordData=operation==='knowledge.create'?{entry:value,note:note.trim()}:operation==='knowledge.update'?{changes:value,note:note.trim()}:{field:target.key,value,note:note.trim()};
 return {projectId:base.projectId,baseRevision:base.sourceRevision,baseHash:base.contentHash,operation,targetId:operation==='knowledge.create'?String(data.id):target.targetId,logicalResourceId:target.resourceId,payload,idempotencyKey};
}
export function currentEditValue(snapshot:Snapshot,target:EditTarget):Json|undefined{
 if(target.key==='__knowledge_create__')return target.before;
 if(target.resourceId.startsWith('knowledge.entry.')){const entry=object(snapshot.documents[target.resourceId]);return target.key==='__knowledge_edit__'?Object.fromEntries(Object.entries(entry).filter(([key])=>['title','purpose','content','data','triggers','authority','status','maxReadChars'].includes(key))):entry[target.key];}
 const found:RecordData[]=[];function visit(value:Json){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object'){if((value.id||value.storyId)===target.targetId)found.push(value);Object.values(value).forEach(visit);}}
 visit(documentOf(snapshot,target.resourceId));if(found.length!==1)return undefined;return target.key==='proposal'?found[0]:found[0][target.key];
}
export function sameValue(a:Json|undefined,b:Json|undefined){return JSON.stringify(a)===JSON.stringify(b);}
export type Difference={path:string;before:Json|undefined;after:Json|undefined};
export function differences(before:Json|undefined,after:Json|undefined,path='값'):Difference[]{
 if(sameValue(before,after))return [];
 if(before&&after&&typeof before==='object'&&typeof after==='object'&&Array.isArray(before)===Array.isArray(after))return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>differences((before as RecordData)[key],(after as RecordData)[key],`${path}.${key}`));
 return [{path,before,after}];
}
export const fieldLabels:Record<string,string>={activePortraitId:'대표 포트레이트',name:'이름',kind:'종류',role:'역할',status:'상태',chapters:'Chapter',summary:'핵심 요약',publicFace:'처음 보이는 모습',actualTruth:'실제 사실 · 숨겨진 정보',desire:'핵심 욕구',fear:'두려움',values:'가치와 충돌 우선순위',belief:'세계를 해석하는 방식',behavior:'행동 판단 규칙',voice:'말투와 대화 규칙',arc:'변화와 유지 원칙',relationships:'인물 관계',stateKeys:'이어질 상태',openQuestions:'미결정 항목',sourceRefs:'근거 문서',value:'내용',sources:'근거',priority:'우선순위',title:'제목',purpose:'목적',content:'본문',data:'구조화 정보',triggers:'조회 조건',authority:'자료 권위',maxReadChars:'최대 조회 글자 수',id:'ID',categoryId:'분류 ID',type:'자료 종류',numericProfile:'수치·관계·판단 원칙',traits:'기본 성향',actPremise:'중심 갈등',mandatoryEvents:'필수 사건',endingDesign:'결말 조건',tags:'태그',npcIds:'연결 NPC',goal:'Chapter 목적',continuity:'전달 상태',sceneOutline:'장면 구성',choices:'선택 설계',stateEffects:'결과 상태',reviewNotes:'검토 사항',__knowledge_edit__:'지식 항목',__knowledge_create__:'새 지식 항목',proposal:'전체 항목'};

/** Mirrors legacy validators: server.py, story_groups.py, profile_model.py, knowledge_catalog.py. */
export type EditorSchema='concept'|'npc'|'storyline'|'chapter'|'episode'|'knowledge'|'unknown';
export function editorSchema(base:Snapshot,target:EditTarget):EditorSchema{
 if(target.resourceId==='concept')return 'concept';
 if(target.resourceId==='npcs')return 'npc';
 if(target.resourceId.startsWith('knowledge.'))return 'knowledge';
 if(target.resourceId!=='story')return 'unknown';
 let found:EditorSchema='unknown';
 function visit(value:Json,path:string[]){if(Array.isArray(value))value.forEach(v=>visit(v,path));else if(value&&typeof value==='object'){if((value.id||value.storyId)===target.targetId)found=path.includes('episodes')?'episode':path.includes('chapters')?'chapter':'storyline';Object.entries(value).forEach(([key,v])=>visit(v,[...path,key]));}}
 visit(documentOf(base,'story'),[]);return found;
}
export function statusChoices(schema:EditorSchema,path:string):readonly string[]|undefined {
 const parts=path.split('.'),key=parts.at(-1);
 if(schema==='knowledge'&&parts.includes('data'))return;
 if(key==='reviewStatus')return schema==='npc'?['proposal','confirmed']:undefined;
 if(key!=='status')return;
 if(schema==='concept')return ['source','proposal','open','confirmed'];
 if(schema==='npc')return ['source','proposal','review','confirmed'];
 if(schema==='knowledge')return ['active','draft','legacy'];
 if(schema==='episode'||parts.includes('episodes')&&['storyline','chapter'].includes(schema))return ['proposal','confirmed','review'];
 if(schema==='chapter'||schema==='storyline')return ['proposal','confirmed'];
}
export function validateEditableStatuses(schema:EditorSchema,value:Json,path:string){
 const allowed=statusChoices(schema,path);
 if(allowed&&(!allowed.includes(String(value))||typeof value!=='string'))throw Error(`${path} 상태는 ${allowed.join(', ')} 중에서 선택하세요.`);
 if(Array.isArray(value))value.forEach((v,i)=>validateEditableStatuses(schema,v,`${path}.${i}`));
 else if(value&&typeof value==='object')Object.entries(value).forEach(([key,v])=>validateEditableStatuses(schema,v,`${path}.${key}`));
}
