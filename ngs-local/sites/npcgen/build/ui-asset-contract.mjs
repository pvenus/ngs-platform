/** Official/UI-only envelope; no file bytes, paths, provider, or worker settings. */
export const uiPath='/api/ui-workspace',uiStagePath='/api/ui-assets/stage';
export const uiGenerate='ui.asset.generate',uiImport=`ui.asset.import`;
export const uiSchemas=Object.freeze({[uiGenerate]:'ngs.ui-asset-generate.v1',[uiImport]:'ngs.ui-asset-import.v1'});
export const uiDesignCategory='category.add.4573d0a2e2c659fc0bba561ba5774ac8';
export const uiMaxPng=8*1024*1024;
export const uiSha=s=>typeof s==='string'&&/^[a-f0-9]{64}$/u.test(s);
export const uiId=s=>typeof s==='string'&&/^request\.official\.[a-f0-9]{64}$/u.test(s);
export const uiKind=s=>s==='logo'||s==='button';
const encoder=new TextEncoder();
export const uiText=(s,max)=>typeof s==='string'&&s.trim()===s&&s.isWellFormed()&&[...s].length>=1&&[...s].length<=max&&encoder.encode(s).length<=max*4&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/u.test(s);
const exact=(o,k)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===k;
export function validUiRequest(type,p){
 if(!Object.hasOwn(uiSchemas,type)||!exact(p,type===uiImport?'kind,projectId,schemaVersion,sha256,title':'kind,projectId,prompt,schemaVersion,title'))return false;
 return p.schemaVersion===uiSchemas[type]&&p.projectId==='binari'&&uiKind(p.kind)&&uiText(p.title,120)&&
  (type===uiImport?uiSha(p.sha256):uiText(p.prompt,2000)&&encoder.encode(p.prompt).length<=4000);
}
