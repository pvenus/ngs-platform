import {requestActionBadge} from '../../lib/proposal-request-lifecycle.mjs';

export function ProposalRequestKind({action}:{action:string}){
 const kind=requestActionBadge(action);
 return <span className="proposal-request-kind" data-kind={kind.tone} aria-label={`요청 종류: ${kind.description}`} title={`요청 종류: ${kind.description}`}>{kind.label}</span>;
}
