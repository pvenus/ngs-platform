export function portraitIntentError(value:string){const n=value.trim().length;return n<5?'요청 내용을 5자 이상 입력하세요.':n>4000?'요청 내용은 4,000자 이내로 입력하세요.':'';}
export function portraitRequestInput(projectId:string,characterRef:unknown,intent:string){return {schemaVersion:'npc-portrait-simple.v1',projectId,characterRef,intent:intent.trim(),resultCount:3,setActive:false};}
