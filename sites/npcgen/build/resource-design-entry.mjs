// Document navigation only. Session creation, login, principal and API guards stay in existing auth code.
const fields=new Set(['act','chapter','tab','id','version']);
export function resourceDesignTarget(raw){
 if(typeof raw!=='string'||raw.length>4096||!raw.startsWith('/resource-design')||raw.includes('\\')||/[\u0000-\u001f\u007f]/.test(raw))return null;
 let url;try{url=new URL(raw.replaceAll('&amp;','&'),'http://ngs.invalid');}catch{return null;}
 if(url.origin!=='http://ngs.invalid'||url.pathname!=='/resource-design'||url.hash)return null;
 const clean=new URLSearchParams();
 for(const [key,value]of url.searchParams){
  if(!fields.has(key)||clean.has(key))return null;
  if(key==='tab'?!['environment','props','composition'].includes(value):key==='version'?!/^[1-9][0-9]{0,6}$/.test(value):!/^[A-Za-z0-9_.:-]{1,200}$/.test(value))return null;
  clean.set(key,value);
 }
 return '/resource-design'+(clean.size?'?'+clean.toString():'');
}
export function resourceDesignLoginRedirect(raw){
 const target=resourceDesignTarget(raw);if(!target)return null;
 return '/?'+new URLSearchParams({projectId:'binari',returnTo:target}).toString();
}
export function authenticatedResourceReturn(href,session){
 if(session?.mode!=='local'||session?.state!=='authenticated')return null;
 let url;try{url=new URL(href);}catch{return null;}
 if(url.pathname!=='/'||url.searchParams.getAll('returnTo').length!==1)return null;
 return resourceDesignTarget(url.searchParams.get('returnTo'));
}
