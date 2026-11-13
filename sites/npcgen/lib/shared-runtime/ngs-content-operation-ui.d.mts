type Row=Record<string,unknown>;
export type ContentRpc=(value:Row)=>Promise<Row>;
export function canonicalInput(value:unknown):unknown;
export function operationKey(operation:string,payload:Row):Promise<string>;
export function contentCall(rpc:ContentRpc,operation:string,payload?:Row):Promise<Row>;
export function jsonDetails(title:string,value:unknown):HTMLDialogElement;
export function openContentOperation(options:{rpc:ContentRpc;role?:string;input?:Row;sourceRefs?:Row[];origin?:'user-input'|'reuse'|'model-output'|'code';requestId?:string;onApplied?:(value:Row)=>void|Promise<void>}):Promise<Row|null>;

export function operationResponse(value:unknown):Row;
