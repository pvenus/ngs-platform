/** One read at a time. Only scope disposal and the bounded deadline abort it. */
export function createReadPoller({read,onValue,onError,onState=()=>{},canRun=()=>true,interval=30000,timeout=120000,setTimer=setTimeout,clearTimer=clearTimeout}){
 let disposed=false,inflight=null,controller=null,timer=null,deadline=null,cancelRead=null;
 function schedule(){if(!disposed&&interval>0){clearTimer(timer);timer=setTimer(()=>void refresh(),interval);}}
 function refresh(){
  if(disposed)return Promise.resolve();if(inflight)return inflight;clearTimer(timer);
  if(!canRun()){schedule();return Promise.resolve();}
  controller=new AbortController();const c=controller;let expired=false;onState(true);
  const timeoutError=()=>Object.assign(Error('조회 시간이 초과됐습니다. 기존 결과를 유지합니다. 다시 조회해 주세요.'),{code:'READ_TIMEOUT'});
  const timed=new Promise((_,reject)=>{cancelRead=reject;deadline=setTimer(()=>{expired=true;c.abort();reject(timeoutError());},timeout);});
  inflight=(async()=>{try{const value=await Promise.race([read(c.signal),timed]);if(!disposed&&!c.signal.aborted)onValue(value);}catch(e){if(!disposed&&(!c.signal.aborted||expired))onError(expired?timeoutError():e);}finally{clearTimer(deadline);inflight=null;if(!disposed){onState(false);schedule();}}})();
  return inflight;
 }
 return {refresh,dispose(){disposed=true;clearTimer(timer);clearTimer(deadline);controller?.abort();cancelRead?.(Object.assign(Error('Scope changed'),{name:'AbortError'}));},get active(){return !!inflight;}};
}
export function mergeReadResults(previous,response){
 const missing=new Set(response.unavailable||[]),domain=v=>({'concept.content.proposals':'concept','story.design':'story.design','npc.category.request':'npc.category','portrait.generate':'portrait'}[v.requestType]||'other');
 const kept=previous.filter(v=>missing.has(domain(v)));return [...new Map([...kept,...response.requests||[]].map(v=>[v.requestId,v])).values()];
}
