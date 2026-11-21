/** The UI observes the exact receipts of the local handoff; it never submits to RS. */
const queueId=/^ngs\.local\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;
const official=/^request\.official\.[a-f0-9]{64}$/u;
const exact=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
function wait(ms,signal){
 if(signal?.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{
  const abort=()=>{clearTimeout(timer);reject(signal.reason);};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
  signal?.addEventListener('abort',abort,{once:true});
 });
}
export async function submitQueuedRequest(command,{jsonPost,signal,fetcher=fetch,pause=wait}){
 const path='/api/requests',options={cache:'no-store',credentials:'same-origin',redirect:'error',signal};
 const pending=await fetcher(path,{...jsonPost(command),...options});
 if(pending.status!==202)return pending;
 const info=await pending.clone().json();
 if(!exact(info,['queueId','status'])||info.status!=='queued'||typeof info.queueId!=='string'||!queueId.test(info.queueId))return pending;
 for(let i=0;i<15;i++){
  await pause(i===0?150:800,signal);
  const outcome=await fetcher(path+'?'+new URLSearchParams({queueId:info.queueId}),options);
  if(outcome.status===202)continue;
  if(outcome.status!==200)return outcome.status===404?pending:outcome;
  const q=await outcome.json(),r=q?.receipt;
  if(!exact(q,['queueId','status','receipt'])||q.queueId!==info.queueId||q.status!=='registered'||
   !exact(r,['officialRequestId','status'])||r.status!=='registered'||typeof r.officialRequestId!=='string'||!official.test(r.officialRequestId))
   return pending;
  // Preserve existing form behavior for officially accepted receipts only.
  return Response.json(r,{status:201});
 }
 return pending;
}
