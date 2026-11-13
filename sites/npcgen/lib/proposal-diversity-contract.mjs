import {groundDesign,stableGrounding} from './proposal-design-grounding.mjs';
// V2 client checks mirror server evidence/lexical checks; semantics remain reviewable.
const norm=s=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}_]/gu,'');
const grams=s=>new Set(Array.from({length:Math.max(1,s.length-2)},(_,i)=>s.slice(i,i+3)));
function similarity(a,b){a=norm(a);b=norm(b);if(a===b)return 1;const x=grams(a),y=grams(b);return [...x].filter(v=>y.has(v)).length/Math.max(1,new Set([...x,...y]).size);}
function narrative(v){if(Array.isArray(v))return v.map(narrative).join(' ');if(v&&typeof v==='object')return Object.entries(v).filter(([k])=>['value','sentence','description'].includes(k)).map(([,x])=>String(x)).join(' ')+' '+Object.entries(v).filter(([k])=>['summary','items'].includes(k)).map(([,x])=>narrative(x)).join(' ');return '';}
function evidenceValue(payload,path){if(typeof path!=='string'||!/^\/(description|value|sentence|summary\/sentence|items\/\d+\/(value|summary\/sentence))$/.test(path))return null;let v=payload;for(const k of path.slice(1).split('/'))v=v?.[k];return typeof v==='string'?v:null;}
export function diversityErrors(set){
 if(set.schemaVersion!=='npc-proposal-set.v2')return [];
 const errors=[],axes=set.plan?.axes,values=set.alternatives;
 if(!axes||axes.length<2||!set.plan?.directions||set.plan.directions.length!==3){return ['DIVERSITY_PLAN_REQUIRED'];}
 if(JSON.stringify(axes)!==JSON.stringify(set.styleAxes))errors.push('DIVERSITY_PLAN_DRIFT');
 for(let i=0;i<3;i++){
  const a=values[i],d=set.plan.directions[i];
  if(!a?.designDirection||!a.distinctKeywords||!a.requirementCoverage){errors.push('DIVERSITY_ALTERNATIVE_SHAPE');continue;}
  if(d.slot!==i||['designDirection','distinctKeywords','styles'].some(k=>JSON.stringify(d[k])!==JSON.stringify(a[k])))errors.push('DIVERSITY_PLAN_DRIFT');
  const tags=a.distinctKeywords,common=new Set(set.keywords.map(norm));
  if(tags.some(k=>common.has(norm(k))))errors.push('DIVERSITY_COMMON_KEYWORD_REPEATED');
  const summary=set.scope.action==='category.summary.modify'?a.payload:a.payload.summary;
  if(JSON.stringify(summary?.keywords)!==JSON.stringify(tags))errors.push('DIVERSITY_SUMMARY_KEYWORDS');
  const body=narrative(a.payload);
  try{const grounding=groundDesign(a,set.validationReport?.validatorVersion||'design-text-reference.v1');if(set.validationReport&&stableGrounding(set.validationReport.designReferences?.[i])!==stableGrounding({slot:i,...grounding}))errors.push('DIVERSITY_DESIGN_REPORT_MISMATCH');}catch(e){errors.push(e.message);}
  const required=new Set([...set.keywords.map((_,n)=>'keyword:'+n),...set.commonConstraints.map((_,n)=>'constraint:'+n)]),seen=new Set(),references=new Set(),counts=new Map();
  if(a.requirementCoverage.length<required.size||a.requirementCoverage.length>32)errors.push('DIVERSITY_REQUIREMENT_MISSING');
  for(const proof of a.requirementCoverage){const key=proof.kind+':'+proof.index,v=evidenceValue(a.payload,proof.path);if(!required.has(key)||!Number.isInteger(proof.index))errors.push('DIVERSITY_REQUIREMENT_MISSING');const signature=JSON.stringify([proof.kind,proof.index,proof.path,proof.evidence]);counts.set(key,(counts.get(key)||0)+1);if(references.has(signature)||counts.get(key)>4)errors.push('DIVERSITY_REQUIREMENT_MISSING');references.add(signature);if(!v||!proof.evidence||!v.includes(proof.evidence)||(proof.kind==='keyword'&&!proof.evidence.includes(set.keywords[proof.index])))errors.push('DIVERSITY_EVIDENCE_FALSE');seen.add(key);}
  if(seen.size!==required.size||[...required].some(k=>!seen.has(k)))errors.push('DIVERSITY_REQUIREMENT_MISSING');
 }
 for(let i=0;i<3;i++)for(let j=0;j<i;j++){
  const a=values[i],b=values[j];if(!a?.designDirection||!b?.designDirection||!a.distinctKeywords||!b.distinctKeywords)continue;
  const sa=new Map(a.styles.map(s=>[s.axisId,s.value])),sb=new Map(b.styles.map(s=>[s.axisId,s.value]));if([...sa].filter(([k,v])=>sb.get(k)!==v).length<2)errors.push('DIVERSITY_STYLE_TOO_CLOSE');
  const ta=new Set(a.distinctKeywords.map(norm)),tb=new Set(b.distinctKeywords.map(norm));if([...ta].filter(k=>!tb.has(k)).length<2||[...tb].filter(k=>!ta.has(k)).length<2)errors.push('DIVERSITY_KEYWORDS_TOO_CLOSE');
  if(similarity(a.designDirection.mechanism,b.designDirection.mechanism)>=.8||similarity(a.designDirection.tradeoff,b.designDirection.tradeoff)>=.8)errors.push('DIVERSITY_DIRECTION_TOO_CLOSE');
  let bodies=[narrative(a.payload),narrative(b.payload)];for(const k of [...set.keywords,...set.commonConstraints])bodies=bodies.map(v=>v.split(k).join(''));if(similarity(...bodies)>=.8)errors.push('DIVERSITY_CONTENT_TOO_CLOSE');
 }
 return [...new Set(errors)];
}
