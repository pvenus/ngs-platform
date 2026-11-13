import {frontendFetch}from '@/lib/frontend-transport.mjs';
import {type PuzzleRow}from './puzzle-design-api';
import {operationResponse} from '../../lib/shared-runtime/ngs-content-operation-ui.mjs';
export async function contentOperationsRpc(value:PuzzleRow){const response=await frontendFetch('/api/resource-design',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});const result=operationResponse(await response.json());if(!response.ok)throw Error(String(result.error||'정식 콘텐츠 요청을 처리하지 못했습니다.'));return result;}
