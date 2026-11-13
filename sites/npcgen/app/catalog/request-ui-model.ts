import {requestAdapterLabels} from '../../lib/request-comparison-contract.mjs';
import type {Json,RecordData} from './adapter';
export const requestTypes:Record<string,string>=requestAdapterLabels;
function object(value:unknown):Record<string,unknown>|undefined{if(value===undefined||value===null)return undefined;if(typeof value!=='object'||Array.isArray(value))throw Error('요청 분류 객체 형식이 올바르지 않습니다.');return Object.fromEntries(Object.entries(value));}
function actionText(value:unknown):string|undefined{if(value===undefined||value===null)return undefined;if(typeof value!=='string')throw Error('요청 작업 형식이 올바르지 않습니다.');return value;}
export function requestKind(v:{requestType:string;metadata?:Json|RecordData;request?:Json|RecordData}){if(v.requestType==='story.node.image')return 'add';const metadata=object(v.metadata),metadataRequest=object(metadata?.request),request=object(v.request);const action=actionText(metadataRequest?.action)||actionText(metadataRequest?.operation)||actionText(request?.action)||v.requestType;return /archive|remove|delete/.test(action)?'remove':/restore/.test(action)?'restore':/add|create|generate|manual/.test(action)?'add':'modify';}
export function terminal(v:{state:string}){return ['completed','discarded','conflict'].includes(v.state);}
export const stateNames:Record<string,string>={queued:'대기',processing:'처리 중',generated:'생성 완료',awaiting_selection:'선택 대기',selected:'선택됨',source_applied:'원본 반영',sync_pending:'동기화 대기',synchronizing:'동기화 중',completed:'완료',discarded:'폐기',conflict:'기준 충돌',blocked:'보류',failed:'실패',retry_wait:'재시도 대기'};

export const requestGroups=[{id:'concept',label:'마스터 컨셉'},{id:'npc',label:'NPC'},{id:'story',label:'스토리'},{id:'knowledge',label:'지식'},{id:'project',label:'프로젝트'},{id:'other',label:'기타'}];
export function requestGroup(v:{requestType:string}){const type=v.requestType||'';return type.startsWith('concept.')?'concept':type.startsWith('npc.')||type.startsWith('portrait.')?'npc':type.startsWith('story.')?'story':type.startsWith('knowledge.')?'knowledge':type.startsWith('project.')?'project':'other';}
export function filterProjectRequests<T extends {projectId:string;requestType:string;state:string}>(items:T[],projectId:string,groups:string[],status:string){return items.filter(v=>v.projectId===projectId&&groups.includes(requestGroup(v))&&(status==='all'||(status==='pending'?!terminal(v):terminal(v))));}
