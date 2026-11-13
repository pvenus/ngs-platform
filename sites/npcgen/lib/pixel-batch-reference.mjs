/** Exact local batch linkage. No ordinary portrait grouping or summary ref guessing. */
const row=x=>x&&typeof x==='object'&&!Array.isArray(x)?x:{};
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
export function verifiedPixelBatch(summary,value,projectId){
 const s=row(summary),v=row(value),c=row(v.common),request=row(v.request),source=row(request.source);
 if(projectId!=='binari'||s.projectId!==projectId||s.requestType!=='npc.pixel-sd.batch.generate'||s.requestId!==v.requestId||c.requestId!==s.requestId||c.projectId!==projectId||c.requestType!==s.requestType||request.schemaVersion!=='ngs.pixel-batch.v1'||request.count!==3||source.projectId!==projectId)throw Error('PIXEL_BATCH_SCOPE');
 if(!Array.isArray(c.payloadRefs)||c.payloadRefs.filter(r=>r.domain===s.requestType&&r.referenceId===s.requestId&&r.schemaVersion===request.schemaVersion).length!==1)throw Error('PIXEL_BATCH_REFERENCE');
 if(!Array.isArray(v.results)||v.results.length!==3)throw Error('PIXEL_BATCH_RESULT_COUNT');
 let ready=0;
 for(const item of v.results){const child=row(item),g=row(child.generation),gs=row(row(g.request).source);if(gs.projectId!==projectId||gs.npcId!==source.npcId||gs.npcRevision!==source.npcRevision||gs.sha256!==source.sha256||gs.fileAssetId!==source.fileAssetId)throw Error('PIXEL_BATCH_SOURCE');
  if(!Array.isArray(child.normalizations))throw Error('PIXEL_BATCH_NORMALIZATIONS');
  for(const n0 of child.normalizations){const n=row(n0),r=row(n.resource),nc=row(n.common);if(row(n.request).sourceRequestId!==g.requestId)throw Error('PIXEL_BATCH_CHILD_LINK');
   if(row(n.pipeline).finalReady===true){if(nc.state!=='completed'||row(nc.publicationReceipt).verified!==true||!sha(r.sha256)||r.sha256!==row(row(n.result).after).sha256)throw Error('PIXEL_BATCH_UNVERIFIED_RESULT');ready++;}}
 }
 if(row(v.pipeline).finalReady===true&&(ready!==3||!['awaiting_selection','completed'].includes(c.state)))throw Error('PIXEL_BATCH_PREMATURE_READY');
 return v;
}
