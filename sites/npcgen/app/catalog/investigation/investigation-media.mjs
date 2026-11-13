// Preset resources omit transport provider; only admitted visible cards are loaded.
export function investigationImages(run){
 const refs=new Map();
 for(const item of run.definition.items){
  if(!run.available.includes(item.id)||item.resource===null)continue;
  const r=item.resource;
  if(typeof r.fileAssetId!=='string'||r.version!==1||r.mime!=='image/png'||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('관찰 이미지의 정확한 등록 버전·해시가 필요합니다.');
  const prior=refs.get(r.fileAssetId);if(prior&&prior.sha256!==r.sha256)throw Error('같은 관찰 이미지의 해시가 다릅니다.');
  refs.set(r.fileAssetId,{provider:'registered',...r});
 }
 return [...refs.values()];
}
