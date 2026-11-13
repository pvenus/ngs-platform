'use client';
import {useEffect,useState,useSyncExternalStore} from 'react';
import source from '../lib/ngs-release.generated.json';
import {formatBuildTimeUtc} from '../lib/ngs-time.mjs';
import {readReleaseReceipt,type ReleaseReceipt} from '../lib/ngs-release';
type LoadedRelease={releaseId:string|null;sourceHash:string|null;adapterHash:string|null;buildId:string|null;buildStartedAt:string|null;environment:string};
const subscribeLoaded=()=>()=>{};
const readLoaded=():LoadedRelease=>source;
const readInitial=():LoadedRelease|null=>null;
export function NgsVersion(){
 // Release stamps are rewritten on restart without invalidating the loaded client.
 // A shared pending snapshot keeps SSR and hydration identical across generations.
 const loaded=useSyncExternalStore(subscribeLoaded,readLoaded,readInitial);
 const [server,setServer]=useState<ReleaseReceipt|null>(null),[error,setError]=useState(false),[reconnected,setReconnected]=useState(false);
 useEffect(()=>{let alive=true;fetch('/ngs-release.json',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error();const v=readReleaseReceipt(await r.json());if(!v)throw Error();if(alive)setServer(v);}).catch(()=>{if(alive)setError(true);});return()=>{alive=false;};},[]);
 useEffect(()=>{const notice=()=>setReconnected(true);window.addEventListener('ngs-explicit-refresh-required',notice);return()=>window.removeEventListener('ngs-explicit-refresh-required',notice);},[]);
 const ready=!!loaded?.buildId,matches=!!loaded&&server?.buildId===loaded?.buildId,stale=!!loaded&&!!server&&!matches;
 return <details className="ngs-version"><summary title="NGS 앱 버전과 빌드 정보" aria-label="NGS 앱 버전과 빌드 정보">NGS {!loaded?'확인 중':ready?loaded.releaseId?.slice(4,12):'미빌드'}{(stale||reconnected)&&' · 업데이트'}</summary><div className="ngs-version-detail"><h3>NGS 앱 정보</h3><dl><dt>앱 릴리스</dt><dd>{loaded?.releaseId||'미빌드'}</dd><dt>소스 식별자</dt><dd>{loaded?.sourceHash||'미생성'}</dd><dt>빌드 식별자</dt><dd>{loaded?.buildId||'미생성'}</dd><dt>환경</dt><dd>{loaded?.environment||'확인 중'}</dd><dt>빌드 시작 (UTC)</dt><dd>{loaded?.buildStartedAt?formatBuildTimeUtc(loaded?.buildStartedAt):'미빌드'}</dd><dt>빌드 완료 (UTC)</dt><dd>{matches&&server?.state==='built'?formatBuildTimeUtc(server.finishedAt!):error?'서버 정보 미관측':'완료 확인 전'}</dd></dl><p>빌드 시각은 UTC 기준입니다. 데이터 revision과 Site 배포 버전은 별도입니다.</p>{(stale||reconnected)&&<p>서버 연결이나 코드가 변경되었습니다. 입력과 플레이는 유지됩니다. 저장한 뒤 직접 새로고침하세요. <button type="button" onClick={()=>location.reload()}>새로고침</button></p>}</div></details>;
}
