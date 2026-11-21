/** Only RS-MCP calls this, after a successful existing NGS queue read. */
const endpoint='http://127.0.0.1:8090/api/service-heartbeat';
const serverNames=Object.freeze({local:'ngs-local',space:'ngs-space'});
const validSha=value=>typeof value==='string'&&value.length===40&&/^[a-f0-9]{40}$/.test(value);

export function createNgsHealthRelay({send=fetch,now=()=>performance.now(),signal}={}){
 const previous=new Map();
 return (source,sha)=>{
  if(!Object.hasOwn(serverNames,source)||signal?.aborted)return;
  const commitSha=validSha(sha)?sha:undefined;
  const time=now(),prior=previous.get(source);
  // One in flight per source. Never wait in the queue pump.
  if(prior?.pending||prior&&prior.sha===commitSha&&time<prior.nextAt||prior&&time<prior.retryAt)return;
  const row={pending:true,sha:commitSha,nextAt:time+60_000,retryAt:time};
  previous.set(source,row);
  void (async()=>{
   try{
    const timeout=AbortSignal.timeout(1500);
    const rsp=await send(endpoint,{method:'POST',redirect:'error',
     signal:signal?AbortSignal.any([signal,timeout]):timeout,
     headers:{'Content-Type':'application/json'},
     body:JSON.stringify({serverName:serverNames[source],...(commitSha?{commitSha}:{})})});
    void rsp.body?.cancel().catch(()=>{});
    if(rsp.status!==200)throw Error('OPS_HEALTH_UNAVAILABLE');
   }catch{
    // Cool down briefly on an unavailable OPS, not on NGS/RS work.
    row.nextAt=row.retryAt=now()+5000;
   }finally{row.pending=false;}
  })();
 };
}
