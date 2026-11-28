import {pullSpaceToP2} from './sync.mjs';

/** Single serial pull loop, independent of the browser and request relay. */
export function backgroundViewerSync({mirror,remote,intervalMs=60_000,onSnapshot=()=>{},onState=()=>{}}){
 let control=null,timer=null,closed=false,pending=null;
 const start=()=>{
  if(closed||pending)return pending;
  clearTimeout(timer);
  control=new AbortController();
  const {signal}=control;
  pending=(async()=>{
   const begin=Date.now();
   onState({state:'running'});
   try{
    const result=await pullSpaceToP2({mirror,signal,remote:async path=>{
     const response=await remote(path,{signal});
     if(response.status===401||response.status===403){
      onSnapshot(null);control.abort(Error('VIEWER_SPACE_SIGN_IN_REQUIRED'));
      throw signal.reason;
     }
     return response;
    }});
    signal.throwIfAborted();
    onSnapshot(mirror.snapshot());
    onState({state:'completed',files:result.files,changed:result.changed,failed:result.failed,removed:result.removed});
   }catch(e){
    if(closed)return;
    onState({state:'failed',error:signal.reason?.message==='VIEWER_SPACE_SIGN_IN_REQUIRED'?
     'VIEWER_SPACE_SIGN_IN_REQUIRED':'VIEWER_SPACE_SYNC_FAILED'});
   }finally{
    pending=null;control=null;
    if(!closed){timer=setTimeout(start,Math.max(1000,intervalMs-(Date.now()-begin)));timer.unref?.();}
   }
  })();
  return pending;
 };
 const close=async()=>{closed=true;clearTimeout(timer);control?.abort(Error('VIEWER_SYNC_CLOSED'));await pending;};
 return {start,close};
}
