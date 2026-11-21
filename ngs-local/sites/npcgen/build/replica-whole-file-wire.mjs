/** Transport-only, single binary write protocol for already-authorized replica callers. */
export const wholeFileSyncPath='/api/ngs-file-sync-file';
// Cloudflare R2's native single PUT maximum. An HTTP gateway can impose a lower
// bound and return 413; this route never silently splits a file.
export const wholeFileObjectMaximum=5*1024**3-5*1024**2;
const fault=(status,code)=>{throw Object.assign(Error(code),{status});};
const invalid=()=>fault(400,'NGS_FILE_SYNC_INVALID');
const toBase64url=value=>btoa(value).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');
function decodedPath(value){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,1366}$/u.test(value))invalid();
 try{
  const binary=atob(value.replace(/-/g,'+').replace(/_/g,'/'));
  if(toBase64url(binary)!==value)invalid();
  return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(binary,ch=>ch.charCodeAt(0)));
 }catch{invalid();}
}
export function parseWholeFileHeaders(header){
 if(header('content-type')!=='application/octet-stream')fault(415,'NGS_FILE_SYNC_BINARY_REQUIRED');
 const len=header('content-length');
 if(typeof len!=='string'||! /^(?:0|[1-9][0-9]{0,15})$/u.test(len))invalid();
 const size=Number(len);
 if(!Number.isSafeInteger(size)||size>wholeFileObjectMaximum)fault(413,'NGS_FILE_SYNC_BODY_TOO_LARGE');
 const syncId=header('x-ngs-sync-id'),sha256=header('x-ngs-file-sha256'),path=decodedPath(header('x-ngs-file-path'));
 if(typeof syncId!=='string'||!/^ngs\.sync\.[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u.test(syncId)||
    typeof sha256!=='string'||! /^[a-f0-9]{64}$/u.test(sha256))invalid();
 return {syncId,path,sha256,size};
}
const publicErrors=Object.freeze({
 NGS_FILE_SYNC_INVALID:400,NGS_FILE_SYNC_INVALID_SESSION:409,NGS_FILE_SYNC_REPLICA_CHANGED:409,
 NGS_FILE_SYNC_CONTENT_MISMATCH:409,NGS_FILE_SYNC_OFFSET_INVALID:409,NGS_FILE_SYNC_INCOMPLETE:409,
 NGS_FILE_SYNC_BODY_TOO_LARGE:413,NGS_FILE_SYNC_BINARY_REQUIRED:415,
});
export function wholeFileError(error){
 const code=error?.message,status=publicErrors[code];
 if(status===error?.status&&Number.isSafeInteger(status))return {status,error:code};
 if(error?.status===413||error?.$metadata?.httpStatusCode===413)return {status:413,error:'NGS_FILE_SYNC_BODY_TOO_LARGE'};
 return {status:503,error:'NGS_FILE_SYNC_UNAVAILABLE'};
}
