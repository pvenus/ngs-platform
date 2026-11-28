import {pullSpaceToP2,pullSpaceToObject} from './sync.mjs';

/** Single serial pull loop, independent of the browser and request relay. */
export function backgroundViewerSync({mirror,replica,remote,intervalMs=60_000,onSnapshot=()=>{},onState=()=>{}}){
 let granted=null;
 let control=null,timer=null,closed=false,pending=null,paused=false;
 const start=()=>{
  if(closed||paused||pending)return pending;
  clearTimeout(timer);
  control=new AbortController();
  const {signal}=control;
  pending=Promise.resolve().then(async()=>{
   onState({state:'running'});
   try{
    const result=await (replica?pullSpaceToObject:pullSpaceToP2)({mirror,replica,signal,onManifest:manifest=>{
     if(granted?.some(r=>!manifest.resources.includes(r))){granted=null;onSnapshot(null);}
    },remote:async path=>{
     let response;
     try{response=await remote(path,{signal});}
     catch(e){
      if(e?.message==='VIEWER_CODEX_CONNECTION_REQUIRED')control.abort(e);
      throw e;
     }
     if(response.status===401||response.status===403){
      onSnapshot(null);control.abort(Error('VIEWER_SPACE_SIGN_IN_REQUIRED'));
      throw signal.reason;
     }
     return response;
    }});
    signal.throwIfAborted();
    const verified=replica?result.snapshot:mirror.snapshot();
    if(verified){granted=verified.resources;onSnapshot(verified);}
    onState({state:'completed',files:result.files,changed:result.changed,failed:result.failed,removed:result.removed});
   }catch(e){
    if(closed)return;
    onState({state:'failed',error:signal.reason?.message==='VIEWER_SPACE_SIGN_IN_REQUIRED'?
     'VIEWER_SPACE_SIGN_IN_REQUIRED':
     (e?.message==='VIEWER_CODEX_CONNECTION_REQUIRED'||signal.reason?.message==='VIEWER_CODEX_CONNECTION_REQUIRED')?'VIEWER_CODEX_CONNECTION_REQUIRED':'VIEWER_SPACE_SYNC_FAILED'});
   }finally{
    pending=null;control=null;
    if(!closed){timer=setTimeout(start,intervalMs);timer.unref?.();}
   }
  });
  return pending;
 };
 const pause=()=>{
  if(pending||closed)return false;
  paused=true;clearTimeout(timer);return true;
 };
 const resume=()=>{
  if(!paused||closed)return;
  paused=false;timer=setTimeout(start,intervalMs);timer.unref?.();
 };
 const close=async()=>{closed=true;clearTimeout(timer);control?.abort(Error('VIEWER_SYNC_CLOSED'));await pending;};
 return {start,pause,resume,close};
}
