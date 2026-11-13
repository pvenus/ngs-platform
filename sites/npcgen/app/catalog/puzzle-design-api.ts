import {frontendFetch} from '@/lib/frontend-transport.mjs';
export type PuzzleRow=Record<string,unknown>;
export const row=(v:unknown):PuzzleRow=>v&&typeof v==='object'&&!Array.isArray(v)?v as PuzzleRow:{};
export const list=(v:unknown):PuzzleRow[]=>Array.isArray(v)?v.map(row):[];
export async function puzzleRpc(operation:string,payload:PuzzleRow={}):Promise<PuzzleRow>{const bytes=JSON.stringify({operation,...payload}),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(bytes)))].map(x=>x.toString(16).padStart(2,'0')).join('');const response=await frontendFetch('/api/production-sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation,...payload,commandId:'puzzle.ui.'+hash})});const value=row(await response.json());if(!response.ok||value.error)throw Error(String(value.error||'퍼즐 설계 요청 실패'));return row(value);}
export function configurationWithHash(value:PuzzleRow){return {...row(value.configuration),configurationHash:value.configurationHash};}
