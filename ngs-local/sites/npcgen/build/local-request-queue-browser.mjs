/** The browser submits only to its own NGS queue, never to RS. */
const queueId=/^ngs\.(?:local|space)\.[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u;

export function isQueuedRequest(response,value){
 return response.status===202&&value&&Object.keys(value).sort().join(',')==='queueId,status'&&
  value.status==='queued'&&typeof value.queueId==='string'&&queueId.test(value.queueId);
}

export function submitQueuedRequest(command,{jsonPost,signal,fetcher=fetch}){
 return fetcher('/api/requests',{...jsonPost(command),cache:'no-store',credentials:'same-origin',redirect:'error',signal});
}
