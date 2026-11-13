'use client';
import {createContext,useContext,useEffect,useState,type ReactNode} from 'react';
import {refreshFrontendSession,changeFrontendConnection,currentFrontendSession,frontendSessionEvent,localSessionAction,type FrontendSession} from '@/lib/frontend-transport.mjs';
import {authenticatedResourceReturn} from '../build/resource-design-entry.mjs';
import {StatusConsoleSection} from './status-console';
import {purgeCatalogCaches} from './catalog/adapter';
import {sessionPresentationKey,invalidatesSessionPresentation} from '../lib/frontend-session-presentation.mjs';
const Context=createContext<{enabled:boolean;session:FrontendSession|null}>({enabled:false,session:null});
const labels:Record<FrontendSession['state'],string>={unconfigured:'기존 인증 연결 설정 필요',connecting:'기존 인증 연결 확인 중',authenticated:'기존 플랫폼 사용자 연결됨',unavailable:'기존 인증 연결을 확인하지 못했습니다',denied:'접근권한 확인 필요','auth-required':'기존 플랫폼 인증 연결 필요','local-disconnected':'로컬 페이지 연결 해제됨'};
// Lazy client boundaries observe the existing public session event as well as context.
// This is presentation state only; server-minted authorization remains unchanged.
function useObservedFrontendSession(){
 const context=useContext(Context),[observed,setObserved]=useState<FrontendSession|null>(null);
 useEffect(()=>{if(process.env.NEXT_PUBLIC_NPCGEN_FRONTEND_ONLY!=='1')return;let alive=true;const update=(event:Event)=>setObserved((event as CustomEvent).detail as FrontendSession);window.addEventListener(frontendSessionEvent,update);const current=currentFrontendSession();if(current)queueMicrotask(()=>{if(alive)setObserved(current);});else if(!context.session)void refreshFrontendSession().then(value=>{if(alive)setObserved(value);}).catch(()=>{});return()=>{alive=false;window.removeEventListener(frontendSessionEvent,update);};},[context.session]);
 return {enabled:context.enabled||!!observed,session:context.session||observed};
}
export function useLoopbackSingle(){return useObservedFrontendSession().session?.authentication==='local-loopback-capability';}
export function useFrontendAuthKey(){const {enabled,session}=useObservedFrontendSession();const [key,setKey]=useState(enabled?'loading:':'hosted');const next=sessionPresentationKey(key,enabled,session);if(next!==key)setKey(next);return next;}
export function useFrontendAccountName(fallback:string){const {enabled,session}=useObservedFrontendSession();return !enabled?fallback:session?.state==='authenticated'?session.user!.displayName:session?labels[session.state]:'인증 연결 확인 중';}
export function FrontendSessionProvider({enabled,children}:{enabled:boolean;children:ReactNode}){
 const [session,setSession]=useState<FrontendSession|null>(null),[busy,setBusy]=useState(false),[subject,setSubject]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState('');
 useEffect(()=>{if(!enabled)return;let lastConfirmed:FrontendSession|null=null;const observe=(value:FrontendSession)=>{if(invalidatesSessionPresentation(lastConfirmed,value))purgeCatalogCaches(undefined,true);if(value.state!=='unavailable')lastConfirmed=value;setSession(value);};const update=(event:Event)=>observe((event as CustomEvent).detail as FrontendSession);window.addEventListener(frontendSessionEvent,update);void refreshFrontendSession().then(observe).catch(()=>{const current=currentFrontendSession();if(current)observe(current);});return()=>window.removeEventListener(frontendSessionEvent,update);},[enabled]);
 useEffect(()=>{if(!enabled||session?.mode!=='local'||session.state!=='authenticated')return;const target=authenticatedResourceReturn(window.location.href,session);if(target)window.location.replace(target);},[enabled,session]);
 async function action(kind:'disconnect'|'reconnect'){if(busy)return;setBusy(true);setError('');try{setSession(await changeFrontendConnection(kind));}catch{setError('연결 변경 결과를 확인하지 못했습니다. 연결 상태를 다시 확인하세요.');}finally{setBusy(false);}}
 return <Context.Provider value={{enabled,session}}>{enabled&&<StatusConsoleSection id="authentication" title="인증과 개발 환경" level={error||session&&session.state!=='authenticated'?'error':session?.authentication==='local-loopback-capability'?'warning':'info'}><span role="status">{session?.mode==='local'?(session.state==='authenticated'?'로컬 사용자 로그인됨':'로컬 로그인 필요'):session?labels[session.state]:'인증 연결 확인 중'}{session?.state==='authenticated'&&` · ${session.user!.displayName}`}</span> {session?.authentication==='local-loopback-capability'?<span>무비밀번호 IPv4 loopback · 같은 Mac의 프로세스 접근 가능 · 독립 개발 사본 · 승인된 로컬 읽기 정책</span>:session?.mode==='local'?<><span>독립 로컬 인증 · 정식 업무서비스 직접 연결</span>{session.state==='authenticated'?<button disabled={busy} onClick={()=>void localSessionAction('logout').then(setSession).catch(e=>setError(e.message))}>로컬 로그아웃</button>:<form onSubmit={e=>{e.preventDefault();setBusy(true);void localSessionAction('login',{subject,password}).then(setSession).catch(e=>setError(e.message)).finally(()=>{setPassword('');setBusy(false);});}}><label>로컬 사용자<input value={subject} onChange={e=>setSubject(e.target.value)} autoComplete="username" /></label><label>비밀번호<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" /></label><button disabled={busy}>로컬 로그인</button></form>}</>:<span>플랫폼 로그인·계정 로그아웃은 이 페이지에서 지원되지 않습니다.</span>}{session?.mode!=='local'&&session?.state==='authenticated'&&<button type="button" disabled={busy} onClick={()=>void action('disconnect')}>로컬 연결 해제</button>}{session?.state!=='authenticated'&&session?.localReconnectSupported&&<button type="button" disabled={busy} onClick={()=>void action('reconnect')}>승인된 기존 연결 다시 확인</button>}{error&&<p role="alert">{error}</p>}</StatusConsoleSection>}{children}</Context.Provider>;
}

export function FrontendLogoutControl(){
 const {enabled,session}=useContext(Context),[error,setError]=useState('');
 if(session?.authentication==='local-loopback-capability')return null;
 if(!enabled)return <a href="/signout-with-chatgpt?return_to=%2F">로그아웃</a>;
 return <span><button type="button" onClick={()=>void (session?.mode==='local'?localSessionAction('logout'):changeFrontendConnection('disconnect')).catch(()=>setError('로컬 연결 해제 결과를 확인하지 못했습니다.'))}>{session?.mode==='local'?'로컬 로그아웃':'로컬 연결 해제'}</button>{error&&<span role="alert">{error}</span>}</span>;
}
