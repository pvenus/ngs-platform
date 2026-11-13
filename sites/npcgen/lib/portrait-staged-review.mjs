const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function stagedReview(value,requestId){
 if(!object(value)||value.schemaVersion!=='npc-portrait-staged-review.v1'||value.requestId!==requestId||typeof value.registered!=='boolean'||typeof value.published!=='boolean'||value.published&&!value.registered||value.readOnly!==true||!Array.isArray(value.results)||!sha(value.manifestHash))throw Error('STAGED_REVIEW_CONTRACT');
 const indices=new Set();
 for(const r of value.results){const q=r.imageRequest;if(!object(r)||!Number.isInteger(r.index)||r.index<0||r.index>2||indices.has(r.index)||!sha(r.sha256)||r.mime!=='image/png'||!Number.isInteger(r.size)||r.size<=0||r.size>20000000||!Number.isInteger(r.width)||!Number.isInteger(r.height)||r.width<=0||r.height<=0||typeof r.registered!=='boolean'||!object(q)||q.operation!=='portrait-review-asset'||q.requestId!==requestId||q.index!==r.index||q.sha256!==r.sha256||Object.keys(q).some(k=>!['operation','requestId','index','sha256'].includes(k)))throw Error('STAGED_REVIEW_RESULT');indices.add(r.index);}
 return value;
}
export async function stagedAsset(value,requestId,result){
 if(!object(value)||value.schemaVersion!=='npc-portrait-staged-asset.v1'||value.requestId!==requestId||value.index!==result.index||value.sha256!==result.sha256||value.mime!=='image/png'||value.size!==result.size||typeof value.base64!=='string'||value.base64.length!==Math.ceil(value.size/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.base64))throw Error('STAGED_ASSET_CONTRACT');
 const bytes=Uint8Array.from(atob(value.base64),c=>c.charCodeAt(0));if(bytes.length!==value.size)throw Error('STAGED_ASSET_SIZE');
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 const view=new DataView(bytes.buffer);if(hash!==result.sha256||bytes.length<24||[137,80,78,71,13,10,26,10].some((b,i)=>bytes[i]!==b)||view.getUint32(16)!==result.width||view.getUint32(20)!==result.height)throw Error('STAGED_ASSET_HASH_OR_PNG');
 return bytes;
}
export const reviewLabels={faceVariation:'얼굴 디자인 다양성',hairVariation:'머리 디자인 다양성',costumeVariation:'의상 디자인 다양성',sharedStyle:'공통 화풍',singleComposition:'단일 구도',fullBody:'전신',transparentBackground:'투명 배경',animationStyle:'애니메이션 화풍',worldAndCanonicalCore:'세계관·인물 핵심',sourceRepresentativeUnchanged:'기존 대표 보존'};

export function stagedGenerationLabel(v){return v.results.length===3?'3안 이미지 생성 완료 · '+(v.registered?(v.published?'정식 등록·게시 완료':'정식 등록 · 게시 대기'):'미등록'):'생성 원본 '+v.results.length+'/3 · 파일·호출 상태 확인 필요';}
