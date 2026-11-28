/** One user submission, one forward, no spool, timer, or retry on any outcome. */
const receipt=/^ngs\.space\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export async function forwardViewerRequest(command,send){
 try{
  const outcome=await send(command);
  const payload=outcome?.receipt;
  if(outcome?.status===202&&payload?.status==='queued'&&receipt.test(payload.queueId??''))
   return {status:202,body:{status:'queued',queueId:payload.queueId}};
  // Only explicit caller/validation rejection is a known non-admission.
  if([400,401,403,404,405,409,413,415,422,429].includes(outcome?.status))
   return {status:outcome.status,body:{error:'VIEWER_REQUEST_NOT_ACCEPTED'}};
 }catch{/* A lost response cannot prove that Space did not commit. */}
 return {status:502,body:{error:'VIEWER_REQUEST_DELIVERY_UNCERTAIN'}};
}
