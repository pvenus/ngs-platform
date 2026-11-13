export type ReleaseReceipt={schemaVersion:'ngs-release.v1';releaseId:string;sourceHash:string;adapterHash:string;buildId:string;buildStartedAt:string;environment:'local'|'space';state:'prepared'|'built';finishedAt:string|null;artifactHash:string|null};
export function readReleaseReceipt(value:unknown):ReleaseReceipt|null{
 if(!value||typeof value!=='object')return null;
 const v=value as Record<string,unknown>,hash=(s:unknown)=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s),time=(s:unknown)=>typeof s==='string'&&Number.isFinite(Date.parse(s));
 if(v.schemaVersion!=='ngs-release.v1'||!hash(v.sourceHash)||v.releaseId!=='ngs-'+String(v.sourceHash).slice(0,12)||!hash(v.adapterHash)||!hash(v.buildId)||!time(v.buildStartedAt)||!['local','space'].includes(String(v.environment))||!['prepared','built'].includes(String(v.state)))return null;
 if(v.state==='built'&&(!time(v.finishedAt)||!hash(v.artifactHash)))return null;
 return v as ReleaseReceipt;
}
