const row=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
export function conceptProposalReference(summary,detail=summary){
 const s=row(summary),d=row(detail);
 if(typeof s.requestId!=='string'||typeof s.projectId!=='string'||s.requestType!=='concept.content.proposals'||d.requestId!==s.requestId||d.projectId!==s.projectId||d.requestType!==s.requestType)throw Error('컨셉 요청 상세의 프로젝트·요청 연결이 일치하지 않습니다.');
 if(!Array.isArray(d.payloadRefs))throw Error('후보 참조를 확인할 수 없습니다.');
 const refs=d.payloadRefs.filter(x=>row(x).domain==='concept.proposals');
 if(!refs.length)throw Error('후보 참조를 확인할 수 없습니다.');
 if(refs.some(x=>typeof x.referenceId!=='string'||!/^proposal\.request\.[A-Za-z0-9._:-]{1,180}$/.test(x.referenceId)))throw Error('컨셉 후보 참조 형식이 올바르지 않습니다.');
 const unique=new Set(refs.map(x=>x.referenceId));if(unique.size!==1)throw Error('컨셉 후보 참조가 중복되어 요청을 확인할 수 없습니다.');
 return {domain:'concept.proposals',referenceId:refs[0].referenceId};
}
