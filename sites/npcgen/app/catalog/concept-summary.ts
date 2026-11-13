import type {Json} from './adapter';
export type ConceptSummary={kind:'legacy';sentence:string}|{kind:'keywords';keywords:string[];sentence:string};
/** Reads legacy strings and the strict versioned wire contract without rendering invalid objects. */
export function readConceptSummary(value:Json|undefined):ConceptSummary|null{
 if(typeof value==='string')return value.trim()&&value.length<=600?{kind:'legacy',sentence:value}:null;
 if(!value||typeof value!=='object'||Array.isArray(value))return null;
 const {schemaVersion,keywords,sentence}=value;
 if(Object.keys(value).sort().join('|')!=='keywords|schemaVersion|sentence'||schemaVersion!=='npc-concept-summary.v1'||!Array.isArray(keywords)||keywords.length<1||keywords.length>12||!keywords.every((k):k is string=>typeof k==='string'&&k===k.trim()&&k.length>0&&k.length<=100)||new Set(keywords).size!==keywords.length||typeof sentence!=='string'||sentence!==sentence.trim()||!sentence||sentence.length>600)return null;
 return {kind:'keywords',keywords,sentence};
}
