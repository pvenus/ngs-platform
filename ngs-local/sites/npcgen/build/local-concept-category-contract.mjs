export const conceptCategoryRequestType='concept.category.workflow';
const schemaVersion='ngs.concept-category-workflow.v1';
const categoryId=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const groupId=/^[A-Za-z0-9._:-]{1,180}$/;
const newId=/^category\.add\.[a-f0-9]{32}$/;
const text=(value,min,max)=>{
 if(typeof value!=='string'||value!==value.trim())return false;
 const length=[...value].length;
 return length>=min&&length<=max;
};
export const validConceptGroupId=value=>typeof value==='string'&&groupId.test(value)&&
 !['__proto__','constructor','prototype'].includes(value);

const baseKeys='categoryId,groupId,operation,outline,projectId,requirements,schemaVersion,title';
const addKeys='categoryId,groupId,operation,outline,projectId,requiredSections,requirements,schemaVersion,title';
export const validRequiredSections=values=>Array.isArray(values)&&values.length>=1&&values.length<=16&&
 new Set(values).size===values.length&&values.every(v=>text(v,1,80)&&v.isWellFormed()&&!/[\p{Cc}\u2028\u2029]/u.test(v));
export function parseRequiredSections(value){
 const headings=typeof value==='string'?value.split(/\r\n|[\r\n\u2028\u2029]/).map(v=>v.trim()).filter(Boolean):[];
 if(!validRequiredSections(headings))throw Error('CONCEPT_REQUIRED_SECTIONS_INVALID');
 return headings;
}

export function validConceptCategoryRequest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.schemaVersion!==schemaVersion||value.projectId!=='binari'||typeof value.categoryId!=='string'||
  !text(value.title,1,120))return false;
 const keys=Object.keys(value).sort().join(',');
 if(keys!==baseKeys&&!(keys===addKeys&&value.operation==='add'&&validRequiredSections(value.requiredSections)))return false;
 if(value.operation==='add'){
  if(!newId.test(value.categoryId)||!validConceptGroupId(value.groupId))return false;
 }else if(!['replace','update','migrate','remove'].includes(value.operation)||!categoryId.test(value.categoryId)||value.groupId!==null)return false;
 if(value.operation==='update')return value.outline===''&&text(value.requirements,1,4000);
 return ['migrate','remove'].includes(value.operation)?
  value.outline===''&&value.requirements==='':text(value.outline,1,4000)&&text(value.requirements,0,4000);
}

export function makeConceptCategoryRequest({projectId,operation,target,title,group,outline,requirements,requiredSections},uuid){
 const noAuthoring=['migrate','remove'].includes(operation);
 const command={schemaVersion,projectId,operation,categoryId:operation==='add'?'category.add.'+uuid().replaceAll('-',''):target?.id,
  groupId:operation==='add'?group:null,title:(target?.title??title??'').trim(),
  outline:noAuthoring||operation==='update'?'':(outline??'').trim(),requirements:noAuthoring?'':(requirements??'').trim(),
  ...(operation==='add'?{requiredSections:parseRequiredSections(requiredSections)}:{})};
 if(!validConceptCategoryRequest(command))throw Error(operation==='update'?'수정 요청을 1~4,000자로 입력해 주세요.':
  '카테고리 이름, 상위 그룹과 큰 줄기를 확인해 주세요.');
 return command;
}
