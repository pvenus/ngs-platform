import {randomBytes,timingSafeEqual} from 'node:crypto';
import {principalFromVerifiedIdentity} from './auth-core.mjs';
const error=(code,status=403)=>Object.assign(Error(code),{status});
export function assertLoopbackRequest(req,port,write=false){
 const origin='http://127.0.0.1:'+port;
 if(req.socket?.remoteAddress!=='127.0.0.1'||req.headers.host!==new URL(origin).host||req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==origin||write&&req.headers.origin!==origin)throw error('LOCAL_IPV4_LOOPBACK_ORIGIN_REQUIRED');
}
export function createLoopbackAuth({now=Date.now,ttlMs=900000,loadReadProjects=()=>[],loadIntakePolicy=()=>({enabled:false}),loadPortraitConfirmationPolicy=()=>({enabled:false}),loadPortraitSubmitPolicy=()=>({enabled:false})}={}){
 const sessions=new Map(),token=()=>randomBytes(32).toString('hex');
 const principal=()=>principalFromVerifiedIdentity({provider:'local',subject:'browser-fixture'},{provider:'local',subject:'browser-fixture',role:'reader',displayName:'로컬 개발 조회',projects:loadReadProjects().map(p=>({...p,write:false,portraitReplacementWrite:p.id==='binari'&&loadPortraitConfirmationPolicy().replacement===true,portraitSubmitNpcId:p.id==='binari'&&loadPortraitSubmitPolicy().enabled?loadPortraitSubmitPolicy().npcId:undefined,portraitSubmitKey:p.id==='binari'&&loadPortraitSubmitPolicy().enabled?loadPortraitSubmitPolicy().idempotencyKey:undefined,portraitConfirmationWrite:p.id==='binari'&&loadPortraitConfirmationPolicy().enabled===true,categoryRevisionIntake:loadIntakePolicy().enabled===true&&p.id==='binari'?['concept']:[]}))});
 const cookie=req=>String(req.headers?.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('npcgen_local_session='))?.slice('npcgen_local_session='.length);
 const read=req=>{const sid=cookie(req),s=sessions.get(sid);if(!s||s.expiresAt<=now()){if(sid)sessions.delete(sid);return null;}return {...s,sid,principal:principal()};};
 return {read,bootstrap(req){let current=read(req);if(current)return current;for(const [id,s]of sessions)if(s.expiresAt<=now())sessions.delete(id);if(sessions.size>=1000)throw error('LOOPBACK_SESSION_LIMIT',429);const sid=token(),s={csrfToken:token(),contextId:token(),expiresAt:now()+ttlMs};sessions.set(sid,s);return {...s,sid,principal:principal(),setCookie:true};},csrf(req,s=read(req)){const value=req.headers?.['x-npcgen-csrf'];if(!s||typeof value!=='string'||value.length!==s.csrfToken.length||!timingSafeEqual(Buffer.from(value),Buffer.from(s.csrfToken)))throw error('CSRF_INVALID');},login(){throw error('LOOPBACK_PASSWORD_ACTION_NOT_SUPPORTED');},logout(){throw error('LOOPBACK_PASSWORD_ACTION_NOT_SUPPORTED');},close(){sessions.clear();}};
}
