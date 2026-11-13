// Environment authentication is supplied by fetchAdapter. Business payloads,
// confirmations, state reads and decisions use one endpoint/contract.
export function createConceptProcessClient(fetchAdapter, apiPath='/api/concept-proposals') {
 if (typeof fetchAdapter!=='function') throw Error('AUTHENTICATED_TRANSPORT_REQUIRED');
 return async function call(operation,body,query={}) {
  const response=await fetchAdapter(body?apiPath:apiPath+'?'+new URLSearchParams({projectId:'binari',view:operation,...operation==='list'?{projection:'summary'}:{},...query}),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:'binari',operation,...body})}:{cache:'no-store'});
  const value=await response.json();
  if(!response.ok)throw Error(value.error==='LOCAL_PROCESSOR_DELIVERY_PENDING'?'로컬 처리기로 전달 중입니다. 잠시 후 같은 요청으로 다시 확인하세요.':value.error||'요청 상태를 확인하지 못했습니다.');
  if(operation==='accept'){
   const receipt=value.intakeReceipt;
   if(value.processingContract!=='ngs-concept-process.v1'||receipt?.schemaVersion!=='ngs-concept-intake-receipt.v1'||receipt.confirmed!==true||receipt.requestId!==value.requestId||receipt.requestHash!==value.requestHash||!receipt.commonRequestId)throw Error('DURABLE_INTAKE_CONFIRMATION_REQUIRED');
  }
  return value;
 };
}
