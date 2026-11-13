"use client";
import {createPortal} from 'react-dom';
import {useNewRequestStatus} from './new-request-modal';
/** Request submission uses a separate label from candidate confirmation. */
export function RequestFormActions({formId,busy,disabled,reason}:{formId:string;busy:boolean;disabled:boolean;reason?:string}){const modal=useNewRequestStatus();const actions=<div className="request-form-actions" aria-busy={busy}>{reason&&<p role="status">{reason}</p>}<div className="request-form-buttons">{modal&&<button type="button" disabled={busy} onClick={modal.dismiss}>취소</button>}<button type="submit" form={formId} data-action-tone="request" disabled={disabled||busy}>{busy?'처리 중…':'요청'}</button></div></div>;return modal?.footer?createPortal(actions,modal.footer):actions;}
