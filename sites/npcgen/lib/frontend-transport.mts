export function backendUrl(input:string, origin:string) {
 if(!origin)throw Error('BACKEND_CONNECTION_NOT_CONFIGURED');const base=new URL(origin);
 if(base.username||base.password||base.search||base.hash||base.pathname!=='/')throw Error('INVALID_BACKEND_ORIGIN');
 if(base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)))throw Error('HTTPS_BACKEND_REQUIRED');
 const target=new URL(input,base);if(target.origin!==base.origin||!target.pathname.startsWith('/api/')||input.startsWith('//')||target.username||target.password||target.hash||/[\\\u0000-\u0020]/.test(input))throw Error('INVALID_API_PATH');return target.href;
}
export function createFrontendFetch(origin:string, transport:typeof globalThis.fetch=globalThis.fetch){return (input:string,init?:RequestInit)=>transport(backendUrl(input,origin),{...init,credentials:'include'});}
export type FrontendSession={schemaVersion:'npc-frontend-session.v1';state:'unconfigured'|'connecting'|'authenticated'|'unavailable'|'denied'|'auth-required'|'local-disconnected';contextId:string|null;user:{userId:string;displayName:string;email:string}|null;reason?:string;csrfToken?:string;localDisconnectSupported?:boolean;localReconnectSupported?:boolean;mode?:'space'|'local'|'remote';authentication?:string;expiresAt?:number;login:{supported:boolean;reason:string};logout:{supported:boolean;reason:string}};
export const frontendSessionEvent='npcgen-frontend-session-changed';
let session:FrontendSession|null=null,inflight:Promise<FrontendSession>|null=null;
export function currentFrontendSession(){return session;}
export function acceptFrontendSession(value:FrontendSession){
 if(!value||value.schemaVersion!=='npc-frontend-session.v1'||!['unconfigured','connecting','authenticated','unavailable','denied','auth-required','local-disconnected'].includes(value.state)||value.state==='authenticated'&&(!value.user?.userId||!/^([a-f0-9]{64})$/.test(value.contextId||'')))throw Error('FRONTEND_SESSION_INVALID');
 const changed=session?.contextId!==value.contextId||session?.state!==value.state;session=value;
 if(changed&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent(frontendSessionEvent,{detail:value}));return value;
}
export async function refreshFrontendSession(force=false):Promise<FrontendSession>{
 if(inflight&&!force)return inflight;
 const pending=(async()=>{
  const response=await globalThis.fetch('/__npcgen_session',{cache:'no-store'});
  if(!response.ok)throw Error('BACKEND_SESSION_UNAVAILABLE');return acceptFrontendSession(await response.json());
 })();inflight=pending;
 try{return await pending;}catch(error){acceptFrontendSession({schemaVersion:'npc-frontend-session.v1',state:'unavailable',user:null,contextId:null,reason:'BACKEND_SESSION_UNAVAILABLE',login:{supported:false,reason:'EXISTING_OWNER_CONNECTION_REQUIRED'},logout:{supported:false,reason:'NO_PLATFORM_SESSION_TO_SIGN_OUT'}});throw error;}finally{if(inflight===pending)inflight=null;}
}
export async function changeFrontendConnection(action:'disconnect'|'reconnect'){
 const value=await refreshFrontendSession();if(!value.csrfToken)throw Error('FRONTEND_SESSION_INVALID');
 const response=await globalThis.fetch('/__npcgen_session',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-NPCGen-CSRF':value.csrfToken},body:JSON.stringify({action})});
 if(!response.ok)throw Error('SESSION_ACTION_UNCONFIRMED');return acceptFrontendSession(await response.json());
}
export const frontendFetch=async(input:string,init?:RequestInit)=>{
 if(process.env.NEXT_PUBLIC_NPCGEN_FRONTEND_ONLY!=='1')return globalThis.fetch(input,init); // hosted profile stays same-origin.
 if(process.env.NEXT_PUBLIC_NPCGEN_API_ORIGIN)throw Error('REMOTE_FRONTEND_AUTH_ADAPTER_NOT_CONFIGURED');
 const previous=session?.contextId,value=await refreshFrontendSession();
 if(previous&&previous!==value.contextId)throw Error('FRONTEND_SESSION_CONTEXT_CHANGED');
 if(value.state!=='authenticated'||!value.contextId)throw Error(value.reason||'AUTHENTICATED_BACKEND_NOT_CONNECTED');
 if(init?.signal?.aborted)throw new DOMException('Aborted','AbortError');
 const headers=new Headers(init?.headers);headers.set('X-NPCGen-Frontend-Context',value.contextId);
 if(init?.method==='POST'){if(!value.csrfToken)throw Error('FRONTEND_SESSION_INVALID');headers.set('X-NPCGen-CSRF',value.csrfToken);}
 const origin=typeof window!=='undefined'?window.location.origin:'';
 const response=await createFrontendFetch(origin)(input,{...init,headers});
 if([401,403].includes(response.status)){acceptFrontendSession({...value,state:response.status===401?'auth-required':'denied',user:null,contextId:null,reason:response.status===401?'BACKEND_SESSION_UNAVAILABLE':'BACKEND_ACCESS_DENIED'});}
 const returned=response.headers.get('X-NPCGen-Frontend-Context');if(returned&&returned!==value.contextId){acceptFrontendSession({...value,state:'auth-required',user:null,contextId:null,reason:'FRONTEND_SESSION_CONTEXT_CHANGED'});throw Error('FRONTEND_SESSION_CONTEXT_CHANGED');}
 return response;
};
export function frontendAssetUrl(input:string):string|undefined{
 if(process.env.NEXT_PUBLIC_NPCGEN_FRONTEND_ONLY!=='1')return input;
 if(process.env.NEXT_PUBLIC_NPCGEN_API_ORIGIN)return undefined;
 return typeof window!=='undefined'?backendUrl(input,window.location.origin):undefined;
}

export async function localSessionAction(action:'login'|'logout',credentials?:{subject:string;password:string}){const s=await refreshFrontendSession();if(s.mode!=='local'||!s.csrfToken)throw Error('LOCAL_AUTH_NOT_CONFIGURED');const r=await globalThis.fetch('/__npcgen_'+action,{method:'POST',headers:{'Content-Type':'application/json','X-NPCGen-CSRF':s.csrfToken},body:JSON.stringify(credentials||{})});if(!r.ok){const value=await r.json() as {error?:string};throw Error(value.error||'LOCAL_SESSION_ACTION_FAILED');}return acceptFrontendSession(await r.json());}
